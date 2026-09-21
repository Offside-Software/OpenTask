use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use sqlx::Row;

use crate::error::AppError;
use crate::models::bucket::{BucketReorderPayload, DatabaseBucket};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/buckets", post(create_bucket))
        .route("/buckets/{bucket_id}", put(update_bucket_direct))
        .route("/projects/{project_id}/buckets", get(list_buckets))
        .route("/projects/{project_id}/buckets/reorder", put(reorder_buckets))
        .route(
            "/projects/{project_id}/buckets/{bucket_id}",
            get(get_bucket).put(update_bucket).delete(delete_bucket),
        )
}

pub async fn create_bucket(
    State(state): State<AppState>,
    Json(payload): Json<DatabaseBucket>,
) -> Result<Json<DatabaseBucket>, AppError> {
    let bucket_id = next_id();
    let project_id = payload
        .project_id
        .ok_or_else(|| AppError::BadRequest("project_id is required".to_string()))?;

    let max_idx_row = sqlx::query("SELECT COALESCE(MAX(order_idx), -1) as max_idx FROM opentask.buckets WHERE project_id = $1;")
        .bind(project_id.0)
        .fetch_one(&state.pool)
        .await?;
    let max_idx: i32 = max_idx_row.try_get("max_idx").unwrap_or(-1);

    let order_idx = payload.order_idx.unwrap_or(max_idx + 1);
    let name = payload.name.unwrap_or_else(|| "Untitled".to_string());
    let state_str = payload.state.unwrap_or_else(|| "BACKLOG".to_string());

    let row = sqlx::query_as::<_, DatabaseBucket>(
        r#"
        INSERT INTO opentask.buckets (id, project_id, name, description, state, is_system_locked, order_idx, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id, project_id, name, description, state, is_system_locked, NULL::BIGINT as task_count, order_idx, created_at, updated_at;
        "#
    )
    .bind(bucket_id)
    .bind(project_id.0)
    .bind(name)
    .bind(payload.description)
    .bind(state_str)
    .bind(payload.is_system_locked.unwrap_or(false))
    .bind(order_idx)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

pub async fn list_buckets(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<DatabaseBucket>>, AppError> {
    let rows = sqlx::query_as::<_, DatabaseBucket>(
        r#"
        SELECT id, project_id, name, description, state, is_system_locked, NULL::BIGINT as task_count, order_idx, created_at, updated_at
        FROM opentask.buckets
        WHERE project_id = $1
        ORDER BY order_idx ASC;
        "#
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn get_bucket(
    State(state): State<AppState>,
    Path((_project_id, bucket_id)): Path<(SafeId, SafeId)>,
) -> Result<Json<DatabaseBucket>, AppError> {
    let row = sqlx::query_as::<_, DatabaseBucket>(
        r#"
        SELECT id, project_id, name, description, state, is_system_locked, NULL::BIGINT as task_count, order_idx, created_at, updated_at
        FROM opentask.buckets
        WHERE id = $1
        LIMIT 1;
        "#
    )
    .bind(bucket_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Bucket {bucket_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_bucket(
    State(state): State<AppState>,
    Path((_project_id, bucket_id)): Path<(SafeId, SafeId)>,
    Json(payload): Json<DatabaseBucket>,
) -> Result<Json<DatabaseBucket>, AppError> {
    let row = sqlx::query_as::<_, DatabaseBucket>(
        r#"
        UPDATE opentask.buckets
        SET name = COALESCE($1, name),
            description = COALESCE($2, description),
            state = COALESCE($3, state),
            order_idx = COALESCE($4, order_idx),
            updated_at = NOW()
        WHERE id = $5
        RETURNING id, project_id, name, description, state, is_system_locked, NULL::BIGINT as task_count, order_idx, created_at, updated_at;
        "#
    )
    .bind(payload.name)
    .bind(payload.description)
    .bind(payload.state)
    .bind(payload.order_idx)
    .bind(bucket_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Bucket {bucket_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_bucket_direct(
    State(state): State<AppState>,
    Path(bucket_id): Path<SafeId>,
    Json(payload): Json<DatabaseBucket>,
) -> Result<Json<DatabaseBucket>, AppError> {
    update_bucket(State(state), Path((SafeId(0), bucket_id)), Json(payload)).await
}

pub async fn delete_bucket(
    State(state): State<AppState>,
    Path((_project_id, bucket_id)): Path<(SafeId, SafeId)>,
) -> Result<StatusCode, AppError> {
    let locked_row = sqlx::query("SELECT is_system_locked FROM opentask.buckets WHERE id = $1;")
        .bind(bucket_id.0)
        .fetch_optional(&state.pool)
        .await?;

    let is_locked: bool = locked_row
        .and_then(|r| r.try_get("is_system_locked").ok())
        .unwrap_or(false);

    if is_locked {
        return Err(AppError::Forbidden("Cannot delete a system-locked bucket".to_string()));
    }

    let res = sqlx::query("DELETE FROM opentask.buckets WHERE id = $1;")
        .bind(bucket_id.0)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Bucket {bucket_id} not found")));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn reorder_buckets(
    State(state): State<AppState>,
    Path(_project_id): Path<SafeId>,
    Json(payload): Json<BucketReorderPayload>,
) -> Result<StatusCode, AppError> {
    let mut tx = state.pool.begin().await?;

    for item in payload.buckets {
        sqlx::query("UPDATE opentask.buckets SET order_idx = $1, updated_at = NOW() WHERE id = $2;")
            .bind(item.order_idx)
            .bind(item.id.0)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    Ok(StatusCode::OK)
}
