use serde::Serialize;
use sqlx::PgPool;

use super::config::PipelineConfig;
use super::keys::{self, ProjectKeyInfo};
use super::usage::{self, Limits};
use crate::error::AppError;
use crate::models::meeting::{JobStatus, MeetingJob, MeetingJobResponse, MEETING_JOB_COLUMNS};

#[derive(Debug, Clone, Serialize)]
pub struct QuotaUsage {
    pub jobs_today: i64,
    pub jobs_per_day: u32,
    pub audio_minutes_today: i64,
    pub audio_minutes_per_day: u32,
    /// The project uses its own Groq key, so the quotas do not apply.
    pub exempt: bool,
}

/// Today's use of one model across all projects, against its free-tier limits.
#[derive(Debug, Clone, Serialize)]
pub struct ModelHealth {
    pub model: String,
    pub requests: i64,
    pub tokens: i64,
    pub audio_seconds: i64,
    pub limits: Limits,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProblemJob {
    pub job: MeetingJobResponse,
    pub meeting_title: Option<String>,
    /// Internal error text for managers; others get the waiting reason or the public failure reason.
    pub problem: Option<String>,
    pub can_retry: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MeetingHealth {
    pub can_manage: bool,
    pub quota: QuotaUsage,
    /// The shared keys, used by every project without its own.
    pub models: Vec<ModelHealth>,
    /// The project's own key, when it has one.
    pub own_models: Vec<ModelHealth>,
    pub key: ProjectKeyInfo,
    pub jobs: Vec<ProblemJob>,
}

fn model_health(limits: &std::collections::HashMap<String, Limits>, used: &[usage::ModelUsage]) -> Vec<ModelHealth> {
    let mut names: Vec<String> = limits.keys().cloned().chain(used.iter().map(|u| u.model.clone())).collect();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .map(|model| {
            let today = used.iter().find(|u| u.model == model);
            ModelHealth {
                requests: today.map_or(0, |u| u.requests),
                tokens: today.map_or(0, |u| u.tokens),
                audio_seconds: today.map_or(0, |u| u.audio_seconds),
                limits: limits.get(&model).copied().unwrap_or_default(),
                model,
            }
        })
        .collect()
}

/// Owners and admins of the project may see internal errors and retry jobs.
pub async fn is_manager(pool: &PgPool, project_id: i64, user_id: i64) -> Result<bool, sqlx::Error> {
    crate::db::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM opentask.project_member
            WHERE project_id = $1 AND user_id = $2 AND LOWER(COALESCE(role, '')) IN ('owner', 'admin')
        );
        "#,
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

#[derive(sqlx::FromRow)]
struct ProblemRow {
    #[sqlx(flatten)]
    job: MeetingJob,
    meeting_title: Option<String>,
    waiting: bool,
}

fn retryable(job: &MeetingJob, waiting: bool) -> bool {
    waiting || (job.status == JobStatus::Failed && job.attempts > 0)
}

pub async fn project_health(pool: &PgPool, cfg: &PipelineConfig, project_id: i64, can_manage: bool) -> Result<MeetingHealth, sqlx::Error> {
    let key = keys::info(pool, project_id, can_manage).await?;
    let quota = QuotaUsage {
        jobs_today: usage::project_jobs_today(pool, project_id).await?,
        jobs_per_day: cfg.project_jobs_per_day,
        audio_minutes_today: usage::project_audio_today(pool, project_id, cfg).await? / 60,
        audio_minutes_per_day: cfg.project_audio_minutes_per_day,
        exempt: key.configured,
    };

    let models = model_health(&usage::limits_for(cfg), &usage::usage_today(pool, None).await?);
    let own_models = if key.configured {
        let limits = if key.tier.as_deref() == Some("developer") { Default::default() } else { usage::own_key_limits(cfg) };
        model_health(&limits, &usage::usage_today(pool, Some(project_id)).await?)
    } else {
        Vec::new()
    };

    let columns = MEETING_JOB_COLUMNS
        .split(',')
        .map(|c| format!("j.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = crate::db::query_as::<_, ProblemRow>(&format!(
        r#"
        SELECT {columns}, m.title AS meeting_title,
               (j.status IN ('QUEUED', 'TRANSCRIBING', 'GATING', 'EXTRACTING') AND j.next_attempt_at > NOW()) AS waiting
        FROM opentask.meeting_jobs j
        JOIN opentask.meetings m ON m.id = j.meeting_id
        WHERE m.project_id = $1
          AND (j.status = 'FAILED'
               OR (j.status IN ('QUEUED', 'TRANSCRIBING', 'GATING', 'EXTRACTING') AND j.next_attempt_at > NOW()))
        ORDER BY j.id DESC
        LIMIT 20;
        "#
    ))
    .bind(project_id)
    .fetch_all(pool)
    .await?;
    let jobs = rows
        .into_iter()
        .map(|row| {
            let can_retry = can_manage && retryable(&row.job, row.waiting);
            let public = MeetingJobResponse::from(row.job.clone());
            let problem = if can_manage || row.waiting { row.job.last_error.clone() } else { public.failure_reason.clone() };
            ProblemJob { job: public, meeting_title: row.meeting_title, problem, can_retry }
        })
        .collect();

    Ok(MeetingHealth { can_manage, quota, models, own_models, key, jobs })
}

pub async fn retry(pool: &PgPool, job_id: i64) -> Result<MeetingJobResponse, AppError> {
    let mut tx = pool.begin().await?;
    let row = crate::db::query_as::<_, (JobStatus, i32, bool, i64)>(
        r#"
        SELECT status, attempts, COALESCE(next_attempt_at > NOW(), FALSE), meeting_id
        FROM opentask.meeting_jobs WHERE id = $1 FOR UPDATE;
        "#,
    )
    .bind(job_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Meeting job {job_id} not found")))?;
    let (status, attempts, waiting, meeting_id) = row;

    if status.is_claimable() && waiting {
        crate::db::query("UPDATE opentask.meeting_jobs SET next_attempt_at = NULL WHERE id = $1;")
            .bind(job_id)
            .execute(&mut *tx)
            .await?;
    } else if status == JobStatus::Failed && attempts > 0 {
        crate::db::query(
            r#"
            UPDATE opentask.meeting_jobs
            SET status = 'QUEUED', attempts = 0, last_error = NULL, next_attempt_at = NULL, locked_until = NULL
            WHERE id = $1;
            "#,
        )
        .bind(job_id)
        .execute(&mut *tx)
        .await?;
        crate::db::query("UPDATE opentask.meetings SET status = $2, updated_at = NOW() WHERE id = $1;")
            .bind(meeting_id)
            .bind(JobStatus::Queued.meeting_status())
            .execute(&mut *tx)
            .await?;
    } else {
        return Err(AppError::Conflict("This job is not waiting and did not fail in processing, so there is nothing to retry".to_string()));
    }
    tx.commit().await?;
    super::wake_worker();

    let job = crate::db::query_as::<_, MeetingJob>(&format!("SELECT {MEETING_JOB_COLUMNS} FROM opentask.meeting_jobs WHERE id = $1;"))
        .bind(job_id)
        .fetch_one(pool)
        .await?;
    Ok(MeetingJobResponse::from(job))
}
