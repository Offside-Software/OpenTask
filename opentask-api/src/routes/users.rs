use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::safe_id::SafeId;
use crate::models::user::{DatabaseUser, UserUpdate};
use crate::routes::auth::AppState;

#[derive(Debug, Deserialize)]
pub struct UserListQuery {
    pub username: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", get(list_users))
        .route("/users/{user_id}",
            get(get_user_by_id).put(update_user_by_id).delete(delete_user_by_id),
        )
}

pub async fn list_users(
    State(state): State<AppState>,
    Query(query): Query<UserListQuery>,
) -> Result<Json<Vec<DatabaseUser>>, AppError> {
    let rows = if let Some(search) = query.username {
        let pattern = format!("%{search}%");
        sqlx::query_as::<_, DatabaseUser>(
            r#"
            SELECT id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key
            FROM opentask.users
            WHERE gh_username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1
            ORDER BY created_at DESC;
            "#
        )
        .bind(pattern)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, DatabaseUser>(
            r#"
            SELECT id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key
            FROM opentask.users
            ORDER BY created_at DESC;
            "#
        )
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(rows))
}

pub async fn get_user_by_id(
    State(state): State<AppState>,
    Path(user_id): Path<SafeId>,
) -> Result<Json<DatabaseUser>, AppError> {
    let row = sqlx::query_as::<_, DatabaseUser>(
        r#"
        SELECT id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key
        FROM opentask.users
        WHERE id = $1
        LIMIT 1;
        "#
    )
    .bind(user_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    Ok(Json(row))
}

pub async fn update_user_by_id(
    State(state): State<AppState>,
    Path(user_id): Path<SafeId>,
    Json(payload): Json<UserUpdate>,
) -> Result<Json<DatabaseUser>, AppError> {
    let row = sqlx::query_as::<_, DatabaseUser>(
        r#"
        UPDATE opentask.users
        SET display_name = COALESCE($1, display_name),
            telegram_chat_id = COALESCE($2, telegram_chat_id),
            gh_username = COALESCE($3, gh_username),
            gh_access_token = COALESCE($4, gh_access_token),
            gh_id = COALESCE($5, gh_id),
            email = COALESCE($6, email),
            custom_ai_api_key = COALESCE($7, custom_ai_api_key)
        WHERE id = $8
        RETURNING id, display_name, created_at, telegram_chat_id, gh_username, gh_access_token, gh_id::TEXT, email, custom_ai_api_key;
        "#
    )
    .bind(payload.display_name)
    .bind(payload.telegram_chat_id)
    .bind(payload.gh_username)
    .bind(payload.gh_access_token)
    .bind(payload.gh_id)
    .bind(payload.email)
    .bind(payload.custom_ai_api_key)
    .bind(user_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    Ok(Json(row))
}

pub async fn delete_user_by_id(
    State(state): State<AppState>,
    Path(user_id): Path<SafeId>,
) -> Result<Json<Value>, AppError> {
    let res = sqlx::query("DELETE FROM opentask.users WHERE id = $1;")
        .bind(user_id.0)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    Ok(Json(json!({ "id": user_id, "status": "deleted" })))
}
