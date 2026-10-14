use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::error::AppError;
use crate::extractors::auth::OptionalCurrentUser;
use crate::models::feedback::{
    CreateFeedbackPayload, Feedback, FeedbackQuery, UpdateFeedbackPayload,
};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/feedback", post(create_feedback).get(list_feedbacks))
        .route(
            "/feedback/{feedback_id}",
            get(get_feedback)
                .patch(update_feedback)
                .put(update_feedback)
                .delete(delete_feedback),
        )
}

pub async fn create_feedback(
    State(state): State<AppState>,
    OptionalCurrentUser(current_user): OptionalCurrentUser,
    Json(payload): Json<CreateFeedbackPayload>,
) -> Result<(StatusCode, Json<Feedback>), AppError> {
    if payload.description.trim().is_empty() {
        return Err(AppError::BadRequest("Feedback description cannot be empty".to_string()));
    }

    let feedback_id = next_id();

    // Resolve user details if authenticated
    let mut resolved_user_id: Option<i64> = None;
    let mut resolved_user_name = payload.user_name;
    let mut resolved_user_email = payload.user_email;

    if let Some(gh_user) = current_user {
        if resolved_user_name.is_none() {
            resolved_user_name = gh_user.name.clone().or_else(|| Some(gh_user.login.clone()));
        }
        if resolved_user_email.is_none() {
            resolved_user_email = gh_user.email.clone();
        }

        // Try to link to database user by GitHub ID
        let gh_id_str = gh_user.id.to_string();
        let db_user_id = crate::db::query_scalar::<sqlx::Postgres, i64>(
            r#"SELECT id FROM opentask.users WHERE gh_id = $1 LIMIT 1;"#
        )
        .bind(gh_id_str)
        .fetch_optional(&state.pool)
        .await?;

        resolved_user_id = db_user_id;
    }

    let feedback_type = payload
        .feedback_type
        .unwrap_or_else(|| "FEEDBACK".to_string())
        .to_uppercase();

    let category = payload
        .category
        .unwrap_or_else(|| "GENERAL".to_string())
        .to_uppercase();

    let device_info = payload.device_info.unwrap_or_else(|| json!({}));

    let row = crate::db::query_as::<_, Feedback>(
        r#"
        INSERT INTO opentask.feedbacks (
            id, user_id, user_name, user_email, feedback_type,
            category, rating, title, description, device_info,
            status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', NOW(), NOW())
        RETURNING id, user_id, user_name, user_email, feedback_type,
                  category, rating, title, description, device_info,
                  status, created_at, updated_at;
        "#,
    )
    .bind(feedback_id)
    .bind(resolved_user_id)
    .bind(resolved_user_name)
    .bind(resolved_user_email)
    .bind(feedback_type)
    .bind(category)
    .bind(payload.rating)
    .bind(payload.title)
    .bind(payload.description.trim())
    .bind(device_info)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn list_feedbacks(
    State(state): State<AppState>,
    Query(query): Query<FeedbackQuery>,
) -> Result<Json<Vec<Feedback>>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let rows = match (&query.status, &query.feedback_type) {
        (Some(status), Some(fb_type)) => {
            crate::db::query_as::<_, Feedback>(
                r#"
                SELECT id, user_id, user_name, user_email, feedback_type,
                       category, rating, title, description, device_info,
                       status, created_at, updated_at
                FROM opentask.feedbacks
                WHERE status = $1 AND feedback_type = $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4;
                "#,
            )
            .bind(status.to_uppercase())
            .bind(fb_type.to_uppercase())
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        (Some(status), None) => {
            crate::db::query_as::<_, Feedback>(
                r#"
                SELECT id, user_id, user_name, user_email, feedback_type,
                       category, rating, title, description, device_info,
                       status, created_at, updated_at
                FROM opentask.feedbacks
                WHERE status = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3;
                "#,
            )
            .bind(status.to_uppercase())
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        (None, Some(fb_type)) => {
            crate::db::query_as::<_, Feedback>(
                r#"
                SELECT id, user_id, user_name, user_email, feedback_type,
                       category, rating, title, description, device_info,
                       status, created_at, updated_at
                FROM opentask.feedbacks
                WHERE feedback_type = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3;
                "#,
            )
            .bind(fb_type.to_uppercase())
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
        (None, None) => {
            crate::db::query_as::<_, Feedback>(
                r#"
                SELECT id, user_id, user_name, user_email, feedback_type,
                       category, rating, title, description, device_info,
                       status, created_at, updated_at
                FROM opentask.feedbacks
                ORDER BY created_at DESC
                LIMIT $1 OFFSET $2;
                "#,
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
        }
    };

    Ok(Json(rows))
}

pub async fn get_feedback(
    State(state): State<AppState>,
    Path(feedback_id): Path<SafeId>,
) -> Result<Json<Feedback>, AppError> {
    let row = crate::db::query_as::<_, Feedback>(
        r#"
        SELECT id, user_id, user_name, user_email, feedback_type,
               category, rating, title, description, device_info,
               status, created_at, updated_at
        FROM opentask.feedbacks
        WHERE id = $1
        LIMIT 1;
        "#,
    )
    .bind(feedback_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Feedback {feedback_id} not found")))?;

    Ok(Json(row))
}

pub async fn update_feedback(
    State(state): State<AppState>,
    Path(feedback_id): Path<SafeId>,
    Json(payload): Json<UpdateFeedbackPayload>,
) -> Result<Json<Feedback>, AppError> {
    let status = payload
        .status
        .map(|s| s.to_uppercase())
        .unwrap_or_else(|| "REVIEWED".to_string());

    let row = crate::db::query_as::<_, Feedback>(
        r#"
        UPDATE opentask.feedbacks
        SET status = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING id, user_id, user_name, user_email, feedback_type,
                  category, rating, title, description, device_info,
                  status, created_at, updated_at;
        "#,
    )
    .bind(status)
    .bind(feedback_id.0)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Feedback {feedback_id} not found")))?;

    Ok(Json(row))
}

pub async fn delete_feedback(
    State(state): State<AppState>,
    Path(feedback_id): Path<SafeId>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = crate::db::query(
        r#"
        DELETE FROM opentask.feedbacks
        WHERE id = $1;
        "#,
    )
    .bind(feedback_id.0)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("Feedback {feedback_id} not found")));
    }

    Ok(Json(json!({
        "success": true,
        "message": format!("Feedback {feedback_id} deleted successfully")
    })))
}
