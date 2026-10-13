use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
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
        .route("/telegram/test", post(test_telegram_notification))
}

pub async fn telegram_webhook(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> StatusCode {
    let bot_token = match &state.config.telegram_bot_token {
        Some(t) => t.as_str(),
        None => return StatusCode::OK,
    };

    if let Some(message) = payload.get("message") {
        if let (Some(cid), Some(text)) = (
            message["chat"]["id"].as_i64(),
            message["text"].as_str(),
        ) {
            crate::services::telegram::handle_incoming_telegram_message(
                &state.pool,
                bot_token,
                &cid.to_string(),
                text.trim(),
            )
            .await;
        }
    }

    if let Some(cb) = payload.get("callback_query") {
        if let (Some(qid), Some(data)) = (
            cb["id"].as_str(),
            cb["data"].as_str(),
        ) {
            let from_id = cb["from"]["id"].as_i64().unwrap_or(0);
            let message_id = cb["message"]["message_id"].as_i64();
            let chat_id = cb["message"]["chat"]["id"].as_i64().unwrap_or(from_id);
            let orig_text = cb["message"]["text"].as_str().unwrap_or("");

            crate::services::telegram::handle_telegram_callback_query(
                &state.pool,
                bot_token,
                qid,
                &chat_id.to_string(),
                message_id,
                orig_text,
                data,
            )
            .await;
        }
    }

    StatusCode::OK
}

pub async fn get_chat_id(
    State(state): State<AppState>,
    CurrentUser(user, _token): CurrentUser,
) -> Result<Json<Value>, AppError> {
    let row = crate::db::query("SELECT telegram_chat_id FROM opentask.users WHERE gh_id = $1 OR gh_username = $2;")
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

#[derive(Deserialize)]
pub struct TestTelegramPayload {
    pub message: Option<String>,
}

pub async fn test_telegram_notification(
    State(state): State<AppState>,
    CurrentUser(user, _token): CurrentUser,
    Json(payload): Json<TestTelegramPayload>,
) -> Result<Json<Value>, AppError> {
    let bot_token = state.config.telegram_bot_token.as_deref().ok_or_else(|| {
        AppError::BadRequest("TELEGRAM_BOT_TOKEN is not configured on server".to_string())
    })?;

    let row = crate::db::query("SELECT telegram_chat_id FROM opentask.users WHERE gh_id = $1 OR gh_username = $2;")
        .bind(user.id.to_string())
        .bind(&user.login)
        .fetch_optional(&state.pool)
        .await?;

    let chat_id = row
        .and_then(|r| r.try_get::<Option<String>, _>("telegram_chat_id").ok())
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("User does not have a linked Telegram Chat ID".to_string()))?;

    let default_msg = "🔔 *Test Notifikasi OpenTask*\n\nSistem notifikasi Telegram berhasil terhubung dan siap digunakan!".to_string();
    let text = payload.message.unwrap_or(default_msg);

    send_telegram_message(bot_token, &chat_id, &text).await?;

    Ok(Json(json!({
        "success": true,
        "chat_id": chat_id,
        "message": "Test notification sent successfully"
    })))
}
