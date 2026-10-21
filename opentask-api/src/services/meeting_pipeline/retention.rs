use sqlx::PgPool;

use super::config::PipelineConfig;

/// Checkpoints are only needed while a job runs; failed jobs keep theirs so a retry can resume.
pub async fn clear_checkpoints(pool: &PgPool) -> Result<u64, sqlx::Error> {
    Ok(crate::db::query(
        r#"
        UPDATE opentask.meeting_transcripts t
        SET asr_checkpoint = NULL, extraction_checkpoint = NULL
        FROM opentask.meeting_jobs j
        WHERE j.id = t.job_id
          AND j.status IN ('DRAFTS_READY', 'REVIEWED', 'NO_ACTIONS')
          AND (t.asr_checkpoint IS NOT NULL OR t.extraction_checkpoint IS NOT NULL);
        "#,
    )
    .execute(pool)
    .await?
    .rows_affected())
}

/// Deletes transcripts of finished jobs older than the retention period..
pub async fn delete_old_transcripts(pool: &PgPool, days: u32) -> Result<u64, sqlx::Error> {
    if days == 0 {
        return Ok(0);
    }
    Ok(crate::db::query(
        r#"
        DELETE FROM opentask.meeting_transcripts t
        USING opentask.meeting_jobs j, opentask.meetings m
        WHERE j.id = t.job_id AND m.id = j.meeting_id
          AND j.status IN ('REVIEWED', 'NO_ACTIONS', 'FAILED')
          AND COALESCE(t.created_at, m.created_at) < NOW() - make_interval(days => $1);
        "#,
    )
    .bind(days as i32)
    .execute(pool)
    .await?
    .rows_affected())
}

pub async fn sweep(pool: &PgPool, cfg: &PipelineConfig) {
    match clear_checkpoints(pool).await {
        Ok(0) => {}
        Ok(n) => tracing::info!("[Meeting Pipeline] Cleared the checkpoints of {n} finished jobs"),
        Err(e) => tracing::warn!("[Meeting Pipeline] Could not clear checkpoints: {e}"),
    }
    match delete_old_transcripts(pool, cfg.transcript_retention_days).await {
        Ok(0) => {}
        Ok(n) => tracing::info!(
            "[Meeting Pipeline] Deleted {n} transcripts older than {} days",
            cfg.transcript_retention_days
        ),
        Err(e) => tracing::warn!("[Meeting Pipeline] Could not delete old transcripts: {e}"),
    }
}
