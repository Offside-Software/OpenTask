use chrono::{DateTime, NaiveDate, Utc};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};

use super::config::PipelineConfig;
use super::gate::run_gate;
use super::llm::LlmClient;
use super::recall;
use super::transcript::{plain_text, segments_from_text};
use super::wake_worker;
use crate::config::{Config, RECALL_REGIONS};
use crate::error::AppError;
use crate::models::meeting::{
    DatabaseMeeting, GateResult, GateVerdict, IntakeResponse, JobStatus, MeetingJob, MeetingJobResponse, Segment,
    SourceType, MEETING_COLUMNS, MEETING_JOB_COLUMNS,
};
use crate::services::id_generator::next_id;
use crate::services::realtime::RealtimeHub;

pub const MIN_TEXT_CHARS: usize = 200;

pub struct NewMeeting {
    pub project_id: i64,
    pub created_by: i64,
    pub title: String,
    pub source_type: SourceType,
    pub meeting_date: NaiveDate,
    pub timezone: String,
    pub attendee_ids: Vec<i64>,
}

pub fn parse_meeting_date(value: Option<&str>) -> Result<NaiveDate, AppError> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => NaiveDate::parse_from_str(v, "%Y-%m-%d")
            .map_err(|_| AppError::BadRequest("meeting_date must be YYYY-MM-DD".to_string())),
        None => Ok(Utc::now().date_naive()),
    }
}

pub async fn member_ids(pool: &PgPool, project_id: i64, ids: &[i64]) -> Result<Vec<i64>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    crate::db::query_scalar(
        "SELECT user_id FROM opentask.project_member WHERE project_id = $1 AND user_id = ANY($2) ORDER BY user_id;",
    )
    .bind(project_id)
    .bind(ids)
    .fetch_all(pool)
    .await
}

async fn insert_meeting_and_job(
    tx: &mut Transaction<'_, Postgres>,
    new: &NewMeeting,
    status: JobStatus,
) -> Result<(DatabaseMeeting, MeetingJob), sqlx::Error> {
    let meeting_sql = format!(
        r#"
        INSERT INTO opentask.meetings (id, project_id, created_by, title, date, source_type, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING {MEETING_COLUMNS};
        "#
    );
    let meeting = crate::db::query_as::<_, DatabaseMeeting>(&meeting_sql)
        .bind(next_id())
        .bind(new.project_id)
        .bind(new.created_by.to_string())
        .bind(&new.title)
        .bind(new.meeting_date.to_string())
        .bind(new.source_type)
        .bind(status.meeting_status())
        .fetch_one(&mut **tx)
        .await?;

    let job_sql = format!(
        r#"
        INSERT INTO opentask.meeting_jobs (id, meeting_id, source_type, status, meeting_date, timezone, attendee_ids)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING {MEETING_JOB_COLUMNS};
        "#
    );
    let job = crate::db::query_as::<_, MeetingJob>(&job_sql)
        .bind(next_id())
        .bind(meeting.id.0)
        .bind(new.source_type)
        .bind(status)
        .bind(new.meeting_date.and_hms_opt(0, 0, 0).unwrap_or_default().and_utc())
        .bind(&new.timezone)
        .bind(&new.attendee_ids)
        .fetch_one(&mut **tx)
        .await?;
    Ok((meeting, job))
}

async fn insert_transcript(
    tx: &mut Transaction<'_, Postgres>,
    job_id: i64,
    language: Option<&str>,
    segments: &[Segment],
) -> Result<(), sqlx::Error> {
    crate::db::query(
        r#"
        INSERT INTO opentask.meeting_transcripts (job_id, language, segments, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (job_id) DO NOTHING;
        "#,
    )
    .bind(job_id)
    .bind(language)
    .bind(serde_json::to_value(segments).unwrap_or_default())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn load(pool: &PgPool, meeting_id: i64, job_id: i64) -> Result<IntakeResponse, sqlx::Error> {
    let meeting = crate::db::query_as::<_, DatabaseMeeting>(&format!(
        "SELECT {MEETING_COLUMNS} FROM opentask.meetings WHERE id = $1;"
    ))
    .bind(meeting_id)
    .fetch_one(pool)
    .await?;
    let job = crate::db::query_as::<_, MeetingJob>(&format!(
        "SELECT {MEETING_JOB_COLUMNS} FROM opentask.meeting_jobs WHERE id = $1;"
    ))
    .bind(job_id)
    .fetch_one(pool)
    .await?;
    Ok(IntakeResponse { meeting, job: MeetingJobResponse::from(job) })
}

/// Moves a job to `status` (with its meeting) only if it is still `from`. Returns whether it moved.
async fn transition(
    pool: &PgPool,
    job_id: i64,
    meeting_id: i64,
    from: JobStatus,
    status: JobStatus,
    gate: Option<&GateResult>,
    last_error: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let moved = crate::db::query(
        r#"
        UPDATE opentask.meeting_jobs
        SET status = $3, gate = COALESCE($4, gate), last_error = COALESCE($5, last_error)
        WHERE id = $1 AND status = $2;
        "#,
    )
    .bind(job_id)
    .bind(from)
    .bind(status)
    .bind(gate.map(|g| serde_json::to_value(g).unwrap_or_default()))
    .bind(last_error)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if moved {
        crate::db::query("UPDATE opentask.meetings SET status = $2, updated_at = NOW() WHERE id = $1;")
            .bind(meeting_id)
            .bind(status.meeting_status())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(moved)
}

pub async fn create_text_job(
    pool: &PgPool,
    realtime: &RealtimeHub,
    cfg: &PipelineConfig,
    llm: Option<&LlmClient>,
    new: NewMeeting,
    text: &str,
) -> Result<IntakeResponse, AppError> {
    let chars = text.trim().chars().count();
    if chars < MIN_TEXT_CHARS {
        return Err(AppError::BadRequest(format!(
            "The document has too little text ({chars} characters, at least {MIN_TEXT_CHARS} needed). Scanned PDFs are not supported."
        )));
    }
    if chars > cfg.max_text_chars {
        return Err(AppError::BadRequest(format!(
            "The document is too long ({chars} characters, at most {} allowed).",
            cfg.max_text_chars
        )));
    }
    let segments = segments_from_text(text);

    let mut tx = pool.begin().await?;
    let (meeting, job) = insert_meeting_and_job(&mut tx, &new, JobStatus::Created).await?;
    insert_transcript(&mut tx, job.id.0, None, &segments).await?;
    tx.commit().await?;
    realtime.publish(new.project_id, "meeting", "created", Some(meeting.id.0));

    let models = [cfg.gate_model, cfg.gate_fallback_model];
    let gate = run_gate(llm, &models, &plain_text(&segments), cfg.gate_head_chars, cfg.gate_tail_chars).await;
    let status = if gate.verdict == GateVerdict::No { JobStatus::NoActions } else { JobStatus::Queued };
    transition(pool, job.id.0, meeting.id.0, JobStatus::Created, status, Some(&gate), None).await?;
    realtime.publish(new.project_id, "meeting_job", "updated", Some(job.id.0));
    if status == JobStatus::Queued {
        wake_worker();
    }

    Ok(load(pool, meeting.id.0, job.id.0).await?)
}

pub async fn create_recall_job(
    pool: &PgPool,
    config: &Config,
    realtime: &RealtimeHub,
    new: NewMeeting,
    meeting_url: &str,
    bot_name: &str,
) -> Result<IntakeResponse, AppError> {
    let api_key = config
        .recall_api_key
        .as_deref()
        .ok_or_else(|| AppError::ServiceUnavailable("RECALL_API_KEY is not configured".to_string()))?;
    let region_url = format!("https://{}.recall.ai", config.recall_region);
    if config.recall_base_url == region_url && !RECALL_REGIONS.contains(&config.recall_region.as_str()) {
        return Err(AppError::ServiceUnavailable(format!(
            "RECALL_REGION \"{}\" is not a Recall region; use one of {}",
            config.recall_region,
            RECALL_REGIONS.join(", ")
        )));
    }
    let meeting_url = meeting_url.trim();
    if !meeting_url.starts_with("https://") {
        return Err(AppError::BadRequest("meeting_url must be an https:// meeting link".to_string()));
    }

    let mut tx = pool.begin().await?;
    let (meeting, job) = insert_meeting_and_job(&mut tx, &new, JobStatus::Created).await?;
    tx.commit().await?;
    realtime.publish(new.project_id, "meeting", "created", Some(meeting.id.0));

    let metadata = json!({
        "opentask_meeting_id": meeting.id.0.to_string(),
        "opentask_job_id": job.id.0.to_string(),
    });
    let bot = recall::create_bot(
        &config.recall_base_url,
        api_key,
        meeting_url,
        bot_name,
        metadata,
    )
    .await;

    match bot {
        Ok(bot_id) => {
            crate::db::query("UPDATE opentask.meetings SET recall_bot_id = $2, updated_at = NOW() WHERE id = $1;")
                .bind(meeting.id.0)
                .bind(&bot_id)
                .execute(pool)
                .await?;
            Ok(load(pool, meeting.id.0, job.id.0).await?)
        }
        Err(reason) => {
            transition(pool, job.id.0, meeting.id.0, JobStatus::Created, JobStatus::Failed, None, Some(&reason))
                .await?;
            realtime.publish(new.project_id, "meeting_job", "updated", Some(job.id.0));
            Err(AppError::ServiceUnavailable(reason))
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct WaitingJob {
    job_id: i64,
    meeting_id: i64,
    project_id: Option<i64>,
    bot_id: String,
    age_hours: f64,
}

const WAITING_JOBS_SQL: &str = r#"
    SELECT j.id AS job_id, j.meeting_id, m.project_id, m.recall_bot_id AS bot_id,
           EXTRACT(EPOCH FROM (NOW() - m.created_at))::float8 / 3600.0 AS age_hours
    FROM opentask.meetings m
    JOIN opentask.meeting_jobs j ON j.meeting_id = m.id
    WHERE j.status = 'CREATED' AND j.source_type = 'RECALL_BOT' AND m.recall_bot_id IS NOT NULL
"#;

async fn waiting_recall_job(pool: &PgPool, bot_id: &str) -> Result<Option<WaitingJob>, sqlx::Error> {
    let sql = format!("{WAITING_JOBS_SQL} AND m.recall_bot_id = $1 ORDER BY j.id DESC LIMIT 1;");
    crate::db::query_as::<_, WaitingJob>(&sql)
        .bind(bot_id)
        .fetch_optional(pool)
        .await
}

async fn finish_waiting(pool: &PgPool, realtime: &RealtimeHub, waiting: &WaitingJob, status: JobStatus, reason: Option<&str>) {
    match transition(pool, waiting.job_id, waiting.meeting_id, JobStatus::Created, status, None, reason).await {
        Ok(true) => {
            if let Some(project_id) = waiting.project_id {
                realtime.publish(project_id, "meeting_job", "updated", Some(waiting.job_id));
            }
            if status == JobStatus::Queued {
                wake_worker();
            }
        }
        Ok(false) => {}
        Err(e) => tracing::warn!("[Meeting Pipeline] Could not update the job of bot {}: {e}", waiting.bot_id),
    }
}

#[derive(Debug, PartialEq)]
enum BotCheck {
    Queue,
    Fail(String),
    Wait,
}

fn bot_check(media: &recall::BotMedia, age_hours: f64, now: DateTime<Utc>, cfg: &PipelineConfig) -> BotCheck {
    if media.audio_url.is_some() {
        return BotCheck::Queue;
    }
    if media.is_fatal() {
        return BotCheck::Fail(format!("The meeting bot failed: {}.", bot_end_reason(media.sub_code.as_deref())));
    }
    if media.audio_status.as_deref() == Some("failed") {
        return BotCheck::Fail("Recall could not produce the meeting audio, so there is nothing to transcribe.".to_string());
    }
    // `done` means Recall has finished processing. A short grace covers media that shows up late.
    let audio_processing = media.audio_status.as_deref() == Some("processing");
    let grace = chrono::Duration::minutes(cfg.recall_no_audio_grace_mins);
    match media.done_at {
        Some(done_at) if !audio_processing && now - done_at >= grace => {
            return BotCheck::Fail(if media.recorded {
                "The bot recorded the meeting, but Recall made no audio file for it, so there is nothing to transcribe."
                    .to_string()
            } else if media.sub_code.is_some() {
                format!("The bot left without recording: {}.", bot_end_reason(media.sub_code.as_deref()))
            } else {
                "The bot left without recording anything.".to_string()
            });
        }
        _ => {}
    }
    if age_hours > cfg.recall_max_wait_hours as f64 {
        return BotCheck::Fail(format!(
            "No audio arrived within {} hours of sending the bot (last status: {}).",
            cfg.recall_max_wait_hours,
            media.status.as_deref().unwrap_or("unknown")
        ));
    }
    BotCheck::Wait
}

fn bot_end_reason(sub_code: Option<&str>) -> String {
    let Some(code) = sub_code else {
        return "Recall gave no reason".to_string();
    };
    let plain = if code.contains("waiting_room") {
        "nobody let it in from the waiting room"
    } else if code.contains("noone_joined") || code.contains("no_one_joined") {
        "nobody joined the meeting"
    } else if code.contains("everyone_left") {
        "everyone left the meeting"
    } else if code.contains("permission_denied") {
        "the host did not allow it to record"
    } else if code.contains("kicked") || code.contains("removed") {
        "it was removed from the meeting"
    } else if code.contains("meeting_not_found") || code.contains("invalid_meeting") {
        "the link does not lead to a meeting"
    } else if code.contains("sign_in") || code.contains("login") {
        "the meeting only admits signed-in users"
    } else {
        return format!("Recall reported {code}");
    };
    format!("{plain} ({code})")
}

async fn check_waiting(
    pool: &PgPool,
    config: &Config,
    realtime: &RealtimeHub,
    waiting: &WaitingJob,
    cfg: &PipelineConfig,
) -> Result<(), String> {
    let api_key = config.recall_api_key.as_deref().ok_or("RECALL_API_KEY is not configured")?;
    let bot = recall::get_bot(&config.recall_base_url, api_key, &waiting.bot_id).await?;
    let media = recall::bot_media(&bot);

    match bot_check(&media, waiting.age_hours, Utc::now(), cfg) {
        BotCheck::Queue => {
            tracing::info!("[Meeting Pipeline] Recall bot {} has audio; queueing job {}", waiting.bot_id, waiting.job_id);
            finish_waiting(pool, realtime, waiting, JobStatus::Queued, None).await;
        }
        BotCheck::Fail(reason) => {
            tracing::info!("[Meeting Pipeline] Recall bot {} failed job {}: {reason}", waiting.bot_id, waiting.job_id);
            finish_waiting(pool, realtime, waiting, JobStatus::Failed, Some(&reason)).await;
        }
        BotCheck::Wait => {}
    }
    Ok(())
}

pub async fn check_recall_bot(
    pool: &PgPool,
    config: &Config,
    realtime: &RealtimeHub,
    bot_id: &str,
    cfg: &PipelineConfig,
) -> Result<(), String> {
    match waiting_recall_job(pool, bot_id).await.map_err(|e| e.to_string())? {
        Some(waiting) => check_waiting(pool, config, realtime, &waiting, cfg).await,
        None => Ok(()),
    }
}

pub async fn poll_recall_bots(pool: &PgPool, config: &Config, realtime: &RealtimeHub, cfg: &PipelineConfig) {
    if config.recall_api_key.is_none() {
        return;
    }
    let sql = format!("{WAITING_JOBS_SQL} ORDER BY j.id LIMIT 25;");
    let waiting = match crate::db::query_as::<_, WaitingJob>(&sql).fetch_all(pool).await {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!("[Meeting Pipeline] Could not list waiting bots: {e}");
            return;
        }
    };
    for job in &waiting {
        if let Err(e) = check_waiting(pool, config, realtime, job, cfg).await {
            tracing::warn!("[Meeting Pipeline] Could not check Recall bot {}: {e}", job.bot_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use recall::BotMedia;

    fn at(minutes_after_done: i64) -> DateTime<Utc> {
        done() + chrono::Duration::minutes(minutes_after_done)
    }

    fn done() -> DateTime<Utc> {
        "2026-10-19T11:42:31Z".parse().unwrap()
    }

    fn left(recorded: bool, sub_code: Option<&str>) -> BotMedia {
        BotMedia {
            status: Some("done".to_string()),
            sub_code: sub_code.map(str::to_string),
            done_at: Some(done()),
            recorded,
            ..Default::default()
        }
    }

    #[test]
    fn audio_queues_the_job() {
        let cfg = PipelineConfig::from_env();
        let media = BotMedia { audio_url: Some("https://s3/audio.mp3".to_string()), ..left(true, None) };
        assert_eq!(bot_check(&media, 0.5, at(60), &cfg), BotCheck::Queue);
    }

    #[test]
    fn a_bot_still_in_the_meeting_keeps_waiting() {
        let cfg = PipelineConfig::from_env();
        let recording = BotMedia { status: Some("in_call_recording".to_string()), recorded: true, ..Default::default() };
        assert_eq!(bot_check(&recording, 2.0, at(0), &cfg), BotCheck::Wait);
    }

    #[test]
    fn a_bot_done_without_audio_fails_after_the_grace_period() {
        let cfg = PipelineConfig::from_env();
        let media = left(false, Some("timeout_exceeded_waiting_room"));
        assert_eq!(bot_check(&media, 0.2, at(0), &cfg), BotCheck::Wait, "Recall may still publish media");
        assert_eq!(bot_check(&media, 0.2, at(cfg.recall_no_audio_grace_mins - 1), &cfg), BotCheck::Wait);
        assert_eq!(
            bot_check(&media, 0.3, at(cfg.recall_no_audio_grace_mins), &cfg),
            BotCheck::Fail(
                "The bot left without recording: nobody let it in from the waiting room (timeout_exceeded_waiting_room)."
                    .to_string()
            )
        );
        assert_eq!(
            bot_check(&left(false, None), 0.3, at(10), &cfg),
            BotCheck::Fail("The bot left without recording anything.".to_string())
        );
        // Bots sent before audio recording was requested have video and captions but no audio.
        let BotCheck::Fail(reason) = bot_check(&left(true, None), 2.0, at(90), &cfg) else { panic!("should fail") };
        assert!(reason.starts_with("The bot recorded the meeting, but Recall made no audio file"));
    }

    #[test]
    fn audio_still_processing_is_waited_for() {
        let cfg = PipelineConfig::from_env();
        let media = BotMedia { audio_status: Some("processing".to_string()), ..left(true, None) };
        assert_eq!(bot_check(&media, 1.0, at(30), &cfg), BotCheck::Wait);
        let failed = BotMedia { audio_status: Some("failed".to_string()), ..left(true, None) };
        assert!(matches!(bot_check(&failed, 1.0, at(0), &cfg), BotCheck::Fail(_)));
        // The overall limit still applies.
        let late = cfg.recall_max_wait_hours as f64 + 0.1;
        assert!(matches!(bot_check(&media, late, at(30), &cfg), BotCheck::Fail(_)));
    }

    #[test]
    fn a_fatal_bot_fails_at_once_with_its_reason() {
        let cfg = PipelineConfig::from_env();
        let media = BotMedia { status: Some("fatal".to_string()), sub_code: Some("meeting_not_found".to_string()), ..Default::default() };
        assert_eq!(
            bot_check(&media, 0.0, at(0), &cfg),
            BotCheck::Fail("The meeting bot failed: the link does not lead to a meeting (meeting_not_found).".to_string())
        );
    }

    #[test]
    fn sub_codes_read_as_plain_words() {
        assert_eq!(bot_end_reason(None), "Recall gave no reason");
        assert_eq!(bot_end_reason(Some("timeout_exceeded_noone_joined")), "nobody joined the meeting (timeout_exceeded_noone_joined)");
        assert_eq!(bot_end_reason(Some("bot_kicked_from_call")), "it was removed from the meeting (bot_kicked_from_call)");
        assert_eq!(bot_end_reason(Some("zoom_sdk_error")), "Recall reported zoom_sdk_error");
    }
}
