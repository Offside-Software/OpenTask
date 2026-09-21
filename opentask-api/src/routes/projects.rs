use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use crate::error::AppError;
use crate::extractors::auth::OptionalCurrentUser;
use crate::models::bucket::DatabaseBucket;
use crate::models::project::{
    BoardResponse, DatabaseProject, ProjectApiKeyResponse, ProjectMember,
};
use crate::models::safe_id::SafeId;
use crate::models::task::DatabaseTask;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct BoardQuery {
    pub limit_per_bucket: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMemberPayload {
    pub user_id: Option<SafeId>,
    pub gh_username: Option<String>,
    pub role: Option<String>,
    pub kpi_score: Option<f64>,
    pub max_capacity: Option<i32>,
    pub current_load: Option<i32>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects", post(create_project).get(list_projects))
        .route("/projects/mine", get(list_my_projects))
        .route(
            "/projects/{project_id}",
            get(get_project).put(update_project).delete(delete_project),
        )
        .route("/projects/{project_id}/board", get(get_project_board))
        .route(
            "/projects/{project_id}/dashboard",
            get(get_project_dashboard),
        )
        .route(
            "/projects/{project_id}/api-key",
            get(get_project_api_key)
                .post(create_project_api_key)
                .delete(delete_project_api_key),
        )
        .route(
            "/projects/{project_id}/members",
            post(add_project_member).get(list_project_members),
        )
        .route(
            "/projects/{project_id}/members/{member_id}",
            get(get_project_member_by_id),
        )
        .route("/users/me/project_members", get(list_my_project_members))
}

pub async fn create_project(
    State(state): State<AppState>,
    OptionalCurrentUser(user): OptionalCurrentUser,
    Json(payload): Json<DatabaseProject>,
) -> Result<Json<DatabaseProject>, AppError> {
    let project_id = next_id();
    let repos = payload.gh_repo_url.unwrap_or_default();

    let mut tx = state.pool.begin().await?;

    let row = sqlx::query_as::<_, DatabaseProject>(
        r#"
        INSERT INTO opentask.projects (id, name, gh_repo_url, description, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        RETURNING id, name, gh_repo_url, description, custom_ai_api_key, api_key, created_at, updated_at;
        "#
    )
    .bind(project_id)
    .bind(&payload.name)
    .bind(&repos)
    .bind(&payload.description)
    .fetch_one(&mut *tx)
    .await?;

    // Create default "AI Drafts" bucket
    let bucket_id = next_id();
    sqlx::query(
        r#"
        INSERT INTO opentask.buckets (id, project_id, name, state, is_system_locked, order_idx, created_at)
        VALUES ($1, $2, 'AI Drafts', 'DRAFT', TRUE, 0, NOW());
        "#
    )
    .bind(bucket_id)
    .bind(project_id)
    .execute(&mut *tx)
    .await?;

    // Add creator as MANAGER if authenticated
    if let Some(u) = user {
        let member_id = next_id();
        let _ = sqlx::query(
            r#"
            INSERT INTO opentask.project_member (id, project_id, user_id, role, current_load, gh_username)
            SELECT $1, $2, id, 'MANAGER', 0, gh_username
            FROM opentask.users
            WHERE gh_id = $3 OR gh_username = $4
            LIMIT 1
            ON CONFLICT (user_id, project_id) DO NOTHING;
            "#
        )
        .bind(member_id)
        .bind(project_id)
        .bind(u.id.to_string())
        .bind(&u.login)
        .execute(&mut *tx)
        .await;
    }

    tx.commit().await?;

    Ok(Json(row))
}

pub async fn list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<DatabaseProject>>, AppError> {
    let rows = sqlx::query_as::<_, DatabaseProject>(
        r#"
        SELECT id, name, gh_repo_url, description, custom_ai_api_key, api_key, created_at, updated_at
        FROM opentask.projects
        ORDER BY created_at DESC;
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn list_my_projects(
    State(state): State<AppState>,
    OptionalCurrentUser(user): OptionalCurrentUser,
) -> Result<Json<Vec<DatabaseProject>>, AppError> {
    let u = match user {
        Some(u) => u,
        None => return list_projects(State(state)).await,
    };

    let rows = sqlx::query_as::<_, DatabaseProject>(
        r#"
        SELECT DISTINCT p.id, p.name, p.gh_repo_url, p.description, p.custom_ai_api_key, p.api_key, p.created_at, p.updated_at
        FROM opentask.projects p
        JOIN opentask.project_member pm ON p.id = pm.project_id
        JOIN opentask.users u ON pm.user_id = u.id
        WHERE u.gh_id = $1 OR u.gh_username = $2
        ORDER BY p.created_at DESC;
        "#
    )
    .bind(u.id.to_string())
    .bind(&u.login)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<DatabaseProject>, AppError> {
    let row = sqlx::query_as::<_, DatabaseProject>(
        r#"
        SELECT id, name, gh_repo_url, description, custom_ai_api_key, api_key, created_at, updated_at
        FROM opentask.projects
        WHERE id = $1
        LIMIT 1;
        "#
    )
    .bind(project_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Project {project_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_project(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Json(payload): Json<DatabaseProject>,
) -> Result<Json<DatabaseProject>, AppError> {
    let repos = payload.gh_repo_url.unwrap_or_default();

    let row = sqlx::query_as::<_, DatabaseProject>(
        r#"
        UPDATE opentask.projects
        SET name = COALESCE($1, name),
            gh_repo_url = $2,
            description = COALESCE($3, description),
            updated_at = NOW()
        WHERE id = $4
        RETURNING id, name, gh_repo_url, description, custom_ai_api_key, api_key, created_at, updated_at;
        "#
    )
    .bind(payload.name)
    .bind(&repos)
    .bind(payload.description)
    .bind(project_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Project {project_id} not found")))?;

    Ok(Json(row))
}

pub async fn delete_project(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<StatusCode, AppError> {
    let res = sqlx::query("DELETE FROM opentask.projects WHERE id = $1;")
        .bind(project_id.0)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "Project {project_id} not found"
        )));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_project_board(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Query(query): Query<BoardQuery>,
) -> Result<Json<BoardResponse>, AppError> {
    let mut buckets = sqlx::query_as::<_, DatabaseBucket>(
        r#"
        SELECT id, project_id, name, description, state, is_system_locked, order_idx, NULL::BIGINT as task_count, created_at, updated_at
        FROM opentask.buckets
        WHERE project_id = $1
        ORDER BY order_idx ASC;
        "#
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    let counts = sqlx::query(
        "SELECT bucket_id, COUNT(*) as count FROM opentask.tasks WHERE project_id = $1 GROUP BY bucket_id;"
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    let count_map: std::collections::HashMap<Option<i64>, i64> = counts
        .into_iter()
        .map(|r| {
            let bid: Option<i64> = r.try_get("bucket_id").ok();
            let count: i64 = r.try_get("count").unwrap_or(0);
            (bid, count)
        })
        .collect();

    for b in &mut buckets {
        if let Some(id) = b.id {
            b.task_count = count_map.get(&Some(id.0)).copied();
        }
    }

    let limit = query.limit_per_bucket.unwrap_or(50);
    let tasks = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket_id ORDER BY order_idx ASC) as rn
            FROM opentask.tasks
            WHERE project_id = $1
        ) sub
        WHERE rn <= $2
        ORDER BY order_idx ASC;
        "#
    )
    .bind(project_id.0)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(BoardResponse { buckets, tasks }))
}

pub async fn get_project_dashboard(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<serde_json::Value>, AppError> {
    let total_tasks_row =
        sqlx::query("SELECT COUNT(*) as count FROM opentask.tasks WHERE project_id = $1;")
            .bind(project_id.0)
            .fetch_one(&state.pool)
            .await?;
    let total_tasks: i64 = total_tasks_row.try_get("count").unwrap_or(0);

    let completed_tasks_row = sqlx::query(
        r#"
        SELECT COUNT(*) as count
        FROM opentask.tasks t
        JOIN opentask.buckets b ON t.bucket_id = b.id
        WHERE t.project_id = $1 AND b.state = 'COMPLETED';
        "#,
    )
    .bind(project_id.0)
    .fetch_one(&state.pool)
    .await?;
    let completed_tasks: i64 = completed_tasks_row.try_get("count").unwrap_or(0);

    let members_count_row =
        sqlx::query("SELECT COUNT(*) as count FROM opentask.project_member WHERE project_id = $1;")
            .bind(project_id.0)
            .fetch_one(&state.pool)
            .await?;
    let members_count: i64 = members_count_row.try_get("count").unwrap_or(0);

    Ok(Json(json!({
        "project_id": project_id,
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "active_members": members_count,
    })))
}

pub async fn get_project_api_key(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<ProjectApiKeyResponse>, AppError> {
    let row = sqlx::query("SELECT api_key FROM opentask.projects WHERE id = $1;")
        .bind(project_id.0)
        .fetch_optional(&state.pool)
        .await?;

    let key = row
        .and_then(|r| r.try_get::<Option<String>, _>("api_key").ok())
        .flatten()
        .ok_or_else(|| AppError::NotFound("API key not generated for this project".to_string()))?;

    Ok(Json(ProjectApiKeyResponse {
        project_id,
        api_key: key,
    }))
}

pub async fn create_project_api_key(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<ProjectApiKeyResponse>, AppError> {
    let generated = format!(
        "opk_{:x}{:x}",
        rand::random::<u128>(),
        rand::random::<u128>()
    );

    sqlx::query("UPDATE opentask.projects SET api_key = $1, updated_at = NOW() WHERE id = $2;")
        .bind(&generated)
        .bind(project_id.0)
        .execute(&state.pool)
        .await?;

    Ok(Json(ProjectApiKeyResponse {
        project_id,
        api_key: generated,
    }))
}

pub async fn delete_project_api_key(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<StatusCode, AppError> {
    sqlx::query("UPDATE opentask.projects SET api_key = NULL, updated_at = NOW() WHERE id = $1;")
        .bind(project_id.0)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_project_member(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Json(payload): Json<CreateMemberPayload>,
) -> Result<Json<ProjectMember>, AppError> {
    let member_id = next_id();
    let role = payload.role.unwrap_or_else(|| "PROGRAMMER".to_string());

    let mut resolved_user_id = payload.user_id.map(|u| u.0);
    let mut resolved_gh_username = payload.gh_username.clone();

    if resolved_user_id.is_none() && resolved_gh_username.is_some() {
        if let Ok(u) = crate::routes::auth::get_or_create_user(
            &state.pool,
            None,
            None,
            resolved_gh_username.as_deref(),
            None,
            None,
            None,
        )
        .await
        {
            resolved_user_id = u.id.map(|id| id.0);
        }
    } else if let Some(uid) = resolved_user_id {
        if resolved_gh_username.is_none() {
            let row = sqlx::query("SELECT gh_username FROM opentask.users WHERE id = $1;")
                .bind(uid)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
            if let Some(r) = row {
                resolved_gh_username = r.try_get::<Option<String>, _>("gh_username").ok().flatten();
            }
        }
    }

    let uid = match resolved_user_id {
        Some(id) => id,
        None => {
            return Err(AppError::BadRequest(
                "user_id or valid gh_username is required".to_string(),
            ));
        }
    };

    let row = sqlx::query_as::<_, ProjectMember>(
        r#"
        INSERT INTO opentask.project_member (id, project_id, user_id, role, kpi_score, max_capacity, current_load, gh_username)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, project_id) DO UPDATE 
        SET role = EXCLUDED.role,
            gh_username = COALESCE(EXCLUDED.gh_username, opentask.project_member.gh_username)
        RETURNING id, project_id, user_id, role, kpi_score, max_capacity, current_load, gh_username,
                  (SELECT display_name FROM opentask.users WHERE id = opentask.project_member.user_id) as display_name,
                  CASE 
                      WHEN gh_username IS NOT NULL 
                      THEN 'https://github.com/' || gh_username || '.png?size=64'
                      ELSE NULL
                  END as avatar_url;
        "#
    )
    .bind(member_id)
    .bind(project_id.0)
    .bind(uid)
    .bind(role)
    .bind(payload.kpi_score.unwrap_or(0.0))
    .bind(payload.max_capacity.unwrap_or(10))
    .bind(payload.current_load.unwrap_or(0))
    .bind(resolved_gh_username)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

pub async fn list_project_members(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<ProjectMember>>, AppError> {
    let rows = sqlx::query_as::<_, ProjectMember>(
        r#"
        SELECT pm.id, pm.project_id, pm.user_id, pm.role, pm.kpi_score, pm.max_capacity, pm.current_load,
               COALESCE(pm.gh_username, u.gh_username) as gh_username,
               u.display_name,
               CASE 
                   WHEN COALESCE(pm.gh_username, u.gh_username) IS NOT NULL 
                   THEN 'https://github.com/' || COALESCE(pm.gh_username, u.gh_username) || '.png?size=64'
                   ELSE NULL
               END as avatar_url
        FROM opentask.project_member pm
        LEFT JOIN opentask.users u ON pm.user_id = u.id
        WHERE pm.project_id = $1
        ORDER BY pm.id ASC;
        "#
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn list_my_project_members(
    State(state): State<AppState>,
    OptionalCurrentUser(user): OptionalCurrentUser,
) -> Result<Json<Vec<ProjectMember>>, AppError> {
    let u = match user {
        Some(u) => u,
        None => return Ok(Json(vec![])),
    };

    let rows = sqlx::query_as::<_, ProjectMember>(
        r#"
        SELECT pm.id, pm.project_id, pm.user_id, pm.role, pm.kpi_score, pm.max_capacity, pm.current_load,
               COALESCE(pm.gh_username, u.gh_username) as gh_username,
               u.display_name,
               CASE 
                   WHEN COALESCE(pm.gh_username, u.gh_username) IS NOT NULL 
                   THEN 'https://github.com/' || COALESCE(pm.gh_username, u.gh_username) || '.png?size=64'
                   ELSE NULL
               END as avatar_url
        FROM opentask.project_member pm
        JOIN opentask.users u ON pm.user_id = u.id
        WHERE u.gh_id = $1 OR u.gh_username = $2;
        "#
    )
    .bind(u.id.to_string())
    .bind(&u.login)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn get_project_member_by_id(
    State(state): State<AppState>,
    Path((project_id, member_id)): Path<(SafeId, SafeId)>,
) -> Result<Json<ProjectMember>, AppError> {
    let row = sqlx::query_as::<_, ProjectMember>(
        r#"
        SELECT pm.id, pm.project_id, pm.user_id, pm.role, pm.kpi_score, pm.max_capacity, pm.current_load,
               COALESCE(pm.gh_username, u.gh_username) as gh_username,
               u.display_name,
               CASE 
                   WHEN COALESCE(pm.gh_username, u.gh_username) IS NOT NULL 
                   THEN 'https://github.com/' || COALESCE(pm.gh_username, u.gh_username) || '.png?size=64'
                   ELSE NULL
               END as avatar_url
        FROM opentask.project_member pm
        LEFT JOIN opentask.users u ON pm.user_id = u.id
        WHERE pm.project_id = $1 AND (pm.user_id = $2 OR pm.id = $2)
        LIMIT 1;
        "#
    )
    .bind(project_id.0)
    .bind(member_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Project member not found".to_string()))?;

    Ok(Json(row))
}
