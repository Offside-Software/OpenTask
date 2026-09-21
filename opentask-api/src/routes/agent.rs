use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

use crate::error::AppError;
use crate::extractors::project_key::ProjectContext;
use crate::models::task::DatabaseTask;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct CreateAgentTaskPayload {
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub weight: Option<i32>,
    pub branch_name: Option<String>,
    pub repo_url: Option<String>,
    pub bucket_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MoveTaskPayload {
    pub bucket_name: Option<String>,
    pub bucket_state: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LookupTaskPayload {
    pub query: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", axum::routing::get(list_agent_tasks).post(create_agent_task))
        .route("/tasks/lookup", post(lookup_agent_task))
        .route("/tasks/{task_identifier}", axum::routing::get(get_agent_task).patch(update_agent_task))
        .route("/tasks/{task_identifier}/complete", post(complete_agent_task))
        .route("/tasks/{task_identifier}/move", post(move_agent_task))
        .route("/summary", axum::routing::get(agent_summary))
}

pub fn parse_task_id(identifier: &str) -> Result<i64, AppError> {
    let cleaned = identifier.trim();
    if let Ok(id) = cleaned.parse::<i64>() {
        return Ok(id);
    }

    // Markdown link [Title](#123456) or #123456
    let hash_re = Regex::new(r"#(\d+)").unwrap();
    if let Some(caps) = hash_re.captures(cleaned) {
        if let Ok(id) = caps[1].parse::<i64>() {
            return Ok(id);
        }
    }

    // Query string taskId=123456
    let param_re = Regex::new(r"taskId=(\d+)").unwrap();
    if let Some(caps) = param_re.captures(cleaned) {
        if let Ok(id) = caps[1].parse::<i64>() {
            return Ok(id);
        }
    }

    // Contiguous snowflake digits (15-20 digits)
    let digit_re = Regex::new(r"\b(\d{15,20})\b").unwrap();
    if let Some(caps) = digit_re.captures(cleaned) {
        if let Ok(id) = caps[1].parse::<i64>() {
            return Ok(id);
        }
    }

    Err(AppError::BadRequest(format!(
        "Could not extract a valid Snowflake Task ID from '{identifier}'"
    )))
}

pub async fn get_agent_task(
    State(state): State<AppState>,
    project: ProjectContext,
    Path(identifier): Path<String>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task_id = parse_task_id(&identifier)?;

    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE id = $1 AND project_id = $2
        LIMIT 1;
        "#
    )
    .bind(task_id)
    .bind(project.id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found in project {}", project.id)))?;

    Ok(Json(row))
}

pub async fn list_agent_tasks(
    State(state): State<AppState>,
    project: ProjectContext,
) -> Result<Json<Vec<DatabaseTask>>, AppError> {
    let rows = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE project_id = $1
        ORDER BY order_idx ASC;
        "#
    )
    .bind(project.id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn create_agent_task(
    State(state): State<AppState>,
    project: ProjectContext,
    Json(payload): Json<CreateAgentTaskPayload>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task_id = next_id();

    // Resolve bucket
    let bucket_id: i64 = if let Some(name) = payload.bucket_name {
        let b = sqlx::query("SELECT id FROM opentask.buckets WHERE project_id = $1 AND (name ILIKE $2 OR state ILIKE $2) LIMIT 1;")
            .bind(project.id.0)
            .bind(name)
            .fetch_optional(&state.pool)
            .await?;
        b.and_then(|r| r.try_get("id").ok()).unwrap_or(1)
    } else {
        let b = sqlx::query("SELECT id FROM opentask.buckets WHERE project_id = $1 AND state = 'DRAFT' LIMIT 1;")
            .bind(project.id.0)
            .fetch_optional(&state.pool)
            .await?;
        b.and_then(|r| r.try_get("id").ok()).unwrap_or(1)
    };

    let max_idx_row = sqlx::query("SELECT COALESCE(MAX(order_idx), -1) as max_idx FROM opentask.tasks WHERE bucket_id = $1;")
        .bind(bucket_id)
        .fetch_one(&state.pool)
        .await?;
    let max_idx: i32 = max_idx_row.try_get("max_idx").unwrap_or(-1);

    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        INSERT INTO opentask.tasks
            (id, project_id, bucket_id, title, description, type, weight, branch_name, repo_url, order_idx, last_activity_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())
        RETURNING id, project_id, bucket_id, meeting_id,
                  parent_task_id, lead_assignee_id, suggested_assignee_id,
                  title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at;
        "#
    )
    .bind(task_id)
    .bind(project.id.0)
    .bind(bucket_id)
    .bind(payload.title)
    .bind(payload.description)
    .bind(payload.task_type.unwrap_or_else(|| "CODE".to_string()))
    .bind(payload.weight.unwrap_or(1))
    .bind(payload.branch_name)
    .bind(payload.repo_url)
    .bind(max_idx + 1)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

pub async fn complete_agent_task(
    State(state): State<AppState>,
    project: ProjectContext,
    Path(identifier): Path<String>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task_id = parse_task_id(&identifier)?;

    // Find COMPLETED or DONE bucket
    let completed_bucket_row = sqlx::query(
        r#"
        SELECT id FROM opentask.buckets
        WHERE project_id = $1 AND (state = 'COMPLETED' OR state = 'DONE' OR name ILIKE '%done%' OR name ILIKE '%complete%')
        ORDER BY order_idx DESC
        LIMIT 1;
        "#
    )
    .bind(project.id.0)
    .fetch_optional(&state.pool)
    .await?;

    let completed_bucket_id: i64 = completed_bucket_row
        .and_then(|r| r.try_get("id").ok())
        .ok_or_else(|| AppError::Internal("No completed bucket found in project".to_string()))?;

    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        UPDATE opentask.tasks
        SET bucket_id = $1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $2 AND project_id = $3
        RETURNING id, project_id, bucket_id, meeting_id,
                  parent_task_id, lead_assignee_id, suggested_assignee_id,
                  title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at;
        "#
    )
    .bind(completed_bucket_id)
    .bind(task_id)
    .bind(project.id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found")))?;

    Ok(Json(row))
}

pub async fn move_agent_task(
    State(state): State<AppState>,
    project: ProjectContext,
    Path(identifier): Path<String>,
    Json(payload): Json<MoveTaskPayload>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task_id = parse_task_id(&identifier)?;

    let target_name = payload.bucket_name.as_deref().unwrap_or("");
    let target_state = payload.bucket_state.as_deref().unwrap_or("");

    let bucket_row = sqlx::query(
        r#"
        SELECT id FROM opentask.buckets
        WHERE project_id = $1 AND (name ILIKE $2 OR state ILIKE $3)
        LIMIT 1;
        "#
    )
    .bind(project.id.0)
    .bind(target_name)
    .bind(target_state)
    .fetch_optional(&state.pool)
    .await?;

    let bucket_id: i64 = bucket_row
        .and_then(|r| r.try_get("id").ok())
        .ok_or_else(|| AppError::NotFound("Target bucket not found".to_string()))?;

    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        UPDATE opentask.tasks
        SET bucket_id = $1,
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $2 AND project_id = $3
        RETURNING id, project_id, bucket_id, meeting_id,
                  parent_task_id, lead_assignee_id, suggested_assignee_id,
                  title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at;
        "#
    )
    .bind(bucket_id)
    .bind(task_id)
    .bind(project.id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_agent_task(
    State(state): State<AppState>,
    project: ProjectContext,
    Path(identifier): Path<String>,
    Json(payload): Json<DatabaseTask>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task_id = parse_task_id(&identifier)?;

    let row = sqlx::query_as::<_, DatabaseTask>(
        r#"
        UPDATE opentask.tasks
        SET title = COALESCE($1, title),
            description = COALESCE($2, description),
            type = COALESCE($3, type),
            weight = COALESCE($4, weight),
            branch_name = COALESCE($5, branch_name),
            repo_url = COALESCE($6, repo_url),
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $7 AND project_id = $8
        RETURNING id, project_id, bucket_id, meeting_id,
                  parent_task_id, lead_assignee_id, suggested_assignee_id,
                  title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at;
        "#
    )
    .bind(payload.title)
    .bind(payload.description)
    .bind(payload.task_type)
    .bind(payload.weight)
    .bind(payload.branch_name)
    .bind(payload.repo_url)
    .bind(task_id)
    .bind(project.id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Task {task_id} not found")))?;

    Ok(Json(row))
}

pub async fn lookup_agent_task(
    State(state): State<AppState>,
    project: ProjectContext,
    Json(payload): Json<LookupTaskPayload>,
) -> Result<Json<Vec<DatabaseTask>>, AppError> {
    let pattern = format!("%{}%", payload.query.trim());

    let rows = sqlx::query_as::<_, DatabaseTask>(
        r#"
        SELECT id, project_id, bucket_id, meeting_id,
               parent_task_id, lead_assignee_id, suggested_assignee_id,
               title, description, type as task_type, weight, branch_name, repo_url, last_activity_at, order_idx, created_at, updated_at
        FROM opentask.tasks
        WHERE project_id = $1 AND (title ILIKE $2 OR description ILIKE $2)
        ORDER BY updated_at DESC
        LIMIT 10;
        "#
    )
    .bind(project.id.0)
    .bind(pattern)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn agent_summary(
    State(state): State<AppState>,
    project: ProjectContext,
) -> Result<Json<serde_json::Value>, AppError> {
    let count_row = sqlx::query("SELECT COUNT(*) as count FROM opentask.tasks WHERE project_id = $1;")
        .bind(project.id.0)
        .fetch_one(&state.pool)
        .await?;
    let total_tasks: i64 = count_row.try_get("count").unwrap_or(0);

    let active_buckets = sqlx::query("SELECT id, name, state FROM opentask.buckets WHERE project_id = $1 ORDER BY order_idx ASC;")
        .bind(project.id.0)
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(json!({
        "project_id": project.id,
        "project_name": project.name,
        "total_tasks": total_tasks,
        "buckets": active_buckets.into_iter().map(|b| {
            let id: i64 = b.try_get("id").unwrap_or(0);
            let name: String = b.try_get("name").unwrap_or_default();
            let state: String = b.try_get("state").unwrap_or_default();
            json!({
                "id": id.to_string(),
                "name": name,
                "state": state
            })
        }).collect::<Vec<_>>()
    })))
}
