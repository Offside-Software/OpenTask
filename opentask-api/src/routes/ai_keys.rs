use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use sqlx::Row;

use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::models::ai_key::{ApiKeyStatusResponse, SetApiKeyRequest, TestKeyRequest, TestKeyResponse};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::gemini::{mask_api_key, test_gemini_api_key};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ai/test-key", post(test_key))
        .route(
            "/projects/{project_id}/ai-key",
            get(get_project_ai_key).post(set_project_ai_key).delete(delete_project_ai_key),
        )
        .route(
            "/users/me/ai-key",
            get(get_user_ai_key).post(set_user_ai_key).delete(delete_user_ai_key),
        )
}

pub async fn test_key(Json(payload): Json<TestKeyRequest>) -> Json<TestKeyResponse> {
    let res = test_gemini_api_key(&payload.api_key).await;
    Json(res)
}

pub async fn get_project_ai_key(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<ApiKeyStatusResponse>, AppError> {
    let row = sqlx::query("SELECT custom_ai_api_key FROM opentask.projects WHERE id = $1;")
        .bind(project_id.0)
        .fetch_optional(&state.pool)
        .await?;

    let key = row.and_then(|r| r.try_get::<Option<String>, _>("custom_ai_api_key").ok()).flatten();
    let masked = key.as_deref().and_then(mask_api_key);
    let has_key = masked.is_some();

    Ok(Json(ApiKeyStatusResponse {
        has_key,
        masked_key: masked,
        source: if has_key { "project".to_string() } else { "none".to_string() },
    }))
}

pub async fn set_project_ai_key(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Json(payload): Json<SetApiKeyRequest>,
) -> Result<Json<TestKeyResponse>, AppError> {
    let test_res = test_gemini_api_key(&payload.api_key).await;
    if !test_res.valid {
        return Err(AppError::BadRequest(
            test_res.error.unwrap_or_else(|| "Invalid Gemini API key".to_string()),
        ));
    }

    sqlx::query("UPDATE opentask.projects SET custom_ai_api_key = $1, updated_at = NOW() WHERE id = $2;")
        .bind(payload.api_key.trim())
        .bind(project_id.0)
        .execute(&state.pool)
        .await?;

    Ok(Json(test_res))
}

pub async fn delete_project_ai_key(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<StatusCode, AppError> {
    sqlx::query("UPDATE opentask.projects SET custom_ai_api_key = NULL, updated_at = NOW() WHERE id = $1;")
        .bind(project_id.0)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_user_ai_key(
    State(state): State<AppState>,
    CurrentUser(user, _token): CurrentUser,
) -> Result<Json<ApiKeyStatusResponse>, AppError> {
    let row = sqlx::query("SELECT custom_ai_api_key FROM opentask.users WHERE gh_id = $1 OR gh_username = $2;")
        .bind(user.id.to_string())
        .bind(&user.login)
        .fetch_optional(&state.pool)
        .await?;

    let key = row.and_then(|r| r.try_get::<Option<String>, _>("custom_ai_api_key").ok()).flatten();
    let masked = key.as_deref().and_then(mask_api_key);
    let has_key = masked.is_some();

    Ok(Json(ApiKeyStatusResponse {
        has_key,
        masked_key: masked,
        source: if has_key { "user".to_string() } else { "none".to_string() },
    }))
}

pub async fn set_user_ai_key(
    State(state): State<AppState>,
    CurrentUser(user, _token): CurrentUser,
    Json(payload): Json<SetApiKeyRequest>,
) -> Result<Json<TestKeyResponse>, AppError> {
    let test_res = test_gemini_api_key(&payload.api_key).await;
    if !test_res.valid {
        return Err(AppError::BadRequest(
            test_res.error.unwrap_or_else(|| "Invalid Gemini API key".to_string()),
        ));
    }

    sqlx::query("UPDATE opentask.users SET custom_ai_api_key = $1 WHERE gh_id = $2 OR gh_username = $3;")
        .bind(payload.api_key.trim())
        .bind(user.id.to_string())
        .bind(&user.login)
        .execute(&state.pool)
        .await?;

    Ok(Json(test_res))
}

pub async fn delete_user_ai_key(
    State(state): State<AppState>,
    CurrentUser(user, _token): CurrentUser,
) -> Result<StatusCode, AppError> {
    sqlx::query("UPDATE opentask.users SET custom_ai_api_key = NULL WHERE gh_id = $1 OR gh_username = $2;")
        .bind(user.id.to_string())
        .bind(&user.login)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
