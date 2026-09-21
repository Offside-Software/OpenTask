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
use crate::extractors::auth::OptionalCurrentUser;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct PushSubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Debug, Deserialize)]
pub struct PushSubscriptionPayload {
    pub endpoint: String,
    pub keys: PushSubscriptionKeys,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/notifications/vapid-public-key", get(get_vapid_public_key))
        .route("/notifications/subscribe", post(subscribe_push))
        .route("/notifications/test", post(test_push))
        .route("/vapid-public-key", get(get_vapid_public_key))
        .route("/subscribe", post(subscribe_push))
        .route("/test", post(test_push))
}

pub async fn get_vapid_public_key(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "publicKey": state.config.vapid_public_key,
        "public_key": state.config.vapid_public_key
    }))
}

pub async fn subscribe_push(
    State(state): State<AppState>,
    OptionalCurrentUser(user): OptionalCurrentUser,
    Json(payload): Json<PushSubscriptionPayload>,
) -> Result<StatusCode, AppError> {
    let user_id = match user {
        Some(u) => {
            let row = sqlx::query("SELECT id FROM opentask.users WHERE gh_id = $1 OR gh_username = $2;")
                .bind(u.id.to_string())
                .bind(&u.login)
                .fetch_optional(&state.pool)
                .await?;
            row.and_then(|r| r.try_get::<i64, _>("id").ok()).unwrap_or(0)
        }
        None => 0,
    };

    let sub_id = next_id();
    sqlx::query(
        r#"
        INSERT INTO opentask.push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            updated_at = NOW();
        "#
    )
    .bind(sub_id)
    .bind(user_id)
    .bind(payload.endpoint)
    .bind(payload.keys.p256dh)
    .bind(payload.keys.auth)
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::CREATED)
}

pub async fn test_push() -> Json<Value> {
    Json(json!({ "message": "Push notification test endpoint reached" }))
}
