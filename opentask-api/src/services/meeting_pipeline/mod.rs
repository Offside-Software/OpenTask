pub mod config;
pub mod jobs;

use std::time::Duration;

use chrono::Utc;
use sqlx::PgPool;
use tokio::sync::Notify;

use crate::config::Config;
use crate::models::meeting::{JobStatus, SourceType};
use crate::services::realtime::RealtimeHub;
use config::PipelineConfig;
use jobs::ClaimedJob;

static WAKE: Notify = Notify::const_new();

/// Tells the worker a job may be ready. 
pub fn wake_worker() {
    WAKE.notify_one();
}

/// Shared state for one worker loop.
pub struct WorkerContext {
    pub pool: PgPool,
    pub config: Config,
    pub realtime: RealtimeHub,
    pub cfg: PipelineConfig,
}

pub fn spawn_worker(pool: PgPool, config: Config, realtime: RealtimeHub) {
    let ctx = WorkerContext {
        pool,
        config,
        realtime,
        cfg: PipelineConfig::from_env(),
    };
    tokio::spawn(async move { run_worker(ctx).await });
}

async fn run_worker(ctx: WorkerContext) {
    tracing::info!("[Meeting Pipeline] Worker started");
    let idle = Duration::from_secs(ctx.cfg.idle_poll_secs);

    loop {
        match jobs::claim_next_job(&ctx.pool, ctx.cfg.lease_minutes).await {
            Ok(Some(claimed)) => run_job(&ctx, claimed).await,
            Ok(None) => {
                tokio::select! {
                    _ = WAKE.notified() => {}
                    _ = tokio::time::sleep(idle) => {}
                }
            }
            Err(e) => {
                tracing::warn!("[Meeting Pipeline] Could not claim a job: {e}");
                tokio::time::sleep(idle).await;
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum StepOutcome {
    Next(JobStatus),
    Defer {
        until: chrono::DateTime<Utc>,
        reason: String,
    },
}

/// Determine whether the step is worth to retry
#[derive(Debug, Clone, PartialEq)]
pub enum StepError {
    Retryable(String),
    Fatal(String),
}

async fn run_job(ctx: &WorkerContext, mut claimed: ClaimedJob) {
    let job_id = claimed.job.id.0;

    if claimed.project_id.is_none() {
        fail(ctx, &claimed, "the meeting has no project").await;
        return;
    }
    if claimed.job.attempts > ctx.cfg.max_attempts {
        let reason = format!("gave up after {} attempts", ctx.cfg.max_attempts);
        fail(ctx, &claimed, &reason).await;
        return;
    }

    loop {
        let status = claimed.job.status;
        tracing::info!(
            "[Meeting Pipeline] Job {job_id}: {status} (attempt {})",
            claimed.job.attempts
        );

        match run_step(ctx, &claimed).await {
            Ok(StepOutcome::Next(next)) => {
                match jobs::set_status(&ctx.pool, &ctx.realtime, &claimed, next, None).await {
                    Ok(true) => {}
                    Ok(false) => {
                        tracing::info!("[Meeting Pipeline] Job {job_id} was deleted; stopping");
                        return;
                    }
                    Err(e) => {
                        tracing::warn!("[Meeting Pipeline] Job {job_id}: could not save status {next}: {e}");
                        return;
                    }
                }
                claimed.job.status = next;
                if !next.is_claimable() {
                    return;
                }
                match jobs::renew_lease(&ctx.pool, job_id, ctx.cfg.lease_minutes).await {
                    Ok(true) => {}
                    Ok(false) => return,
                    Err(e) => {
                        tracing::warn!("[Meeting Pipeline] Job {job_id}: could not renew lease: {e}");
                        return;
                    }
                }
            }
            Ok(StepOutcome::Defer { until, reason }) => {
                tracing::info!("[Meeting Pipeline] Job {job_id}: deferred until {until}: {reason}");
                if let Err(e) = jobs::release_until(&ctx.pool, job_id, until, &reason, false).await {
                    tracing::warn!("[Meeting Pipeline] Job {job_id}: could not defer: {e}");
                }
                return;
            }
            Err(StepError::Retryable(reason)) => {
                let delay = ctx.cfg.retry_delay_secs(claimed.job.attempts);
                let until = Utc::now() + chrono::Duration::seconds(delay);
                tracing::warn!("[Meeting Pipeline] Job {job_id}: {status} failed, retrying in {delay}s: {reason}");
                if let Err(e) = jobs::release_until(&ctx.pool, job_id, until, &reason, true).await {
                    tracing::warn!("[Meeting Pipeline] Job {job_id}: could not schedule retry: {e}");
                }
                return;
            }
            Err(StepError::Fatal(reason)) => {
                fail(ctx, &claimed, &reason).await;
                return;
            }
        }
    }
}

async fn fail(ctx: &WorkerContext, claimed: &ClaimedJob, reason: &str) {
    let job_id = claimed.job.id.0;
    tracing::warn!("[Meeting Pipeline] Job {job_id} failed: {reason}");
    if let Err(e) = jobs::set_status(&ctx.pool, &ctx.realtime, claimed, JobStatus::Failed, Some(reason)).await {
        tracing::warn!("[Meeting Pipeline] Job {job_id}: could not mark FAILED: {e}");
    }
}

async fn run_step(_ctx: &WorkerContext, claimed: &ClaimedJob) -> Result<StepOutcome, StepError> {
    match claimed.job.status {
        JobStatus::Queued => first_step(claimed.job.source_type).map(StepOutcome::Next),
        status => Err(StepError::Fatal(format!("the {status} step is not implemented yet"))),
    }
}

pub fn first_step(source_type: SourceType) -> Result<JobStatus, StepError> {
    match source_type {
        SourceType::Media => Ok(JobStatus::Transcribing),
        SourceType::RecallBot | SourceType::Text => Ok(JobStatus::Extracting),
        SourceType::Manual => Err(StepError::Fatal("manual meetings have nothing to process".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_jobs_start_at_the_right_step() {
        assert_eq!(first_step(SourceType::Media), Ok(JobStatus::Transcribing));
        assert_eq!(first_step(SourceType::RecallBot), Ok(JobStatus::Extracting));
        assert_eq!(first_step(SourceType::Text), Ok(JobStatus::Extracting));
        assert!(matches!(first_step(SourceType::Manual), Err(StepError::Fatal(_))));
    }
}
