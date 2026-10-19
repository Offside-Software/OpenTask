use chrono::Datelike;
use sqlx::PgPool;

use super::extract::{self, Checkpoint, ChunkOutcome};
use super::jobs::{self, ClaimedJob};
use super::postprocess::{self, MemberName, PostProcessInput};
use super::prompts::ExtractContext;
use super::transcript::{format_segment, head_tail_sample};
use super::{drafts, StepError, StepOutcome, WorkerContext};
use crate::models::meeting::{MeetingTranscript, SourceType};

pub const DEFAULT_TASK_TYPES: [&str; 5] = ["CODE", "REQUIREMENT", "DESIGN", "NON-CODE", "OTHER"];

fn db_error(e: sqlx::Error) -> StepError {
    StepError::Retryable(format!("database error: {e}"))
}

/// Default types plus the ones the project already uses (`tasks.type` may hold `A|B`).
pub async fn allowed_task_types(pool: &PgPool, project_id: i64) -> Result<Vec<String>, sqlx::Error> {
    let used: Vec<String> = crate::db::query_scalar(
        "SELECT DISTINCT type FROM opentask.tasks WHERE project_id = $1 AND type IS NOT NULL;",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    let mut types: Vec<String> = DEFAULT_TASK_TYPES.iter().map(|t| t.to_string()).collect();
    for value in used {
        for t in value.split('|').map(|t| t.trim().to_ascii_uppercase()) {
            if !t.is_empty() && t.len() <= 30 && !types.contains(&t) && types.len() < 20 {
                types.push(t);
            }
        }
    }
    Ok(types)
}

pub async fn project_members(pool: &PgPool, project_id: i64) -> Result<Vec<MemberName>, sqlx::Error> {
    crate::db::query_as::<_, MemberName>(
        r#"
        SELECT u.id AS user_id, u.display_name, u.gh_username
        FROM opentask.project_member pm
        JOIN opentask.users u ON u.id = pm.user_id
        WHERE pm.project_id = $1;
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
}

async fn save_checkpoint(pool: &PgPool, job_id: i64, checkpoint: &Checkpoint) -> Result<(), StepError> {
    crate::db::query("UPDATE opentask.meeting_transcripts SET extraction_checkpoint = $2 WHERE job_id = $1;")
        .bind(job_id)
        .bind(serde_json::to_value(checkpoint).unwrap_or_default())
        .execute(pool)
        .await
        .map_err(db_error)?;
    Ok(())
}

pub async fn extract_step(ctx: &WorkerContext, claimed: &ClaimedJob) -> Result<StepOutcome, StepError> {
    let llm = ctx
        .llm
        .as_ref()
        .ok_or_else(|| StepError::Fatal("GROQ_API_KEY is not configured".to_string()))?;
    let job = &claimed.job;
    let job_id = job.id.0;
    let meeting_id = job.meeting_id.0;
    let project_id = claimed.project_id.map(|p| p.0).unwrap_or_default();
    let pool = &ctx.pool;

    let transcript = crate::db::query_as::<_, MeetingTranscript>(
        "SELECT job_id, language, segments, extraction_checkpoint, created_at FROM opentask.meeting_transcripts WHERE job_id = $1;",
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| StepError::Fatal("the job has no transcript".to_string()))?;
    let segments = transcript.segments.0;
    let lines: Vec<String> = segments.iter().map(format_segment).collect();

    let planned = extract::plan_chunks(&lines, extract::chunk_budget(&ctx.cfg), ctx.cfg.overlap_tokens);
    let mut checkpoint = transcript
        .extraction_checkpoint
        .and_then(|value| serde_json::from_value::<Checkpoint>(value).ok())
        .filter(|c| c.chunks == planned)
        .unwrap_or_else(|| Checkpoint { chunks: planned.clone(), ..Default::default() });

    let meeting_date = job.meeting_date.date_naive();
    let date_text = meeting_date.to_string();
    let weekday = meeting_date.weekday().to_string();
    let attendees: Vec<String> = crate::db::query_scalar(
        "SELECT COALESCE(NULLIF(display_name, ''), gh_username, 'Unknown') FROM opentask.users WHERE id = ANY($1);",
    )
    .bind(job.attendee_ids.iter().map(|id| id.0).collect::<Vec<i64>>())
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    let allowed_types = allowed_task_types(pool, project_id).await.map_err(db_error)?;
    let doc_type = job
        .gate
        .as_ref()
        .and_then(|g| g.0.doc_type.clone())
        .unwrap_or_else(|| match job.source_type {
            SourceType::RecallBot | SourceType::Media => "meeting_transcript".to_string(),
            _ => "other".to_string(),
        });
    let prompt_ctx = ExtractContext {
        meeting_date: &date_text,
        weekday: &weekday,
        timezone: &job.timezone,
        attendees: &attendees,
        doc_type: &doc_type,
        allowed_types: &allowed_types,
    };

    let chunk_count = planned.len();
    for (index, (start, end)) in planned.iter().copied().enumerate() {
        if checkpoint.results.contains_key(&index) {
            continue;
        }
        let record = lines[start..end].join("\n");
        match extract::extract_chunk(llm, &ctx.cfg, &prompt_ctx, index, chunk_count, &record).await {
            Ok(ChunkOutcome::Done(tasks)) => {
                tracing::info!("[Meeting Pipeline] Job {job_id}: chunk {}/{chunk_count} gave {} tasks", index + 1, tasks.len());
                checkpoint.results.insert(index, tasks);
                save_checkpoint(pool, job_id, &checkpoint).await?;
                jobs::renew_lease(pool, job_id, ctx.cfg.lease_minutes).await.map_err(db_error)?;
            }
            Ok(ChunkOutcome::Defer { until, reason }) => return Ok(StepOutcome::Defer { until, reason }),
            Err((error, raw)) => {
                if raw.is_some() {
                    checkpoint.failed_raw = raw;
                    save_checkpoint(pool, job_id, &checkpoint).await?;
                }
                return Err(error);
            }
        }
    }

    let extracted = checkpoint.results.into_values().flatten().collect();
    let members = project_members(pool, project_id).await.map_err(db_error)?;
    let candidates = postprocess::post_process(PostProcessInput {
        tasks: extracted,
        segments: &segments,
        meeting_date,
        allowed_types: &allowed_types,
        members: &members,
        max_tasks: ctx.cfg.max_tasks_per_job,
    });

    let titles: Vec<String> = candidates.iter().map(|c| c.title.clone()).collect();
    let sample = head_tail_sample(&lines.join("\n"), 7_500, 7_500);
    let summary = extract::summarize(llm, &ctx.cfg, &date_text, &titles, &sample).await;

    let saved = drafts::save_drafts(pool, job_id, meeting_id, project_id, &candidates, summary.as_ref())
        .await
        .map_err(db_error)?;
    let Some(saved) = saved else {
        tracing::info!("[Meeting Pipeline] Job {job_id} changed while extracting; leaving it as is");
        return Ok(StepOutcome::Finished);
    };
    tracing::info!(
        "[Meeting Pipeline] Job {job_id}: {} with {} draft tasks",
        saved.status,
        saved.task_ids.len()
    );
    drafts::notify_drafts_ready(pool, &ctx.config, &ctx.realtime, job_id, meeting_id, project_id, &saved).await;
    Ok(StepOutcome::Finished)
}
