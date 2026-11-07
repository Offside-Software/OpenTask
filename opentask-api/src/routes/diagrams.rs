use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use crate::error::AppError;
use crate::models::diagram::{CreateDiagramPayload, ProjectDiagram, UpdateDiagramPayload};
use crate::models::safe_id::SafeId;
use crate::models::task::DatabaseTask;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/projects/{project_id}/diagrams",
            get(list_diagrams).post(create_diagram),
        )
        .route(
            "/projects/{project_id}/diagrams/{diagram_id}",
            get(get_diagram).put(update_diagram).delete(delete_diagram),
        )
        .route(
            "/projects/{project_id}/diagrams/{diagram_id}/tasks",
            get(list_diagram_tasks),
        )
        .route(
            "/projects/{project_id}/diagrams/{diagram_id}/tasks/{task_id}",
            post(link_diagram_to_task).delete(unlink_diagram_from_task),
        )
        .route(
            "/diagrams/{diagram_id}",
            get(get_diagram_direct)
                .put(update_diagram_direct)
                .delete(delete_diagram_direct),
        )
}

pub async fn list_diagrams(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<ProjectDiagram>>, AppError> {
    let rows = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        SELECT id, project_id, title, code, description, created_at, updated_at
        FROM opentask.project_diagrams
        WHERE project_id = $1
        ORDER BY updated_at DESC;
        "#,
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn create_diagram(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Json(payload): Json<CreateDiagramPayload>,
) -> Result<(StatusCode, Json<ProjectDiagram>), AppError> {
    let id = next_id();
    let row = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        INSERT INTO opentask.project_diagrams
            (id, project_id, title, code, description, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id, project_id, title, code, description, created_at, updated_at;
        "#,
    )
    .bind(id)
    .bind(project_id.0)
    .bind(payload.title)
    .bind(payload.code)
    .bind(payload.description)
    .fetch_one(&state.pool)
    .await?;

    state.realtime.publish(project_id.0, "diagram", "created", Some(id));
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn get_diagram(
    State(state): State<AppState>,
    Path((project_id, diagram_id)): Path<(SafeId, SafeId)>,
) -> Result<Json<ProjectDiagram>, AppError> {
    let row = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        SELECT id, project_id, title, code, description, created_at, updated_at
        FROM opentask.project_diagrams
        WHERE id = $1 AND project_id = $2
        LIMIT 1;
        "#,
    )
    .bind(diagram_id.0)
    .bind(project_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Diagram {diagram_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_diagram(
    State(state): State<AppState>,
    Path((_project_id, diagram_id)): Path<(SafeId, SafeId)>,
    Json(payload): Json<UpdateDiagramPayload>,
) -> Result<Json<ProjectDiagram>, AppError> {
    update_diagram_direct(State(state), Path(diagram_id), Json(payload)).await
}

pub async fn delete_diagram(
    State(state): State<AppState>,
    Path((_project_id, diagram_id)): Path<(SafeId, SafeId)>,
) -> Result<StatusCode, AppError> {
    delete_diagram_direct(State(state), Path(diagram_id)).await
}

pub async fn list_diagram_tasks(
    State(state): State<AppState>,
    Path((project_id, diagram_id)): Path<(SafeId, SafeId)>,
) -> Result<Json<Vec<DatabaseTask>>, AppError> {
    let rows = crate::db::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               COALESCE(assignee_ids, '{}'::BIGINT[]) as assignee_ids,
               title, description, type as task_type, weight, branch_name, repo_url,
               COALESCE(attachments, '[]'::jsonb) as attachments,
               COALESCE(diagram_ids, '{}'::BIGINT[]) as diagram_ids,
               last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE project_id = $1 AND $2 = ANY(diagram_ids)
        ORDER BY updated_at DESC;
        "#,
    )
    .bind(project_id.0)
    .bind(diagram_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn link_diagram_to_task(
    State(state): State<AppState>,
    Path((project_id, diagram_id, task_id)): Path<(SafeId, SafeId, SafeId)>,
) -> Result<StatusCode, AppError> {
    let res = crate::db::query(
        r#"
        UPDATE opentask.tasks
        SET diagram_ids = array_append(array_remove(COALESCE(diagram_ids, '{}'::BIGINT[]), $1), $1),
            updated_at = NOW()
        WHERE id = $2 AND project_id = $3;
        "#,
    )
    .bind(diagram_id.0)
    .bind(task_id.0)
    .bind(project_id.0)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Task {task_id} not found")));
    }

    state.realtime.publish(project_id.0, "task", "updated", Some(task_id.0));
    Ok(StatusCode::OK)
}

pub async fn unlink_diagram_from_task(
    State(state): State<AppState>,
    Path((project_id, diagram_id, task_id)): Path<(SafeId, SafeId, SafeId)>,
) -> Result<StatusCode, AppError> {
    let res = crate::db::query(
        r#"
        UPDATE opentask.tasks
        SET diagram_ids = array_remove(COALESCE(diagram_ids, '{}'::BIGINT[]), $1),
            updated_at = NOW()
        WHERE id = $2 AND project_id = $3;
        "#,
    )
    .bind(diagram_id.0)
    .bind(task_id.0)
    .bind(project_id.0)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Task {task_id} not found")));
    }

    state.realtime.publish(project_id.0, "task", "updated", Some(task_id.0));
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_diagram_direct(
    State(state): State<AppState>,
    Path(diagram_id): Path<SafeId>,
) -> Result<Json<ProjectDiagram>, AppError> {
    let row = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        SELECT id, project_id, title, code, description, created_at, updated_at
        FROM opentask.project_diagrams
        WHERE id = $1
        LIMIT 1;
        "#,
    )
    .bind(diagram_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Diagram {diagram_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_diagram_direct(
    State(state): State<AppState>,
    Path(diagram_id): Path<SafeId>,
    Json(payload): Json<UpdateDiagramPayload>,
) -> Result<Json<ProjectDiagram>, AppError> {
    let existing = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        SELECT id, project_id, title, code, description, created_at, updated_at
        FROM opentask.project_diagrams
        WHERE id = $1
        LIMIT 1;
        "#,
    )
    .bind(diagram_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Diagram {diagram_id} not found")))?;

    let title = payload.title.unwrap_or(existing.title);
    let code = payload.code.unwrap_or(existing.code);
    let description = payload.description.or(existing.description);

    let row = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        UPDATE opentask.project_diagrams
        SET title = $1, code = $2, description = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING id, project_id, title, code, description, created_at, updated_at;
        "#,
    )
    .bind(title)
    .bind(code)
    .bind(description)
    .bind(diagram_id.0)
    .fetch_one(&state.pool)
    .await?;

    state.realtime.publish(existing.project_id.0, "diagram", "updated", Some(diagram_id.0));
    Ok(Json(row))
}

pub async fn delete_diagram_direct(
    State(state): State<AppState>,
    Path(diagram_id): Path<SafeId>,
) -> Result<StatusCode, AppError> {
    let existing = crate::db::query_as::<_, ProjectDiagram>(
        r#"
        SELECT id, project_id, title, code, description, created_at, updated_at
        FROM opentask.project_diagrams
        WHERE id = $1
        LIMIT 1;
        "#,
    )
    .bind(diagram_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Diagram {diagram_id} not found")))?;

    crate::db::query(
        r#"
        DELETE FROM opentask.project_diagrams
        WHERE id = $1;
        "#,
    )
    .bind(diagram_id.0)
    .execute(&state.pool)
    .await?;

    crate::db::query(
        r#"
        UPDATE opentask.tasks
        SET diagram_ids = array_remove(diagram_ids, $1), updated_at = NOW()
        WHERE $1 = ANY(diagram_ids);
        "#,
    )
    .bind(diagram_id.0)
    .execute(&state.pool)
    .await?;

    state.realtime.publish(existing.project_id.0, "diagram", "deleted", Some(diagram_id.0));
    Ok(StatusCode::NO_CONTENT)
}
