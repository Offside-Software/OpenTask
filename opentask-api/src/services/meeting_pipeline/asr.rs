use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::cf_whisper::CfWhisper;
use super::jobs::{self, ClaimedJob};
use super::llm::{LlmClient, LlmError, WhisperResponse};
use super::media::{self, MediaError, TempDir};
use super::postprocess::match_assignee;
use super::recall::{self, DownloadError};
use super::steps::project_members;
use super::transcript::{assign_speakers, parse_speaker_timeline, segments_from_asr};
use super::keys;
use super::uploads;
use super::usage;
use super::{StepError, StepOutcome, WorkerContext};
use crate::models::meeting::{GateResult, GateVerdict, JobStatus, Segment, SourceType};

const MAX_INLINE_WAIT: Duration = Duration::from_secs(60);
const MAX_INLINE_WAITS: u32 = 3;

/// Stored in `meeting_transcripts.asr_checkpoint` while a recording is being transcribed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AsrCheckpoint {
    pub part_secs: u32,
    pub part_count: usize,
    pub parts: BTreeMap<usize, AsrPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrPart {
    /// Length of this part in seconds; parts are laid end to end.
    pub duration: f32,
    pub response: WhisperResponse,
}

fn db_error(e: sqlx::Error) -> StepError {
    StepError::Retryable(format!("database error: {e}"))
}

fn media_error(e: MediaError) -> StepError {
    match e {
        MediaError::Missing(m) => StepError::Retryable(m),
        MediaError::Invalid(m) => StepError::Fatal(m),
    }
}

/// Whisper's `prompt`: the project and attendee names help it spell them (kept short).
pub fn asr_prompt(language: Option<&str>, project: &str, names: &[String]) -> String {
    let mut prompt = match language {
        Some("id") => format!("Rapat proyek {project}."),
        _ => format!("Project meeting: {project}."),
    };
    if !names.is_empty() {
        let label = if language == Some("id") { "Peserta" } else { "Attendees" };
        prompt.push_str(&format!(" {label}: {}.", names.join(", ")));
    }
    prompt.chars().take(600).collect()
}

/// The language most parts reported.
fn main_language(checkpoint: &AsrCheckpoint) -> Option<String> {
    let mut counts: Vec<(String, f32)> = Vec::new();
    for part in checkpoint.parts.values() {
        if let Some(lang) = part.response.language.clone() {
            match counts.iter_mut().find(|(l, _)| *l == lang) {
                Some((_, total)) => *total += part.duration,
                None => counts.push((lang, part.duration)),
            }
        }
    }
    counts.into_iter().max_by(|a, b| a.1.total_cmp(&b.1)).map(|(l, _)| l)
}

/// Joins checkpointed parts, laid end to end, into one timed transcript.
pub fn join_parts(checkpoint: &AsrCheckpoint) -> Vec<Segment> {
    let mut offset = 0.0f32;
    let mut parts = Vec::with_capacity(checkpoint.part_count);
    for index in 0..checkpoint.part_count {
        let Some(part) = checkpoint.parts.get(&index) else { break };
        parts.push((offset, &part.response));
        offset += part.duration;
    }
    segments_from_asr(&parts)
}

async fn save_checkpoint(ctx: &WorkerContext, job_id: i64, checkpoint: &AsrCheckpoint) -> Result<(), StepError> {
    crate::db::query(
        r#"
        INSERT INTO opentask.meeting_transcripts (job_id, segments, asr_checkpoint, created_at)
        VALUES ($1, '[]'::jsonb, $2, NOW())
        ON CONFLICT (job_id) DO UPDATE SET asr_checkpoint = EXCLUDED.asr_checkpoint;
        "#,
    )
    .bind(job_id)
    .bind(serde_json::to_value(checkpoint).unwrap_or_default())
    .execute(&ctx.pool)
    .await
    .map_err(db_error)?;
    Ok(())
}

enum PartOutcome {
    Done(WhisperResponse),
    Defer(chrono::DateTime<Utc>),
}

async fn transcribe_part(
    llm: &LlmClient,
    ctx: &WorkerContext,
    project_id: i64,
    path: &Path,
    prompt: &str,
    seconds: f32,
) -> Result<PartOutcome, StepError> {
    let mut waits = 0;
    loop {
        match llm
            .transcribe(ctx.cfg.asr_model, path, ctx.cfg.asr_language.as_deref(), Some(prompt), seconds)
            .await
        {
            Ok(response) => return Ok(PartOutcome::Done(response)),
            Err(LlmError::RateLimited { retry_after }) => {
                let wait = retry_after.unwrap_or(Duration::from_secs(60));
                if wait <= MAX_INLINE_WAIT && waits < MAX_INLINE_WAITS {
                    waits += 1;
                    tokio::time::sleep(wait).await;
                    continue;
                }
                let until = Utc::now() + chrono::Duration::from_std(wait).unwrap_or(chrono::Duration::minutes(5));
                if let Some(cf) = cloudflare(ctx, project_id) {
                    match cf.transcribe(path, ctx.cfg.asr_language.as_deref(), Some(prompt), seconds).await {
                        Ok(response) => {
                            tracing::info!("[Meeting Pipeline] Groq Whisper is rate limited; transcribed the part with Cloudflare");
                            return Ok(PartOutcome::Done(response));
                        }
                        Err(e) => tracing::warn!("[Meeting Pipeline] Cloudflare Whisper fallback failed: {e:?}"),
                    }
                }
                return Ok(PartOutcome::Defer(until));
            }
            Err(LlmError::Transient(m)) => return Err(StepError::Retryable(format!("Whisper: {m}"))),
            Err(LlmError::Fatal(m)) => return Err(StepError::Fatal(format!("Whisper rejected the audio: {m}"))),
        }
    }
}

fn cloudflare(ctx: &WorkerContext, project_id: i64) -> Option<CfWhisper<'_>> {
    Some(CfWhisper {
        base_url: &ctx.cfg.cf_api_base,
        account_id: ctx.cfg.cf_account_id.as_deref()?,
        api_token: ctx.cfg.cf_api_token.as_deref()?,
        model: ctx.cfg.cf_asr_model,
        project_id: Some(project_id),
    })
}

enum AudioSource {
    Url(String),
    Stored(String),
}

/// Where the job's audio is, plus Recall's speaker timeline when there is one.
async fn locate_audio(ctx: &WorkerContext, claimed: &ClaimedJob) -> Result<(AudioSource, Option<String>), StepError> {
    match claimed.job.source_type {
        SourceType::RecallBot => {
            let key = ctx
                .config
                .recall_api_key
                .as_deref()
                .ok_or_else(|| StepError::Fatal("RECALL_API_KEY is not configured".to_string()))?;
            let bot_id: Option<String> =
                crate::db::query_scalar("SELECT recall_bot_id FROM opentask.meetings WHERE id = $1;")
                    .bind(claimed.job.meeting_id.0)
                    .fetch_one(&ctx.pool)
                    .await
                    .map_err(db_error)?;
            let bot_id = bot_id.ok_or_else(|| StepError::Fatal("the meeting has no Recall bot".to_string()))?;
            let bot = recall::get_bot(&ctx.config.recall_base_url, key, &bot_id)
                .await
                .map_err(StepError::Retryable)?;
            let media = recall::bot_media(&bot);
            let audio = media
                .audio_url
                .ok_or_else(|| StepError::Retryable("Recall has not published the audio yet".to_string()))?;
            Ok((AudioSource::Url(audio), media.speaker_timeline_url))
        }
        SourceType::Media => {
            let key = claimed
                .job
                .r2_keys
                .0
                .first()
                .cloned()
                .ok_or_else(|| StepError::Fatal("the job has no uploaded recording".to_string()))?;
            Ok((AudioSource::Stored(key), None))
        }
        other => Err(StepError::Fatal(format!("a {other} job has no recording to transcribe"))),
    }
}

fn download_error(e: DownloadError) -> StepError {
    match e {
        DownloadError::TooLarge(m) => StepError::Fatal(m),
        DownloadError::Failed(m) => StepError::Retryable(m),
    }
}

async fn stored_checkpoint(ctx: &WorkerContext, job_id: i64) -> Result<Option<AsrCheckpoint>, StepError> {
    let stored: Option<Value> =
        crate::db::query_scalar("SELECT asr_checkpoint FROM opentask.meeting_transcripts WHERE job_id = $1;")
            .bind(job_id)
            .fetch_optional(&ctx.pool)
            .await
            .map_err(db_error)?
            .flatten();
    Ok(stored.and_then(|v| serde_json::from_value::<AsrCheckpoint>(v).ok()))
}

pub async fn transcribe_step(ctx: &WorkerContext, claimed: &ClaimedJob) -> Result<StepOutcome, StepError> {
    let llm = &keys::llm_for(ctx, claimed.project_id.map(|p| p.0).unwrap_or_default())
        .await?
        .ok_or_else(|| StepError::Fatal("No Groq API key: set GROQ_API_KEY or the project's own key".to_string()))?;
    let job = &claimed.job;
    let job_id = job.id.0;
    let project_id = claimed.project_id.map(|p| p.0).unwrap_or_default();
    let pool = &ctx.pool;
    let cfg = &ctx.cfg;

    let (source, timeline_url) = locate_audio(ctx, claimed).await?;
    let stored = stored_checkpoint(ctx, job_id).await?;
    let dir = TempDir::create("opentask-meeting").map_err(|e| StepError::Retryable(format!("no temp dir: {e}")))?;

    // Every part already transcribed (a retry after a crash, or after the upload was removed)
    let complete = stored
        .as_ref()
        .filter(|c| c.part_secs == cfg.asr_part_secs && c.part_count > 0 && c.parts.len() == c.part_count)
        .cloned();
    let (mut checkpoint, parts) = match complete {
        Some(checkpoint) => (checkpoint, Vec::new()),
        None => {
            let input = dir.path().join("recording");
            let max_bytes = cfg.max_download_mb * 1024 * 1024;
            match &source {
                AudioSource::Url(url) => recall::download_to_file(url, &input, max_bytes).await.map_err(download_error)?,
                AudioSource::Stored(key) => {
                    let store = cfg
                        .media_store
                        .as_ref()
                        .ok_or_else(|| StepError::Fatal("recording uploads are not configured".to_string()))?;
                    store.download(key, &input, max_bytes).await.map_err(download_error)?
                }
            };

            let duration = media::probe_audio_duration(&cfg.ffprobe_path, &input).await.map_err(media_error)?;
            if duration > cfg.max_audio_minutes as f32 * 60.0 {
                return Err(StepError::Fatal(format!(
                    "the recording is {} minutes; the limit is {}",
                    (duration / 60.0).round(),
                    cfg.max_audio_minutes
                )));
            }
            crate::db::query("UPDATE opentask.meeting_jobs SET duration_sec = $2 WHERE id = $1;")
                .bind(job_id)
                .bind(duration.round() as i32)
                .execute(pool)
                .await
                .map_err(db_error)?;

            let parts_dir = dir.path().join("parts");
            std::fs::create_dir_all(&parts_dir).map_err(|e| StepError::Retryable(format!("no temp dir: {e}")))?;
            let parts = media::split_for_asr(&cfg.ffmpeg_path, &input, &parts_dir, cfg.asr_part_secs, cfg.asr_bitrate)
                .await
                .map_err(media_error)?;
            let checkpoint = stored
                .filter(|c| c.part_secs == cfg.asr_part_secs && c.part_count == parts.len())
                .unwrap_or_else(|| AsrCheckpoint { part_secs: cfg.asr_part_secs, part_count: parts.len(), ..Default::default() });
            (checkpoint, parts)
        }
    };

    let project_name: Option<String> = crate::db::query_scalar("SELECT name FROM opentask.projects WHERE id = $1;")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(db_error)?;
    let attendee_names: Vec<String> = crate::db::query_scalar(
        "SELECT COALESCE(NULLIF(display_name, ''), gh_username, '') FROM opentask.users WHERE id = ANY($1);",
    )
    .bind(job.attendee_ids.iter().map(|a| a.0).collect::<Vec<i64>>())
    .fetch_all(pool)
    .await
    .map_err(db_error)?;
    let prompt = asr_prompt(cfg.asr_language.as_deref(), project_name.as_deref().unwrap_or(""), &attendee_names);

    for (index, path) in parts.iter().enumerate() {
        if checkpoint.parts.contains_key(&index) {
            continue;
        }
        let part_duration = media::probe_audio_duration(&cfg.ffprobe_path, path).await.map_err(media_error)?;
        if cfg.project_audio_minutes_per_day > 0 && !llm.has_own_key() {
            let used = usage::project_audio_today(pool, project_id, cfg).await.map_err(db_error)?;
            if used + part_duration.ceil() as i64 > cfg.project_audio_minutes_per_day as i64 * 60 {
                return Ok(StepOutcome::Defer {
                    until: usage::next_utc_midnight(Utc::now()),
                    reason: format!("the project's {} transcription minutes for today are used up", cfg.project_audio_minutes_per_day),
                });
            }
        }
        match transcribe_part(llm, ctx, project_id, path, &prompt, part_duration).await? {
            PartOutcome::Done(response) => {
                tracing::info!(
                    "[Meeting Pipeline] Job {job_id}: transcribed part {}/{} ({:.0}s, {} segments)",
                    index + 1,
                    parts.len(),
                    part_duration,
                    response.segments.len()
                );
                checkpoint.parts.insert(index, AsrPart { duration: part_duration, response });
                save_checkpoint(ctx, job_id, &checkpoint).await?;
                jobs::renew_lease(pool, job_id, cfg.lease_minutes).await.map_err(db_error)?;
            }
            PartOutcome::Defer(until) => {
                return Ok(StepOutcome::Defer { until, reason: "Groq Whisper rate limit".to_string() });
            }
        }
    }

    let mut segments = join_parts(&checkpoint);
    if let Some(url) = timeline_url {
        match recall::fetch_json(&url).await {
            Ok(timeline) => assign_speakers(&mut segments, &parse_speaker_timeline(&timeline)),
            Err(e) => tracing::warn!("[Meeting Pipeline] Job {job_id}: no speaker timeline: {e}"),
        }
    }

    if job.attendee_ids.is_empty() {
        let members = project_members(pool, project_id).await.map_err(db_error)?;
        let mut speakers: Vec<&str> = segments.iter().filter_map(|s| s.speaker.as_deref()).collect();
        speakers.sort_unstable();
        speakers.dedup();
        let mut attendees: Vec<i64> = Vec::new();
        for speaker in speakers {
            if let Some(id) = match_assignee(speaker, &members)
                && !attendees.contains(&id)
            {
                attendees.push(id);
            }
        }
        if !attendees.is_empty() {
            crate::db::query("UPDATE opentask.meeting_jobs SET attendee_ids = $2 WHERE id = $1;")
                .bind(job_id)
                .bind(&attendees)
                .execute(pool)
                .await
                .map_err(db_error)?;
        }
    }

    crate::db::query("UPDATE opentask.meeting_transcripts SET language = $2, segments = $3 WHERE job_id = $1;")
        .bind(job_id)
        .bind(main_language(&checkpoint))
        .bind(serde_json::to_value(&segments).unwrap_or_default())
        .execute(pool)
        .await
        .map_err(db_error)?;
    tracing::info!("[Meeting Pipeline] Job {job_id}: transcript has {} segments", segments.len());

    if let (AudioSource::Stored(_), Some(store)) = (&source, cfg.media_store.as_ref()) {
        uploads::release_objects(pool, store, job_id, &job.r2_keys.0).await;
    }

    if segments.is_empty() {
        let gate = GateResult {
            verdict: GateVerdict::No,
            reason: Some("No speech was found in the recording.".to_string()),
            doc_type: Some("meeting_transcript".to_string()),
            model: None,
            failed_open: false,
        };
        crate::db::query("UPDATE opentask.meeting_jobs SET gate = $2 WHERE id = $1;")
            .bind(job_id)
            .bind(serde_json::to_value(&gate).unwrap_or_default())
            .execute(pool)
            .await
            .map_err(db_error)?;
        return Ok(StepOutcome::Next(JobStatus::NoActions));
    }

    // A bot recording is a meeting by definition, so it skips the gate.
    Ok(StepOutcome::Next(match job.source_type {
        SourceType::RecallBot => JobStatus::Extracting,
        _ => JobStatus::Gating,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::meeting_pipeline::llm::WhisperSegment;

    fn part(duration: f32, language: &str, lines: &[(f32, f32, &str)]) -> AsrPart {
        AsrPart {
            duration,
            response: WhisperResponse {
                language: Some(language.to_string()),
                duration: Some(duration),
                segments: lines
                    .iter()
                    .map(|(s, e, t)| WhisperSegment { start: *s, end: *e, text: t.to_string(), ..Default::default() })
                    .collect(),
            },
        }
    }

    #[test]
    fn parts_are_laid_end_to_end_using_their_real_durations() {
        let mut checkpoint = AsrCheckpoint { part_secs: 1200, part_count: 2, parts: BTreeMap::new() };
        checkpoint.parts.insert(0, part(1199.5, "indonesian", &[(10.0, 12.0, "Halo semua.")]));
        checkpoint.parts.insert(1, part(300.0, "indonesian", &[(1.0, 4.0, "Saya akan kirim laporan.")]));
        let segments = join_parts(&checkpoint);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[1].start_sec, Some(1200.5));
        assert_eq!(main_language(&checkpoint).as_deref(), Some("indonesian"));
    }

    #[test]
    fn missing_parts_stop_the_join() {
        let mut checkpoint = AsrCheckpoint { part_secs: 1200, part_count: 3, parts: BTreeMap::new() };
        checkpoint.parts.insert(0, part(1200.0, "en", &[(0.0, 1.0, "One.")]));
        checkpoint.parts.insert(2, part(100.0, "en", &[(0.0, 1.0, "Three.")]));
        assert_eq!(join_parts(&checkpoint).len(), 1);
    }

    #[test]
    fn checkpoint_round_trips_through_json() {
        let mut checkpoint = AsrCheckpoint { part_secs: 1200, part_count: 1, parts: BTreeMap::new() };
        checkpoint.parts.insert(0, part(42.0, "en", &[(0.0, 1.0, "Hi.")]));
        let back: AsrCheckpoint = serde_json::from_value(serde_json::to_value(&checkpoint).unwrap()).unwrap();
        assert_eq!(back.parts[&0].response.segments[0].text, "Hi.");
    }

    #[test]
    fn prompt_names_project_and_attendees() {
        let names = vec!["Budi Santoso".to_string(), "Sari Dewi".to_string()];
        assert_eq!(asr_prompt(Some("id"), "OpenTask", &names), "Rapat proyek OpenTask. Peserta: Budi Santoso, Sari Dewi.");
        assert_eq!(asr_prompt(None, "OpenTask", &[]), "Project meeting: OpenTask.");
    }
}
