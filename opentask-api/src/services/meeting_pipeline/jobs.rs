use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::models::meeting::{JobStatus, MeetingJob};
use crate::models::safe_id::SafeId;
use crate::services::realtime::RealtimeHub;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedJob {
    #[sqlx(flatten)]
    pub job: MeetingJob,
    pub project_id: Option<SafeId>,
}

/// Leases the oldest runnable job, or returns `None`. One autocommit statement: a crashed worker's lease simply expires and the job is claimed again.
pub async fn claim_next_job(pool: &PgPool, lease_minutes: i32) -> Result<Option<ClaimedJob>, sqlx::Error> {
    crate::db::query_as::<_, ClaimedJob>(
        r#"
        UPDATE opentask.meeting_jobs j
        SET locked_until = NOW() + make_interval(mins => $1::int),
            attempts = j.attempts + 1
        FROM opentask.meetings m
        WHERE j.id = (
            SELECT id FROM opentask.meeting_jobs
            WHERE status IN ('QUEUED', 'TRANSCRIBING', 'GATING', 'EXTRACTING')
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
              AND (locked_until IS NULL OR locked_until < NOW())
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
          AND m.id = j.meeting_id
        RETURNING j.id, j.meeting_id, j.source_type, j.status, j.meeting_date, j.timezone, j.attendee_ids,
                  j.r2_keys, j.duration_sec, j.gate, j.attempts, j.locked_until, j.next_attempt_at,
                  j.last_error, m.project_id;
        "#
    )
    .bind(lease_minutes)
    .fetch_optional(pool)
    .await
}

/// Extends the lease between steps. `false` means the job is gone (its meeting was deleted).
pub async fn renew_lease(pool: &PgPool, job_id: i64, lease_minutes: i32) -> Result<bool, sqlx::Error> {
    let result = crate::db::query(
        "UPDATE opentask.meeting_jobs SET locked_until = NOW() + make_interval(mins => $2::int) WHERE id = $1;",
    )
    .bind(job_id)
    .bind(lease_minutes)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() == 1)
}

/// Moves a job to `status` and its meeting to the matching meeting status in one transaction, then publishes a `meeting_job` event. Statuses the worker does not pick up release the lease.
pub async fn set_status(
    pool: &PgPool,
    realtime: &RealtimeHub,
    claimed: &ClaimedJob,
    status: JobStatus,
    last_error: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let job_id = claimed.job.id.0;
    let mut tx = pool.begin().await?;

    let updated = crate::db::query(
        r#"
        UPDATE opentask.meeting_jobs
        SET status = $2,
            last_error = COALESCE($3, last_error),
            locked_until = CASE WHEN $4 THEN locked_until ELSE NULL END,
            next_attempt_at = CASE WHEN $4 THEN next_attempt_at ELSE NULL END
        WHERE id = $1;
        "#
    )
    .bind(job_id)
    .bind(status)
    .bind(last_error)
    .bind(status.is_claimable())
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(false);
    }

    crate::db::query("UPDATE opentask.meetings SET status = $2, updated_at = NOW() WHERE id = $1;")
        .bind(claimed.job.meeting_id.0)
        .bind(status.meeting_status())
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    if let Some(project_id) = claimed.project_id {
        realtime.publish(project_id.0, "meeting_job", "updated", Some(job_id));
    }
    Ok(true)
}

/// Releases the lease without failing the job: it runs again at `until`.
/// `counts_as_attempt = false` is for rate limits and quotas, which are delays, not failures.
pub async fn release_until(
    pool: &PgPool,
    job_id: i64,
    until: DateTime<Utc>,
    reason: &str,
    counts_as_attempt: bool,
) -> Result<(), sqlx::Error> {
    crate::db::query(
        r#"
        UPDATE opentask.meeting_jobs
        SET locked_until = NULL,
            next_attempt_at = $2,
            last_error = $3,
            attempts = CASE WHEN $4 THEN attempts ELSE GREATEST(attempts - 1, 0) END
        WHERE id = $1;
        "#
    )
    .bind(job_id)
    .bind(until)
    .bind(reason)
    .bind(counts_as_attempt)
    .execute(pool)
    .await?;
    Ok(())
}
