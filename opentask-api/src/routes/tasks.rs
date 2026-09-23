use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use crate::{error::AppError, models::task::TaskUpdatePayload};
use crate::models::safe_id::SafeId;
use crate::models::task::{BatchReviewPayload, DatabaseTask, TaskReorderPayload};
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct TaskListQuery {
    pub project_id: Option<SafeId>,
    pub bucket_id: Option<SafeId>,
}

#[derive(Debug, Deserialize)]
pub struct TaskSearchQuery {
    pub q: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", post(create_task).get(list_tasks))
        .route(
            "/tasks/{task_id}",
            get(get_task).put(update_task).delete(delete_task),
        )
        .route("/tasks/{task_id}/redirect", get(redirect_task))
        .route("/projects/{project_id}/tasks/search", get(search_tasks))
        .route(
            "/projects/{project_id}/buckets/{bucket_id}/tasks/reorder",
            axum::routing::put(reorder_tasks),
        )
        .route("/api/v1/tasks/batch-review", post(batch_review_tasks))
}

pub async fn create_task(
    State(state): State<AppState>,
    Json(payload): Json<DatabaseTask>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task_id = next_id();
    let project_id = payload
        .project_id
        .ok_or_else(|| AppError::BadRequest("project_id is required".to_string()))?;

    let mut target_bucket_id = payload.bucket_id.map(|b| b.0);

    // If bucket_id is None, default to DRAFT bucket
    if target_bucket_id.is_none() {
        let draft_row = sqlx::query(
            "SELECT id FROM opentask.buckets WHERE project_id = $1 AND state = 'DRAFT' LIMIT 1;",
        )
        .bind(project_id.0)
        .fetch_optional(&state.pool)
        .await?;

        target_bucket_id = draft_row.and_then(|r| r.try_get::<i64, _>("id").ok());
    }

    let b_id = target_bucket_id
        .ok_or_else(|| AppError::BadRequest("No valid bucket found for task".to_string()))?;

    let max_idx_row = sqlx::query(
        "SELECT COALESCE(MAX(order_idx), -1) as max_idx FROM opentask.tasks WHERE bucket_id = $1;",
    )
    .bind(b_id)
    .fetch_one(&state.pool)
    .await?;
    let max_idx: i32 = max_idx_row.try_get("max_idx").unwrap_or(-1);

    let order_idx = payload.order_idx.unwrap_or(max_idx + 1);

    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        INSERT INTO opentask.tasks
            (id, project_id, bucket_id, meeting_id, parent_task_id, lead_assignee_id, suggested_assignee_id,
             title, description, type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14, NOW(), NOW())
        RETURNING id, project_id, bucket_id, meeting_id,
                  parent_task_id, lead_assignee_id, suggested_assignee_id,
                  title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at;
        "#
    )
    .bind(task_id)
    .bind(project_id.0)
    .bind(b_id)
    .bind(payload.meeting_id.map(|m| m.0))
    .bind(payload.parent_task_id.map(|p| p.0))
    .bind(payload.lead_assignee_id.map(|l| l.0))
    .bind(payload.suggested_assignee_id.map(|s| s.0))
    .bind(payload.title)
    .bind(payload.description)
    .bind(payload.task_type.unwrap_or_else(|| "CODE".to_string()))
    .bind(payload.weight.unwrap_or(1))
    .bind(payload.branch_name)
    .bind(payload.repo_url)
    .bind(order_idx)
    .fetch_one(&state.pool)
    .await?;

    let _ = crate::routes::activities::record_project_event(
        &state.pool,
        project_id.0,
        row.lead_assignee_id.as_ref().map(|l| l.0),
        None,
        "created",
        &row.title,
        "TASK_CREATED",
        "TASK",
        Some(task_id),
        Some(serde_json::json!({
            "title": row.title,
            "bucket_id": b_id.to_string(),
            "weight": row.weight,
        })),
    )
    .await;

    if let Some(assignee) = row.lead_assignee_id.as_ref() {
        let pool = state.pool.clone();
        let config = state.config.clone();
        let task_title = row.title.clone();
        let pid = project_id.0;
        let tid = task_id;
        let aid = assignee.0;
        tokio::spawn(async move {
            crate::services::notifications::notify_task_assigned(
                &pool,
                &config,
                &task_title,
                aid,
                pid,
                None,
                Some(tid),
                None,
            )
            .await;
        });
    }

    Ok(Json(row))
}

pub async fn list_tasks(
    State(state): State<AppState>,
    Query(query): Query<TaskListQuery>,
) -> Result<Json<Vec<DatabaseTask>>, AppError> {
    let pid = query.project_id.map(|p| p.0);
    let bid = query.bucket_id.map(|b| b.0);

    let rows = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE ($1::BIGINT IS NULL OR project_id = $1)
          AND ($2::BIGINT IS NULL OR bucket_id = $2)
        ORDER BY order_idx ASC;
        "#
    )
    .bind(pid)
    .bind(bid)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn get_task(
    State(state): State<AppState>,
    Path(task_id): Path<SafeId>,
) -> Result<Json<DatabaseTask>, AppError> {
    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE id = $1
        LIMIT 1;
        "#
    )
    .bind(task_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_task(
    State(state): State<AppState>,
    Path(task_id): Path<SafeId>,
    Json(payload): Json<TaskUpdatePayload>,
) -> Result<Json<DatabaseTask>, AppError> {
    let mut builder = sqlx::QueryBuilder::new(
        "UPDATE opentask.tasks SET updated_at = NOW(), last_activity_at = NOW()",
    );

    if let Some(ref title) = payload.title {
        builder.push(", title = ");
        builder.push_bind(title);
    }
    if let Some(ref description) = payload.description {
        builder.push(", description = ");
        builder.push_bind(description);
    }
    if let Some(ref task_type) = payload.task_type {
        builder.push(", type = ");
        builder.push_bind(task_type);
    }
    if let Some(weight) = payload.weight {
        builder.push(", weight = ");
        builder.push_bind(weight);
    }
    if let Some(bucket_id) = payload.bucket_id {
        builder.push(", bucket_id = ");
        builder.push_bind(bucket_id.0);
    }
    if let Some(ref lead) = payload.lead_assignee_id {
        builder.push(", lead_assignee_id = ");
        builder.push_bind(lead.as_ref().map(|l| l.0));
    }
    if let Some(ref suggested) = payload.suggested_assignee_id {
        builder.push(", suggested_assignee_id = ");
        builder.push_bind(suggested.as_ref().map(|s| s.0));
    }
    if let Some(ref branch_name) = payload.branch_name {
        builder.push(", branch_name = ");
        builder.push_bind(branch_name);
    }
    if let Some(ref repo_url) = payload.repo_url {
        builder.push(", repo_url = ");
        builder.push_bind(repo_url);
    }
    if let Some(order_idx) = payload.order_idx {
        builder.push(", order_idx = ");
        builder.push_bind(order_idx);
    }

    builder.push(" WHERE id = ");
    builder.push_bind(task_id.0);
    builder.push(
        " RETURNING id, project_id, bucket_id, meeting_id, \
                   parent_task_id, lead_assignee_id, suggested_assignee_id, \
                   title, description, type as task_type, weight, branch_name, repo_url, \
                   last_activity_at, order_idx, created_at, updated_at;",
    );

    let row = builder
        .build_query_as::<DatabaseTask>()
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found")))?;

    if let Some(pid) = row.project_id {
        let action = if payload.bucket_id.is_some() {
            "moved"
        } else {
            "updated"
        };
        let event_type = if payload.bucket_id.is_some() {
            "TASK_MOVED"
        } else {
            "TASK_UPDATED"
        };
        let _ = crate::routes::activities::record_project_event(
            &state.pool,
            pid.0,
            row.lead_assignee_id.as_ref().map(|l| l.0),
            None,
            action,
            &row.title,
            event_type,
            "TASK",
            Some(task_id.0),
            None,
        )
        .await;
    }

    // Trigger notification if assignee was updated to a specific user
    if let Some(Some(assignee)) = payload.lead_assignee_id {
        let pool = state.pool.clone();
        let config = state.config.clone();
        let task_title = row.title.clone();
        let pid = row.project_id.map(|p| p.0).unwrap_or(0);
        let tid = task_id.0;
        let aid = assignee.0;
        tokio::spawn(async move {
            crate::services::notifications::notify_task_assigned(
                &pool,
                &config,
                &task_title,
                aid,
                pid,
                None,
                Some(tid),
                None,
            )
            .await;
        });
    }

    // Trigger notification if task moved to a completed bucket
    if let Some(b_id) = payload.bucket_id {
        let pool = state.pool.clone();
        let config = state.config.clone();
        let task_title = row.title.clone();
        let pid = row.project_id.map(|p| p.0).unwrap_or(0);
        let tid = task_id.0;
        let aid = row.lead_assignee_id.as_ref().map(|l| l.0);
        tokio::spawn(async move {
            if let Ok(Some(b_row)) = sqlx::query("SELECT title FROM opentask.buckets WHERE id = $1 LIMIT 1;")
                .bind(b_id.0)
                .fetch_optional(&pool)
                .await
            {
                let b_name: String = b_row.try_get("title").unwrap_or_default();
                let lower = b_name.to_lowercase();
                if lower.contains("done") || lower.contains("complete") || lower.contains("finish") {
                    crate::services::notifications::notify_task_completed(
                        &pool,
                        &config,
                        &task_title,
                        pid,
                        None,
                        Some(tid),
                        aid,
                        None,
                    )
                    .await;
                }
            }
        });
    }

    Ok(Json(row))
}

pub async fn delete_task(
    State(state): State<AppState>,
    Path(task_id): Path<SafeId>,
) -> Result<StatusCode, AppError> {
    let task_info = sqlx::query("SELECT project_id, title FROM opentask.tasks WHERE id = $1;")
        .bind(task_id.0)
        .fetch_optional(&state.pool)
        .await?;

    let res = sqlx::query("DELETE FROM opentask.tasks WHERE id = $1;")
        .bind(task_id.0)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Task {task_id} not found")));
    }

    if let Some(t) = task_info {
        if let (Ok(pid), Ok(title)) = (
            t.try_get::<i64, _>("project_id"),
            t.try_get::<String, _>("title"),
        ) {
            let _ = crate::routes::activities::record_project_event(
                &state.pool,
                pid,
                None,
                None,
                "deleted",
                &title,
                "TASK_DELETED",
                "TASK",
                Some(task_id.0),
                None,
            )
            .await;
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn redirect_task(
    State(state): State<AppState>,
    Path(task_id): Path<SafeId>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row =
        sqlx::query("SELECT project_id, bucket_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
            .bind(task_id.0)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found")))?;

    let pid: Option<i64> = row.try_get("project_id").ok();
    let bid: Option<i64> = row.try_get("bucket_id").ok();

    Ok(Json(json!({
        "project_id": pid.map(|id| id.to_string()),
        "bucket_id": bid.map(|id| id.to_string())
    })))
}

pub async fn search_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Query(query): Query<TaskSearchQuery>,
) -> Result<Json<Vec<DatabaseTask>>, AppError> {
    let pattern = format!("%{}%", query.q.trim());

    let rows = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE project_id = $1
          AND (title ILIKE $2 OR description ILIKE $2)
        ORDER BY updated_at DESC
        LIMIT 20;
        "#
    )
    .bind(project_id.0)
    .bind(pattern)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn reorder_tasks(
    State(state): State<AppState>,
    Path((project_id, target_bucket_id)): Path<(SafeId, SafeId)>,
    Json(payload): Json<TaskReorderPayload>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items: Vec<(SafeId, i32, i64)> = match payload {
        TaskReorderPayload::List(ids) => ids
            .into_iter()
            .enumerate()
            .map(|(idx, id)| (id, idx as i32, target_bucket_id.0))
            .collect(),
        TaskReorderPayload::Object { tasks } => tasks
            .into_iter()
            .map(|item| {
                let b_id = item.bucket_id.map(|b| b.0).unwrap_or(target_bucket_id.0);
                (item.id, item.order_idx, b_id)
            })
            .collect(),
    };

    let mut tx = state.pool.begin().await?;
    let mut ordered_ids = Vec::with_capacity(items.len());

    for (t_id, order_idx, b_id) in &items {
        ordered_ids.push(t_id.to_string());
        sqlx::query(
            "UPDATE opentask.tasks SET order_idx = $1, bucket_id = $2, updated_at = NOW() WHERE id = $3 AND project_id = $4;"
        )
        .bind(order_idx)
        .bind(b_id)
        .bind(t_id.0)
        .bind(project_id.0)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    tracing::info!(
        "Reordered {} tasks for project {} into bucket {}",
        items.len(),
        project_id,
        target_bucket_id
    );

    Ok(Json(json!({
        "status": "success",
        "order": ordered_ids,
        "bucket_id": target_bucket_id
    })))
}

pub async fn batch_review_tasks(
    State(state): State<AppState>,
    Json(payload): Json<BatchReviewPayload>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.pool.begin().await?;

    // 1. Lock the alert row FOR UPDATE to guard against double-processing
    let alert_row =
        sqlx::query("SELECT is_resolved FROM opentask.alerts WHERE id = $1 FOR UPDATE;")
            .bind(payload.alert_id.0)
            .fetch_optional(&mut *tx)
            .await?;

    let is_resolved = match alert_row {
        Some(a) => a.try_get::<bool, _>("is_resolved").unwrap_or(false),
        None => {
            return Err(AppError::NotFound(format!(
                "Alert {} not found",
                payload.alert_id
            )));
        }
    };

    if is_resolved {
        return Err(AppError::Conflict(
            "Alert has already been resolved".to_string(),
        ));
    }

    // 2. Resolve default DRAFT bucket
    let bucket_row = sqlx::query(
        "SELECT id FROM opentask.buckets WHERE project_id = $1 AND state = 'DRAFT' LIMIT 1;",
    )
    .bind(payload.project_id.0)
    .fetch_optional(&mut *tx)
    .await?;

    let bucket_id: i64 = bucket_row
        .and_then(|r| r.try_get::<i64, _>("id").ok())
        .unwrap_or(1);

    // 3. Batch-insert tasks
    let mut inserted_ids = Vec::new();
    for (idx, task) in payload.tasks.into_iter().enumerate() {
        let task_id = next_id();
        sqlx::query(
            r#"
            INSERT INTO opentask.tasks
                (id, project_id, bucket_id, title, description, weight, type, lead_assignee_id, order_idx, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW());
            "#
        )
        .bind(task_id)
        .bind(payload.project_id.0)
        .bind(bucket_id)
        .bind(task.title)
        .bind(task.description)
        .bind(task.weight)
        .bind(task.task_type)
        .bind(task.assignee_id.map(|a| a.0))
        .bind(idx as i32)
        .execute(&mut *tx)
        .await?;

        inserted_ids.push(task_id.to_string());
    }

    // 4. Mark alert as resolved
    sqlx::query("UPDATE opentask.alerts SET is_resolved = TRUE, updated_at = NOW() WHERE id = $1;")
        .bind(payload.alert_id.0)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let _ = crate::routes::activities::record_project_event(
        &state.pool,
        payload.project_id.0,
        None,
        Some("AI Architect"),
        "created",
        &format!("{} tasks via AI Draft review", inserted_ids.len()),
        "TASKS_BATCH_REVIEWED",
        "TASK",
        None,
        Some(serde_json::json!({ "count": inserted_ids.len() })),
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "message": "Tasks successfully reviewed and committed",
        "inserted_count": inserted_ids.len(),
        "task_ids": inserted_ids
    })))
}
