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
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services;
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
    pub user_id: Option<SafeId>,
}

#[derive(Debug, Deserialize, Default)]
pub struct TestNotificationPayload {
    pub title: Option<String>,
    pub body: Option<String>,
    pub url: Option<String>,
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
) -> Result<(StatusCode, Json<Value>), AppError> {
    let mut resolved_user_id: Option<i64> = None;

    if let Some(u) = user {
        let row = sqlx::query("SELECT id FROM opentask.users WHERE gh_id = $1 OR gh_username = $2 LIMIT 1;")
            .bind(u.id.to_string())
            .bind(&u.login)
            .fetch_optional(&state.pool)
            .await?;
        if let Some(r) = row {
            resolved_user_id = r.try_get::<i64, _>("id").ok();
        }
    }

    if resolved_user_id.is_none() {
        if let Some(uid) = payload.user_id {
            if uid.0 > 0 {
                resolved_user_id = Some(uid.0);
            }
        }
    }

    let sub_id = next_id();
    sqlx::query(
        r#"
        INSERT INTO opentask.push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (endpoint) DO UPDATE
        SET user_id = COALESCE(EXCLUDED.user_id, opentask.push_subscriptions.user_id),
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            updated_at = NOW();
        "#
    )
    .bind(sub_id)
    .bind(resolved_user_id)
    .bind(&payload.endpoint)
    .bind(&payload.keys.p256dh)
    .bind(&payload.keys.auth)
    .execute(&state.pool)
    .await?;

    tracing::info!("[NOTIFICATIONS] Saved push subscription for user: {:?}", resolved_user_id);
    Ok((StatusCode::CREATED, Json(json!({ "status": "subscribed" }))))
}

pub async fn test_push(
    State(state): State<AppState>,
    OptionalCurrentUser(user): OptionalCurrentUser,
    payload_opt: Option<Json<TestNotificationPayload>>,
) -> Result<Json<Value>, AppError> {
    let mut target_user_id: Option<i64> = None;

    if let Some(u) = user {
        let row = sqlx::query("SELECT id FROM opentask.users WHERE gh_id = $1 OR gh_username = $2 LIMIT 1;")
            .bind(u.id.to_string())
            .bind(&u.login)
            .fetch_optional(&state.pool)
            .await?;
        if let Some(r) = row {
            target_user_id = r.try_get::<i64, _>("id").ok();
        }
    }

    // Fallback if session user wasn't resolved: look for the most recently active push subscriber
    if target_user_id.is_none() {
        let sub_row = sqlx::query("SELECT user_id FROM opentask.push_subscriptions WHERE user_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1;")
            .fetch_optional(&state.pool)
            .await?;
        if let Some(r) = sub_row {
            target_user_id = r.try_get::<i64, _>("user_id").ok();
        }
    }

    let uid = match target_user_id {
        Some(id) => id,
        None => {
            return Ok(Json(json!({
                "status": "warning",
                "message": "No active device subscriptions found for your account. Please click 'Enable Web Push' first.",
                "delivered": 0,
                "total": 0
            })));
        }
    };

    let payload = payload_opt.map(|p| p.0).unwrap_or_default();
    let title = payload.title.as_deref().unwrap_or("OpenTask Push Verification");
    let body = payload.body.as_deref().unwrap_or("Push notification alert pipeline is active and verified!");
    let url = payload.url.as_deref().unwrap_or("/notifications");

    let (delivered, total) = services::notifications::send_push_notification(
        &state.pool,
        &state.config,
        uid,
        title,
        body,
        url,
        "test-alert",
    )
    .await?;

    // Record persistent alert in opentask.alerts for in-app display
    let test_alert_id = next_id();
    let _ = sqlx::query(
        r#"
        INSERT INTO opentask.alerts (
            id, user_id, context_id, project_id, title, description,
            type, severity, suggested_actions, is_resolved, created_at, updated_at
        ) VALUES (
            $1, $2, NULL, NULL, $3, $4,
            'SYSTEM_TEST', 'info', ARRAY['Acknowledge'], FALSE, NOW(), NOW()
        );
        "#
    )
    .bind(test_alert_id)
    .bind(uid)
    .bind(title)
    .bind(body)
    .execute(&state.pool)
    .await;

    if total == 0 {
        return Ok(Json(json!({
            "status": "warning",
            "message": "No active device subscriptions found for your account. Please click 'Enable Web Push' first.",
            "delivered": 0,
            "total": 0
        })));
    }

    if delivered == 0 {
        return Ok(Json(json!({
            "status": "error",
            "message": format!("Found {} subscription(s), but delivery failed. Please click 'Enable Web Push' again to refresh your device subscription.", total),
            "delivered": 0,
            "total": total
        })));
    }

    Ok(Json(json!({
        "status": "success",
        "message": format!("Push alert dispatched to {} active device(s).", delivered),
        "delivered": delivered,
        "total": total
    })))
}
