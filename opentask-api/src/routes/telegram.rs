use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use sqlx::Row;

use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::routes::auth::AppState;
use crate::services::telegram::send_telegram_message;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/telegram/webhook", post(telegram_webhook))
        .route("/telegram/get-chat-id", get(get_chat_id))
}

pub async fn telegram_webhook(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> StatusCode {
    let message = &payload["message"];
    let chat_id = message["chat"]["id"].as_i64().map(|id| id.to_string());
    let text = message["text"].as_str().unwrap_or("").trim();

    if let (Some(cid), Some(bot_token)) = (chat_id, &state.config.telegram_bot_token) {
        if text.starts_with("/start") {
            let welcome = "👋 Welcome to *OpenTask Notifications*!\n\n\
                           Your Telegram Chat ID has been received.\n\
                           You will receive Stagnation Radar alerts and critical project updates here.";
            let _ = send_telegram_message(bot_token, &cid, welcome).await;
        }
    }

    StatusCode::OK
}

pub async fn get_chat_id(
    State(state): State<AppState>,
    CurrentUser(user, _token): CurrentUser,
) -> Result<Json<Value>, AppError> {
    let row = sqlx::query("SELECT telegram_chat_id FROM opentask.users WHERE gh_id = $1 OR gh_username = $2;")
        .bind(user.id.to_string())
        .bind(&user.login)
        .fetch_optional(&state.pool)
        .await?;

    let chat_id = row.and_then(|r| r.try_get::<Option<String>, _>("telegram_chat_id").ok()).flatten();

    Ok(Json(json!({
        "telegram_chat_id": chat_id,
        "is_linked": chat_id.is_some()
    })))
}
