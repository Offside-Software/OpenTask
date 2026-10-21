use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::models::meeting::{
    CreateMeetingPayload, DatabaseMeeting, IntakeResponse, InviteBotPayload, JobStatus,
    MeetingDetailResponse, MeetingJob, MeetingJobResponse, MeetingStatus, SourceType, UpdateMeetingPayload,
    MEETING_COLUMNS, MEETING_JOB_COLUMNS,
};
use crate::models::safe_id::SafeId;
use crate::models::user::GitHubUserResponse;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;
use crate::services::meeting_pipeline::intake::{self, NewMeeting};
use crate::services::meeting_pipeline::{pipeline, recall};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/meetings", post(create_meeting))
        .route(
            "/meetings/{meeting_id}",
            get(get_meeting).put(update_meeting).delete(delete_meeting),
        )
        .route("/meetings/project/{project_id}", get(list_project_meetings))
        .route("/invite-bot", post(invite_bot))
        .route("/webhooks/recall", post(handle_recall_webhook))
}

/// Returns the caller's `opentask.users.id` when they are a member of the project.
pub async fn require_project_member(
    pool: &PgPool,
    user: &GitHubUserResponse,
    project_id: i64,
) -> Result<i64, AppError> {
    crate::db::query_scalar::<_, i64>(
        r#"
        SELECT u.id
        FROM opentask.project_member pm
        JOIN opentask.users u ON u.id = pm.user_id
        WHERE pm.project_id = $1
          AND (u.gh_id = $2 OR u.gh_username = $3)
        LIMIT 1;
        "#
    )
    .bind(project_id)
    .bind(user.id.to_string())
    .bind(&user.login)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::Forbidden("You are not a member of this project".to_string()))
}

async fn fetch_meeting(pool: &PgPool, meeting_id: i64) -> Result<DatabaseMeeting, AppError> {
    let sql = format!("SELECT {MEETING_COLUMNS} FROM opentask.meetings WHERE id = $1 LIMIT 1;");
    crate::db::query_as::<_, DatabaseMeeting>(&sql)
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Meeting {meeting_id} not found")))
}

/// Loads a meeting the caller may see. Returns it with its project id.
async fn fetch_member_meeting(
    pool: &PgPool,
    user: &GitHubUserResponse,
    meeting_id: i64,
) -> Result<(DatabaseMeeting, i64), AppError> {
    let meeting = fetch_meeting(pool, meeting_id).await?;
    let project_id = meeting
        .project_id
        .map(|p| p.0)
        .ok_or_else(|| AppError::NotFound(format!("Meeting {meeting_id} not found")))?;
    require_project_member(pool, user, project_id).await?;
    Ok((meeting, project_id))
}

pub async fn create_meeting(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Json(payload): Json<CreateMeetingPayload>,
) -> Result<Json<DatabaseMeeting>, AppError> {
    let project_id = payload.project_id.0;
    let user_id = require_project_member(&state.pool, &user, project_id).await?;
    let meeting_id = next_id();

    let sql = format!(
        r#"
        INSERT INTO opentask.meetings
            (id, project_id, created_by, title, date, time, duration, source_type, mom_summary, key_decisions,
             action_items, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        RETURNING {MEETING_COLUMNS};
        "#
    );
    let row = crate::db::query_as::<_, DatabaseMeeting>(&sql)
        .bind(meeting_id)
        .bind(project_id)
        .bind(user_id.to_string())
        .bind(payload.title)
        .bind(payload.date)
        .bind(payload.time)
        .bind(payload.duration)
        .bind(payload.source_type.unwrap_or(SourceType::Manual))
        .bind(payload.mom_summary)
        .bind(payload.key_decisions)
        .bind(payload.action_items)
        .bind(MeetingStatus::Completed)
        .fetch_one(&state.pool)
        .await?;

    state.realtime.publish(project_id, "meeting", "created", Some(meeting_id));
    Ok(Json(row))
}

pub async fn list_project_meetings(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<DatabaseMeeting>>, AppError> {
    require_project_member(&state.pool, &user, project_id.0).await?;

    let sql = format!(
        "SELECT {MEETING_COLUMNS} FROM opentask.meetings WHERE project_id = $1 ORDER BY created_at DESC;"
    );
    let rows = crate::db::query_as::<_, DatabaseMeeting>(&sql)
        .bind(project_id.0)
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(rows))
}

pub async fn get_meeting(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(meeting_id): Path<SafeId>,
) -> Result<Json<MeetingDetailResponse>, AppError> {
    let (meeting, _) = fetch_member_meeting(&state.pool, &user, meeting_id.0).await?;

    let sql = format!(
        "SELECT {MEETING_JOB_COLUMNS} FROM opentask.meeting_jobs WHERE meeting_id = $1 ORDER BY id DESC;"
    );
    let jobs = crate::db::query_as::<_, MeetingJob>(&sql)
        .bind(meeting_id.0)
        .fetch_all(&state.pool)
        .await?
        .into_iter()
        .map(MeetingJobResponse::from)
        .collect();

    Ok(Json(MeetingDetailResponse { meeting, jobs }))
}

pub async fn update_meeting(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(meeting_id): Path<SafeId>,
    Json(payload): Json<UpdateMeetingPayload>,
) -> Result<Json<DatabaseMeeting>, AppError> {
    let (_, project_id) = fetch_member_meeting(&state.pool, &user, meeting_id.0).await?;

    let sql = format!(
        r#"
        UPDATE opentask.meetings
        SET title = COALESCE($2, title),
            date = COALESCE($3, date),
            time = COALESCE($4, time),
            duration = COALESCE($5, duration),
            mom_summary = COALESCE($6, mom_summary),
            key_decisions = COALESCE($7, key_decisions),
            updated_at = NOW()
        WHERE id = $1
        RETURNING {MEETING_COLUMNS};
        "#
    );
    let row = crate::db::query_as::<_, DatabaseMeeting>(&sql)
        .bind(meeting_id.0)
        .bind(payload.title)
        .bind(payload.date)
        .bind(payload.time)
        .bind(payload.duration)
        .bind(payload.mom_summary)
        .bind(payload.key_decisions)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Meeting {meeting_id} not found")))?;

    state.realtime.publish(project_id, "meeting", "updated", Some(meeting_id.0));
    Ok(Json(row))
}

pub async fn delete_meeting(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(meeting_id): Path<SafeId>,
) -> Result<StatusCode, AppError> {
    let (meeting, project_id) = fetch_member_meeting(&state.pool, &user, meeting_id.0).await?;
    let stored: Vec<sqlx::types::Json<Vec<String>>> = crate::db::query_scalar(
        "SELECT r2_keys FROM opentask.meeting_jobs WHERE meeting_id = $1 AND r2_keys <> '[]'::jsonb;",
    )
    .bind(meeting_id.0)
    .fetch_all(&state.pool)
    .await?;

    let deleted_draft_ids = delete_meeting_and_drafts(&state.pool, meeting_id.0).await?;

    if let Some(store) = pipeline(&state.config).0.media_store.as_ref() {
        let keys: Vec<String> = stored.into_iter().flat_map(|k| k.0).collect();
        if !keys.is_empty() {
            tokio::spawn(async move { crate::services::meeting_pipeline::uploads::delete_objects(store, &keys).await });
        }
    }

    for task_id in &deleted_draft_ids {
        state.realtime.publish(project_id, "task", "deleted", Some(*task_id));
    }
    state.realtime.publish(project_id, "meeting", "deleted", Some(meeting_id.0));

    let _ = crate::routes::activities::record_project_event(
        &state.pool,
        project_id,
        None,
        Some(user.name.as_deref().unwrap_or(&user.login)),
        "deleted meeting",
        meeting.title.as_deref().unwrap_or("Untitled meeting"),
        "MEETING_DELETED",
        "MEETING",
        Some(meeting_id.0),
        Some(json!({ "deleted_draft_tasks": deleted_draft_ids.len() })),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_meeting_and_drafts(pool: &PgPool, meeting_id: i64) -> Result<Vec<i64>, AppError> {
    let mut tx = pool.begin().await?;

    crate::db::query_scalar::<_, i64>("SELECT id FROM opentask.meetings WHERE id = $1 FOR UPDATE;")
        .bind(meeting_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Meeting {meeting_id} not found")))?;

    // Locking the job rows keeps the worker (FOR UPDATE SKIP LOCKED) from claiming them meanwhile.
    let jobs = crate::db::query_as::<_, (JobStatus, bool)>(
        r#"
        SELECT status, COALESCE(locked_until > NOW(), FALSE)
        FROM opentask.meeting_jobs
        WHERE meeting_id = $1
        FOR UPDATE;
        "#
    )
    .bind(meeting_id)
    .fetch_all(&mut *tx)
    .await?;

    if jobs.iter().any(|(status, leased)| status.is_running() || *leased) {
        return Err(AppError::Conflict(
            "This meeting is still being processed. Delete it after its job finishes.".to_string(),
        ));
    }

    let deleted_draft_ids = crate::db::query_scalar::<_, i64>(
        r#"
        DELETE FROM opentask.tasks t
        USING opentask.buckets b
        WHERE t.bucket_id = b.id
          AND b.state = 'DRAFT'
          AND t.meeting_id = $1
        RETURNING t.id;
        "#
    )
    .bind(meeting_id)
    .fetch_all(&mut *tx)
    .await?;

    crate::db::query("DELETE FROM opentask.meetings WHERE id = $1;")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(deleted_draft_ids)
}

pub async fn invite_bot(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Json(payload): Json<InviteBotPayload>,
) -> Result<Json<IntakeResponse>, AppError> {
    let project_id = payload.project_id.0;
    let user_id = require_project_member(&state.pool, &user, project_id).await?;
    crate::services::meeting_pipeline::usage::check_project_quota(&state.pool, &pipeline(&state.config).0, project_id, None).await?;
    let requested: Vec<i64> = payload.attendee_ids.iter().map(|a| a.0).collect();
    let new = NewMeeting {
        project_id,
        created_by: user_id,
        title: payload
            .title
            .map(|t| t.trim().chars().take(200).collect::<String>())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "Live meeting".to_string()),
        source_type: SourceType::RecallBot,
        meeting_date: intake::parse_meeting_date(payload.meeting_date.as_deref())?,
        timezone: payload.timezone.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Asia/Jakarta".to_string()),
        attendee_ids: intake::member_ids(&state.pool, project_id, &requested).await?,
    };
    let bot_name = payload
        .bot_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "OpenTask Notetaker".to_string());
    let response =
        intake::create_recall_job(&state.pool, &state.config, &state.realtime, new, &payload.meeting_url, &bot_name)
            .await?;
    Ok(Json(response))
}

/// Recall bot polls to check whether the job is done
pub async fn handle_recall_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, AppError> {
    let secret = state
        .config
        .recall_webhook_secret
        .as_deref()
        .ok_or_else(|| AppError::Unauthorized("RECALL_WEBHOOK_SECRET is not configured".to_string()))?;
    if !recall::verify_webhook(secret, &headers, &body, chrono::Utc::now().timestamp()) {
        return Err(AppError::Unauthorized("Invalid webhook signature".to_string()));
    }
    let payload: Value =
        serde_json::from_slice(&body).map_err(|_| AppError::BadRequest("Invalid JSON".to_string()))?;
    let event = payload["event"].as_str().unwrap_or("");
    let bot_id = payload["data"]["bot"]["id"].as_str().unwrap_or("").to_string();
    tracing::info!("[Meeting Pipeline] Recall webhook {event} for bot {bot_id}");
    if bot_id.is_empty() {
        return Ok(Json(json!({ "status": "ignored" })));
    }

    if matches!(event, "bot.done" | "bot.fatal" | "recording.done" | "recording.failed") {
        let (pool, config, realtime) = (state.pool.clone(), state.config.clone(), state.realtime.clone());
        let cfg = &pipeline(&state.config).0;
        tokio::spawn(async move {
            if let Err(e) = intake::check_recall_bot(&pool, &config, &realtime, &bot_id, cfg).await {
                tracing::warn!("[Meeting Pipeline] Could not check Recall bot {bot_id}: {e}");
            }
        });
    }
    Ok(Json(json!({ "status": "ok" })))
}
