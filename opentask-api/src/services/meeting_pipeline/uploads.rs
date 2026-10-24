use std::time::Duration;

use sqlx::PgPool;

use super::config::PipelineConfig;
use super::intake::{insert_meeting_and_job, load, transition, NewMeeting};
use super::storage::{self, MediaStore};
use super::wake_worker;
use crate::error::AppError;
use crate::models::meeting::{IntakeResponse, JobStatus, MediaIntakeResponse, MeetingJob, SourceType, MEETING_JOB_COLUMNS};
use crate::services::realtime::RealtimeHub;

const MB: u64 = 1024 * 1024;

pub fn store(cfg: &PipelineConfig) -> Result<&MediaStore, AppError> {
    cfg.media_store.as_ref().ok_or_else(|| {
        AppError::ServiceUnavailable(
            "Recording uploads are off: set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY".to_string(),
        )
    })
}

fn content_type(declared: Option<&str>) -> String {
    declared
        .map(str::trim)
        .filter(|t| (t.starts_with("audio/") || t.starts_with("video/")) && t.len() <= 100 && t.is_ascii())
        .unwrap_or("application/octet-stream")
        .to_string()
}

/// The file the browser is about to upload; `duration_sec` when it extracted the audio.
pub struct UploadFile<'a> {
    pub name: &'a str,
    pub content_type: Option<&'a str>,
    pub size_bytes: u64,
    pub duration_sec: Option<f32>,
}

pub async fn create_media_job(
    pool: &PgPool,
    realtime: &RealtimeHub,
    cfg: &PipelineConfig,
    new: NewMeeting,
    file: UploadFile<'_>,
) -> Result<MediaIntakeResponse, AppError> {
    let store = store(cfg)?;
    let size_bytes = file.size_bytes;
    super::usage::check_project_quota(pool, cfg, new.project_id, file.duration_sec.map(|d| d.ceil() as u32)).await?;
    if size_bytes == 0 {
        return Err(AppError::BadRequest("The file is empty".to_string()));
    }
    if size_bytes > cfg.max_upload_mb * MB {
        return Err(AppError::BadRequest(format!(
            "The file is {} MB; recordings up to {} MB can be uploaded",
            size_bytes.div_ceil(MB),
            cfg.max_upload_mb
        )));
    }

    let mut tx = pool.begin().await?;
    let (_, job) = insert_meeting_and_job(&mut tx, &new, JobStatus::Created).await?;
    let key = storage::upload_key(new.project_id, job.id.0, file.name);
    crate::db::query("UPDATE opentask.meeting_jobs SET r2_keys = $2 WHERE id = $1;")
        .bind(job.id.0)
        .bind(serde_json::json!([key]))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let IntakeResponse { meeting, job } = load(pool, job.meeting_id.0, job.id.0).await?;
    realtime.publish(new.project_id, "meeting", "created", Some(meeting.id.0));
    realtime.publish(new.project_id, "meeting_job", "updated", Some(job.id.0));

    let upload = store.presign_put(&key, &content_type(file.content_type), Duration::from_secs(cfg.upload_url_minutes * 60));
    Ok(MediaIntakeResponse { meeting, job, upload })
}

async fn fetch_job(pool: &PgPool, job_id: i64) -> Result<MeetingJob, AppError> {
    crate::db::query_as::<_, MeetingJob>(&format!("SELECT {MEETING_JOB_COLUMNS} FROM opentask.meeting_jobs WHERE id = $1;"))
        .bind(job_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Meeting job {job_id} not found")))
}

/// Check the file is there and queue the job. 
pub async fn complete_upload(
    pool: &PgPool,
    realtime: &RealtimeHub,
    cfg: &PipelineConfig,
    project_id: i64,
    job_id: i64,
) -> Result<IntakeResponse, AppError> {
    let store = store(cfg)?;
    let job = fetch_job(pool, job_id).await?;
    if job.source_type != SourceType::Media {
        return Err(AppError::BadRequest("Only recording uploads are completed".to_string()));
    }
    if job.status != JobStatus::Created {
        return Ok(load(pool, job.meeting_id.0, job_id).await?);
    }
    let key = job
        .r2_keys
        .0
        .first()
        .cloned()
        .ok_or_else(|| AppError::Conflict("This job has no upload".to_string()))?;
    let size = store.size(&key).await.map_err(|e| AppError::ServiceUnavailable(e.to_string()))?;
    match size {
        None | Some(0) => return Err(AppError::Conflict("The upload has not arrived yet".to_string())),
        Some(bytes) if bytes > cfg.max_upload_mb * MB => {
            let reason = format!("The uploaded file is larger than {} MB", cfg.max_upload_mb);
            transition(pool, job_id, job.meeting_id.0, JobStatus::Created, JobStatus::Failed, None, Some(&reason)).await?;
            delete_objects(store, &job.r2_keys.0).await;
            realtime.publish(project_id, "meeting_job", "updated", Some(job_id));
            return Err(AppError::BadRequest(reason));
        }
        Some(_) => {}
    }
    if transition(pool, job_id, job.meeting_id.0, JobStatus::Created, JobStatus::Queued, None, None).await? {
        realtime.publish(project_id, "meeting_job", "updated", Some(job_id));
        wake_worker();
    }
    Ok(load(pool, job.meeting_id.0, job_id).await?)
}

pub async fn delete_objects(store: &MediaStore, keys: &[String]) {
    for key in keys {
        if let Err(e) = store.delete(key).await {
            tracing::warn!("[Meeting Pipeline] Could not delete stored upload {key}: {e}");
        }
    }
}

/// Removes a job's stored files and forgets them.
pub async fn release_objects(pool: &PgPool, store: &MediaStore, job_id: i64, keys: &[String]) {
    if keys.is_empty() {
        return;
    }
    delete_objects(store, keys).await;
    if let Err(e) = crate::db::query("UPDATE opentask.meeting_jobs SET r2_keys = '[]'::jsonb WHERE id = $1;")
        .bind(job_id)
        .execute(pool)
        .await
    {
        tracing::warn!("[Meeting Pipeline] Could not clear the upload keys of job {job_id}: {e}");
    }
}

#[derive(sqlx::FromRow)]
struct StoredJob {
    id: i64,
    meeting_id: i64,
    project_id: Option<i64>,
    status: JobStatus,
    r2_keys: sqlx::types::Json<Vec<String>>,
}

/// Fails uploads that never finished and removes stored files of jobs that no longer need them.
pub async fn sweep(pool: &PgPool, realtime: &RealtimeHub, cfg: &PipelineConfig) {
    let Some(store) = cfg.media_store.as_ref() else { return };
    let rows = crate::db::query_as::<_, StoredJob>(
        r#"
        SELECT j.id, j.meeting_id, m.project_id, j.status, j.r2_keys
        FROM opentask.meeting_jobs j
        JOIN opentask.meetings m ON m.id = j.meeting_id
        WHERE j.r2_keys <> '[]'::jsonb
          AND (j.status IN ('NO_ACTIONS', 'DRAFTS_READY', 'REVIEWED')
               OR (j.status = 'FAILED' AND m.created_at < NOW() - INTERVAL '1 day')
               OR (j.status = 'CREATED' AND j.source_type = 'MEDIA' AND m.created_at < NOW() - make_interval(hours => $1)))
        ORDER BY j.id
        LIMIT 50;
        "#,
    )
    .bind(cfg.upload_max_wait_hours as i32)
    .fetch_all(pool)
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!("[Meeting Pipeline] Could not list stored uploads: {e}");
            return;
        }
    };
    for job in rows {
        if job.status == JobStatus::Created {
            let reason = format!("The upload did not finish within {} hours.", cfg.upload_max_wait_hours);
            match transition(pool, job.id, job.meeting_id, JobStatus::Created, JobStatus::Failed, None, Some(&reason)).await {
                Ok(true) => {
                    if let Some(project_id) = job.project_id {
                        realtime.publish(project_id, "meeting_job", "updated", Some(job.id));
                    }
                }
                Ok(false) => continue,
                Err(e) => {
                    tracing::warn!("[Meeting Pipeline] Could not fail the abandoned upload of job {}: {e}", job.id);
                    continue;
                }
            }
        }
        release_objects(pool, store, job.id, &job.r2_keys.0).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_audio_and_video_types_are_passed_on() {
        assert_eq!(content_type(Some("audio/ogg")), "audio/ogg");
        assert_eq!(content_type(Some(" video/mp4 ")), "video/mp4");
        assert_eq!(content_type(Some("text/html")), "application/octet-stream");
        assert_eq!(content_type(None), "application/octet-stream");
    }
}
