use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::models::meeting::{
    ApproveDraftsPayload, CreateTextJobPayload, IntakeResponse, MeetingJobDetail, MeetingJobSummary,
    RejectDraftsPayload, ReviewResult, SourceType,
};
use crate::models::safe_id::SafeId;
use crate::models::user::GitHubUserResponse;
use crate::routes::auth::AppState;
use crate::routes::meetings::require_project_member;
use crate::services::meeting_pipeline::intake::{self, NewMeeting};
use crate::services::meeting_pipeline::review::{self, ReviewOutcome};
use crate::services::meeting_pipeline::pipeline;

#[derive(Debug, Deserialize)]
pub struct JobListQuery {
    pub project_id: SafeId,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/meeting-jobs/text",
            post(create_text_job).layer(DefaultBodyLimit::max(4 * 1024 * 1024)),
        )
        .route("/meeting-jobs", get(list_jobs))
        .route("/meeting-jobs/{job_id}", get(get_job))
        .route("/meeting-jobs/{job_id}/transcript", get(get_transcript))
        .route("/meeting-jobs/{job_id}/drafts/approve", post(approve_drafts))
        .route("/meeting-jobs/{job_id}/drafts/reject", post(reject_drafts))
}

/// Checks access to a job; returns its project and the caller's user id.
async fn member_job(state: &AppState, user: &GitHubUserResponse, job_id: i64) -> Result<(i64, i64), AppError> {
    let project_id = review::job_project(&state.pool, job_id).await?;
    let user_id = require_project_member(&state.pool, user, project_id).await?;
    Ok((project_id, user_id))
}

pub async fn create_text_job(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Json(payload): Json<CreateTextJobPayload>,
) -> Result<Json<IntakeResponse>, AppError> {
    let project_id = payload.project_id.0;
    let user_id = require_project_member(&state.pool, &user, project_id).await?;
    let requested: Vec<i64> = payload.attendee_ids.iter().map(|a| a.0).collect();
    let new = NewMeeting {
        project_id,
        created_by: user_id,
        title: payload
            .title
            .map(|t| t.trim().chars().take(200).collect::<String>())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| "Uploaded notes".to_string()),
        source_type: SourceType::Text,
        meeting_date: intake::parse_meeting_date(payload.meeting_date.as_deref())?,
        timezone: payload.timezone.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Asia/Jakarta".to_string()),
        attendee_ids: intake::member_ids(&state.pool, project_id, &requested).await?,
    };
    let (cfg, llm) = pipeline(&state.config);
    let response = intake::create_text_job(&state.pool, &state.realtime, cfg, llm.as_ref(), new, &payload.text).await?;
    Ok(Json(response))
}

pub async fn list_jobs(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Query(query): Query<JobListQuery>,
) -> Result<Json<Vec<MeetingJobSummary>>, AppError> {
    let project_id = query.project_id.0;
    require_project_member(&state.pool, &user, project_id).await?;
    sync_review(&state, project_id, None).await?;
    Ok(Json(review::list_jobs(&state.pool, project_id).await?))
}

pub async fn get_job(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(job_id): Path<SafeId>,
) -> Result<Json<MeetingJobDetail>, AppError> {
    let (project_id, _) = member_job(&state, &user, job_id.0).await?;
    sync_review(&state, project_id, Some(job_id.0)).await?;
    Ok(Json(review::job_detail(&state.pool, job_id.0).await?))
}

/// Catches up on drafts moved on the board and tells the project's other viewers.
async fn sync_review(state: &AppState, project_id: i64, job_id: Option<i64>) -> Result<(), AppError> {
    for changed in review::sync_review_status(&state.pool, Some(project_id), job_id).await? {
        state.realtime.publish(project_id, "meeting_job", "updated", Some(changed));
    }
    Ok(())
}

pub async fn get_transcript(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(job_id): Path<SafeId>,
) -> Result<Json<Value>, AppError> {
    member_job(&state, &user, job_id.0).await?;
    let (language, segments) = review::transcript(&state.pool, job_id.0).await?;
    Ok(Json(json!({ "language": language, "segments": segments })))
}

fn after_review(state: &AppState, project_id: i64, job_id: i64, outcome: &ReviewOutcome) {
    if let Some(bucket_id) = outcome.archived_bucket_id {
        state.realtime.publish(project_id, "bucket", "updated", Some(bucket_id));
    }
    for (task_id, _, _) in &outcome.moved {
        state.realtime.publish(project_id, "task", "updated", Some(*task_id));
    }
    state.realtime.publish(project_id, "meeting_job", "updated", Some(job_id));
}

fn review_result(outcome: ReviewOutcome) -> ReviewResult {
    ReviewResult {
        job: outcome.job,
        moved_task_ids: outcome.moved.iter().map(|(id, _, _)| SafeId(*id)).collect(),
        pending_drafts: outcome.pending_drafts,
    }
}

pub async fn approve_drafts(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(job_id): Path<SafeId>,
    Json(payload): Json<ApproveDraftsPayload>,
) -> Result<Json<ReviewResult>, AppError> {
    let (project_id, user_id) = member_job(&state, &user, job_id.0).await?;
    let outcome = review::approve(&state.pool, job_id.0, project_id, &payload.items).await?;
    after_review(&state, project_id, job_id.0, &outcome);

    let reviewer = user.name.clone().unwrap_or_else(|| user.login.clone());
    let count = outcome.moved.len();
    let _ = crate::routes::activities::record_project_event(
        &state.pool,
        project_id,
        Some(user_id),
        Some(&reviewer),
        "approved",
        &format!("{count} meeting task{}", if count == 1 { "" } else { "s" }),
        "MEETING_DRAFTS_APPROVED",
        "MEETING",
        Some(outcome.meeting_id),
        Some(json!({ "job_id": job_id.to_string(), "count": count })),
    )
    .await;

    for (task_id, lead, title) in outcome.moved.iter().cloned() {
        let Some(assignee) = lead else { continue };
        let (pool, config, reviewer) = (state.pool.clone(), state.config.clone(), reviewer.clone());
        tokio::spawn(async move {
            crate::services::notifications::notify_task_assigned(
                &pool,
                &config,
                &title,
                assignee,
                project_id,
                None,
                Some(task_id),
                Some(&reviewer),
            )
            .await;
        });
    }

    Ok(Json(review_result(outcome)))
}

pub async fn reject_drafts(
    State(state): State<AppState>,
    CurrentUser(user, _): CurrentUser,
    Path(job_id): Path<SafeId>,
    Json(payload): Json<RejectDraftsPayload>,
) -> Result<Json<ReviewResult>, AppError> {
    let (project_id, _) = member_job(&state, &user, job_id.0).await?;
    let outcome = review::reject(&state.pool, job_id.0, project_id, &payload.task_ids).await?;
    after_review(&state, project_id, job_id.0, &outcome);
    Ok(Json(review_result(outcome)))
}
