use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::models::alert::DatabaseAlert;
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;

#[derive(Debug, Deserialize)]
pub struct UpdateAlertPayload {
    pub is_resolved: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AlertListQuery {
    pub user_id: Option<SafeId>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/alerts", get(list_all_alerts))
        .route("/users/{user_id}/alerts", get(list_user_alerts))
        .route("/alerts/{alert_id}", get(get_alert).put(update_alert))
}

pub async fn list_all_alerts(
    State(state): State<AppState>,
    Query(query): Query<AlertListQuery>,
) -> Result<Json<Vec<DatabaseAlert>>, AppError> {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);

    let rows = if let Some(uid) = query.user_id {
        sqlx::query_as::<_, DatabaseAlert>(
            r#"
            SELECT id, user_id, context_id, project_id,
                   title, description, type as alert_type, severity, suggested_actions, is_resolved, pr_url, created_at, updated_at
            FROM opentask.alerts
            WHERE user_id = $1 OR user_id IS NULL
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3;
            "#
        )
        .bind(uid.0)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, DatabaseAlert>(
            r#"
            SELECT id, user_id, context_id, project_id,
                   title, description, type as alert_type, severity, suggested_actions, is_resolved, pr_url, created_at, updated_at
            FROM opentask.alerts
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2;
            "#
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(rows))
}

pub async fn list_user_alerts(
    State(state): State<AppState>,
    Path(user_id): Path<SafeId>,
) -> Result<Json<Vec<DatabaseAlert>>, AppError> {
    let rows = sqlx::query_as::<_, DatabaseAlert>(
        r#"
        SELECT id, user_id, context_id, project_id,
               title, description, type as alert_type, severity, suggested_actions, is_resolved, pr_url, created_at, updated_at
        FROM opentask.alerts
        WHERE user_id = $1 OR user_id IS NULL
        ORDER BY created_at DESC;
        "#
    )
    .bind(user_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn get_alert(
    State(state): State<AppState>,
    Path(alert_id): Path<SafeId>,
) -> Result<Json<DatabaseAlert>, AppError> {
    let row = sqlx::query_as::<_, DatabaseAlert>(
        r#"
        SELECT id, user_id, context_id, project_id,
               title, description, type as alert_type, severity, suggested_actions, is_resolved, pr_url, created_at, updated_at
        FROM opentask.alerts
        WHERE id = $1
        LIMIT 1;
        "#
    )
    .bind(alert_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Alert {alert_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_alert(
    State(state): State<AppState>,
    Path(alert_id): Path<SafeId>,
    Json(payload): Json<UpdateAlertPayload>,
) -> Result<Json<DatabaseAlert>, AppError> {
    let row = sqlx::query_as::<_, DatabaseAlert>(
        r#"
        UPDATE opentask.alerts
        SET is_resolved = COALESCE($1, is_resolved),
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, user_id, context_id, project_id,
                  title, description, type as alert_type, severity, suggested_actions, is_resolved, pr_url, created_at, updated_at;
        "#
    )
    .bind(payload.is_resolved)
    .bind(alert_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Alert {alert_id} not found")))?;

    Ok(Json(row))
}
