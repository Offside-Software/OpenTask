//! End-to-end meeting pipeline flows against a local Postgres, with mock Groq and Recall servers.
//!
//!   TEST_DATABASE_URL=postgres://opentask:opentask@localhost:5433/opentask_test cargo test --test meeting_flow_db
//!
//! Skipped when TEST_DATABASE_URL is unset; refuses anything but localhost (it clears meeting jobs).

use std::str::FromStr;
use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;

use opentask_api::config::Config;
use opentask_api::error::AppError;
use opentask_api::models::meeting::{ApproveDraftItem, GateVerdict, JobStatus, MeetingStatus, SourceType};
use opentask_api::models::safe_id::SafeId;
use opentask_api::services::id_generator::next_id;
use opentask_api::services::meeting_pipeline::config::{GroqTier, PipelineConfig};
use opentask_api::services::meeting_pipeline::intake::{self, NewMeeting};
use opentask_api::services::meeting_pipeline::llm::LlmClient;
use opentask_api::services::meeting_pipeline::media;
use opentask_api::services::meeting_pipeline::storage::{LocalStore, MediaStore};
use opentask_api::services::meeting_pipeline::uploads::{self, UploadFile};
use opentask_api::services::meeting_pipeline::{health, keys, retention};
use opentask_api::services::meeting_pipeline::{review, run_next_job, WorkerContext};
use opentask_api::services::realtime::RealtimeHub;

// ---------- mock Groq ----------

#[derive(Default)]
struct MockState {
    /// (kind, chunk header) of every chat call.
    calls: Vec<(String, String)>,
    rate_limited_once: bool,
    failed_chunk_two_once: bool,
    whisper_calls: u32,
    whisper_language: Option<String>,
    /// Groq Whisper answers 429 with a long Retry-After while this is set.
    whisper_rate_limited: bool,
    cf_calls: u32,
    /// The bearer token of every chat call.
    chat_keys: Vec<String>,
}

type Shared = Arc<Mutex<MockState>>;

fn reply(content: Value) -> Response {
    Json(json!({
        "choices": [{ "message": { "role": "assistant", "content": content.to_string() } }],
        "usage": { "prompt_tokens": 100, "completion_tokens": 20 }
    }))
    .into_response()
}

/// Turns every record line that commits to work ("akan" / "will") into a task quoting it.
fn tasks_for(record: &str) -> Value {
    let tasks: Vec<Value> = record
        .lines()
        .filter(|line| line.contains(" akan ") || line.contains(" will "))
        .map(|line| {
            let mut text = line.trim();
            if text.starts_with('[') {
                text = text.split_once("] ").map(|(_, rest)| rest).unwrap_or(text);
            }
            let (speaker, quote) = match text.split_once(": ") {
                Some((s, q)) if s.split_whitespace().count() <= 2 => (Some(s.to_string()), q),
                _ => (None, text),
            };
            let hint = speaker.or_else(|| quote.split_whitespace().next().map(str::to_string));
            json!({
                "title": format!("Follow up: {}", quote.chars().take(60).collect::<String>()),
                "description": null,
                "type": "code",
                "weight": 3,
                "priority": if quote.contains("urgent") { json!("high") } else { Value::Null },
                "assignee_hint": hint,
                "due_text": if quote.contains("Jumat") { json!("Jumat") } else { Value::Null },
                "due_date": if quote.contains("Jumat") { json!("2026-10-23") } else { Value::Null },
                "evidence_quote": quote,
                "confidence": "high"
            })
        })
        .collect();
    json!({ "tasks": tasks })
}

async fn groq_chat(State(state): State<Shared>, headers: axum::http::HeaderMap, Json(body): Json<Value>) -> Response {
    let bearer = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").trim_start_matches("Bearer ").to_string();
    state.lock().unwrap().chat_keys.push(bearer);
    let user = body["messages"][1]["content"].as_str().unwrap_or("").to_string();
    let kind = match body["response_format"]["type"].as_str() {
        Some("json_object") => "gate".to_string(),
        _ => body["response_format"]["json_schema"]["name"].as_str().unwrap_or("?").to_string(),
    };
    let chunk = user.lines().find(|l| l.starts_with("chunk: ")).unwrap_or("").to_string();
    let record = user
        .split_once("<record>\n")
        .and_then(|(_, rest)| rest.rsplit_once("\n</record>"))
        .map(|(r, _)| r.to_string())
        .unwrap_or_default();
    let mut s = state.lock().unwrap();
    s.calls.push((kind.clone(), chunk.clone()));

    match kind.as_str() {
        "gate" if user.contains("RECIPE") => {
            reply(json!({ "doc_type": "other", "actionable": "no", "reason": "This is a recipe, not a meeting." }))
        }
        "gate" => reply(json!({ "doc_type": "meeting_minutes", "actionable": "yes", "reason": "Commitments found." })),
        "meeting_tasks" => {
            if user.contains("RATE_LIMIT_ONCE") && !s.rate_limited_once {
                s.rate_limited_once = true;
                return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "1")], "slow down").into_response();
            }
            if record.contains("FAIL_CHUNK_TWO_ONCE") && chunk.starts_with("chunk: 2/") && !s.failed_chunk_two_once {
                s.failed_chunk_two_once = true;
                return (StatusCode::BAD_GATEWAY, "upstream hiccup").into_response();
            }
            reply(tasks_for(&record))
        }
        "meeting_summary" => reply(json!({ "mom_summary": "Weekly sync summary.", "key_decisions": ["Ship on Friday"] })),
        _ => (StatusCode::BAD_REQUEST, "unexpected request").into_response(),
    }
}

// ---------- Mock Recall ----------

/// Bot lifecycle the mock reports
#[derive(Clone, Copy, PartialEq)]
enum BotPhase {
    Recording,
    Done,
    Fatal,
    LeftWithoutAudio { minutes_ago: i64 },
}

#[derive(Clone)]
struct RecallMock {
    base: String,
    phase: Arc<Mutex<BotPhase>>,
    audio: Arc<Vec<u8>>,
}

async fn recall_create_bot(Json(body): Json<Value>) -> Response {
    assert!(body["recording_config"]["audio_mixed_mp3"].is_object(), "the bot must record mixed audio");
    assert!(body["recording_config"]["transcript"].is_null(), "no Recall transcript provider");
    (StatusCode::CREATED, Json(json!({ "id": format!("bot-{}", next_id()) }))).into_response()
}

async fn recall_get_bot(State(mock): State<RecallMock>, Path(id): Path<String>) -> Json<Value> {
    let phase = *mock.phase.lock().unwrap();
    let (codes, shortcuts) = match phase {
        BotPhase::Recording => (vec!["joining_call", "in_call_recording"], json!({ "audio_mixed": null })),
        BotPhase::Done => (
            vec!["joining_call", "in_call_recording", "call_ended", "done"],
            json!({
                "audio_mixed": { "status": { "code": "done" }, "data": { "download_url": format!("{}/files/{id}/audio", mock.base) } },
                "participant_events": { "data": { "speaker_timeline_download_url": format!("{}/files/{id}/timeline", mock.base) } }
            }),
        ),
        BotPhase::Fatal => (vec!["joining_call", "fatal"], json!({})),
        BotPhase::LeftWithoutAudio { .. } => (vec!["joining_call", "in_waiting_room", "call_ended", "done"], Value::Null),
    };
    let minutes_ago = match phase {
        BotPhase::LeftWithoutAudio { minutes_ago } => minutes_ago,
        _ => 0,
    };
    let at = (Utc::now() - chrono::Duration::minutes(minutes_ago)).to_rfc3339();
    let status_changes: Vec<Value> = codes
        .iter()
        .map(|c| {
            let sub_code = match *c {
                "fatal" => json!("meeting_not_found"),
                "call_ended" if matches!(phase, BotPhase::LeftWithoutAudio { .. }) => json!("timeout_exceeded_waiting_room"),
                _ => Value::Null,
            };
            json!({ "code": c, "sub_code": sub_code, "created_at": at })
        })
        .collect();
    // A bot that never recorded has no recordings at all.
    let recordings = if shortcuts.is_null() { json!([]) } else { json!([{ "id": "rec-1", "media_shortcuts": shortcuts }]) };
    Json(json!({ "id": id, "status_changes": status_changes, "recordings": recordings }))
}

async fn recall_audio(State(mock): State<RecallMock>) -> Vec<u8> {
    mock.audio.as_ref().clone()
}

async fn recall_timeline() -> Json<Value> {
    let turn = |name: &str, start: f64, end: f64| {
        json!({ "participant": { "id": 1, "name": name }, "start_timestamp": { "relative": start }, "end_timestamp": { "relative": end } })
    };
    Json(json!([turn("Budi Santoso", 0.0, 9.5), turn("Sari Dewi", 9.5, 20.0)]))
}

// ---------- mock Whisper ----------

async fn groq_transcribe(State(state): State<Shared>, body: axum::body::Bytes) -> Response {
    let form = String::from_utf8_lossy(&body);
    let mut s = state.lock().unwrap();
    s.whisper_calls += 1;
    if s.whisper_rate_limited {
        return (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "600")], "audio seconds per hour exceeded").into_response();
    }
    s.whisper_language = form
        .split("name=\"language\"")
        .nth(1)
        .and_then(|rest| rest.trim_start_matches('\r').trim_start_matches('\n').lines().find(|l| !l.trim().is_empty()))
        .map(|l| l.trim().to_string());
    let segment = |start: f64, end: f64, text: &str| {
        json!({ "start": start, "end": end, "text": text, "avg_logprob": -0.2, "no_speech_prob": 0.01, "compression_ratio": 1.3 })
    };
    Json(json!({
        "language": "indonesian",
        "duration": 15.0,
        "segments": [
            segment(0.0, 4.0, " Selamat pagi semua, kita mulai rapat mingguan."),
            segment(5.0, 9.0, " Saya akan menyiapkan laporan keuangan sebelum Jumat."),
            segment(10.0, 14.0, " Saya akan memperbaiki bug login hari ini."),
            { "start": 14.0, "end": 15.0, "text": " Terima kasih telah menonton.", "avg_logprob": -1.5, "no_speech_prob": 0.95, "compression_ratio": 1.0 }
        ]
    }))
    .into_response()
}

// ---------- mock Cloudflare Workers AI ----------

async fn cf_whisper(State(state): State<Shared>, Path((account, model)): Path<(String, String)>, Json(body): Json<Value>) -> Response {
    assert_eq!(account, "acct-1");
    assert_eq!(model, "@cf/openai/whisper-large-v3-turbo");
    assert!(body["audio"].as_str().is_some_and(|a| a.len() > 100), "the part goes as base64");
    state.lock().unwrap().cf_calls += 1;
    let segment = |start: f64, end: f64, text: &str| json!({ "start": start, "end": end, "text": text, "avg_logprob": -0.2, "no_speech_prob": 0.01 });
    Json(json!({
        "success": true,
        "errors": [],
        "result": {
            "transcription_info": { "language": "id", "duration": 15.0 },
            "text": "...",
            "segments": [
                segment(0.0, 4.0, " Selamat pagi, ini rapat evaluasi."),
                segment(5.0, 9.0, " Saya akan mengirim notulen ke klien besok.")
            ]
        }
    }))
    .into_response()
}

async fn groq_models(headers: axum::http::HeaderMap) -> Response {
    let bearer = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("");
    if bearer.contains("rejected") {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": { "message": "Invalid API Key" } }))).into_response();
    }
    Json(json!({ "object": "list", "data": [] })).into_response()
}

/// 15 s of tone as WAV, made with ffmpeg (None when ffmpeg is not installed).
fn test_audio(ffmpeg: &str) -> Option<Vec<u8>> {
    let dir = std::env::temp_dir().join(format!("opentask-test-audio-{}", next_id()));
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("tone.wav");
    let ok = std::process::Command::new(ffmpeg)
        .args(["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=15", "-ac", "1", "-ar", "16000"])
        .arg(&path)
        .status()
        .is_ok_and(|s| s.success());
    let bytes = if ok { std::fs::read(&path).ok() } else { None };
    let _ = std::fs::remove_dir_all(&dir);
    bytes
}

async fn serve(router: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}")
}

// ---------- fixtures ----------

async fn test_pool() -> Option<PgPool> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let options = PgConnectOptions::from_str(&url).unwrap().statement_cache_capacity(0);
    assert!(
        matches!(options.get_host(), "localhost" | "127.0.0.1" | "::1"),
        "TEST_DATABASE_URL must point at a local, disposable database"
    );
    Some(PgPoolOptions::new().max_connections(3).connect_with(options).await.unwrap())
}

struct Project {
    id: i64,
    owner: i64,
    budi: i64,
    sari: i64,
    todo_bucket: i64,
}

async fn seed(pool: &PgPool) -> Project {
    let id = next_id();
    let users = [(next_id(), "Nicho Owner", "nicho"), (next_id(), "Budi Santoso", "budis"), (next_id(), "Sari Dewi", "saridewi")];
    for (uid, name, login) in users {
        sqlx::query("INSERT INTO opentask.users (id, display_name, gh_username, gh_id) VALUES ($1, $2, $3, $4);")
            .bind(uid)
            .bind(name)
            .bind(format!("{login}{uid}"))
            .bind((uid % 1_000_000).to_string())
            .execute(pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO opentask.projects (id, name) VALUES ($1, 'Flow test');")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    for (uid, _, _) in users {
        sqlx::query("INSERT INTO opentask.project_member (id, project_id, user_id, role) VALUES ($1, $2, $3, 'PROGRAMMER');")
            .bind(next_id())
            .bind(id)
            .bind(uid)
            .execute(pool)
            .await
            .unwrap();
    }
    // A project created before AI Drafts existed: only a Todo column.
    let todo_bucket = next_id();
    sqlx::query("INSERT INTO opentask.buckets (id, project_id, name, state, order_idx) VALUES ($1, $2, 'Todo', 'TODO', 0);")
        .bind(todo_bucket)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    Project { id, owner: users[0].0, budi: users[1].0, sari: users[2].0, todo_bucket }
}

fn new_meeting(p: &Project, source_type: SourceType, title: &str) -> NewMeeting {
    NewMeeting {
        project_id: p.id,
        created_by: p.owner,
        title: title.to_string(),
        source_type,
        meeting_date: chrono::NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(),
        timezone: "Asia/Jakarta".to_string(),
        attendee_ids: vec![p.budi, p.sari],
    }
}

fn notes(extra: &str) -> String {
    format!(
        "Rapat mingguan tim produk, 19 Oktober 2026. Hadir: Budi Santoso, Sari Dewi, Nicho.\n\n\
         Budi akan menyiapkan laporan keuangan sebelum Jumat, ini urgent untuk klien.\n\n\
         Diskusi panjang tentang roadmap kuartal depan tanpa keputusan baru.\n\n\
         Sari will update the onboarding docs for the new release.\n\n{extra}"
    )
}

async fn job_status(pool: &PgPool, job_id: i64) -> JobStatus {
    sqlx::query_scalar("SELECT status FROM opentask.meeting_jobs WHERE id = $1;")
        .bind(job_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn meeting_flows_against_postgres() {
    let Some(pool) = test_pool().await else {
        eprintln!("skipped: set TEST_DATABASE_URL to a local Postgres with the base schema");
        return;
    };
    opentask_api::db::init_database(&pool).await.unwrap();
    sqlx::query("DELETE FROM opentask.meeting_jobs;").execute(&pool).await.unwrap();

    let state: Shared = Arc::new(Mutex::new(MockState::default()));
    let groq = serve(
        Router::new()
            .route("/chat/completions", post(groq_chat))
            .route("/models", get(groq_models))
            .route("/audio/transcriptions", post(groq_transcribe))
            .route("/accounts/{account}/ai/run/{*model}", post(cf_whisper))
            .with_state(state.clone()),
    )
    .await;

    let pipeline_cfg = PipelineConfig::from_env();
    let ffmpeg_ready = media::tools_available(&pipeline_cfg.ffmpeg_path, &pipeline_cfg.ffprobe_path);
    let audio = if ffmpeg_ready { test_audio(&pipeline_cfg.ffmpeg_path).unwrap_or_default() } else { Vec::new() };
    let recall_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let recall = format!("http://{}", recall_listener.local_addr().unwrap());
    let phase = Arc::new(Mutex::new(BotPhase::Recording));
    let recall_router = Router::new()
        .route("/api/v1/bot/", post(recall_create_bot))
        .route("/api/v1/bot/{id}/", get(recall_get_bot))
        .route("/files/{id}/audio", get(recall_audio))
        .route("/files/{id}/timeline", get(recall_timeline))
        .with_state(RecallMock { base: recall.clone(), phase: phase.clone(), audio: Arc::new(audio) });
    tokio::spawn(async move { axum::serve(recall_listener, recall_router).await.unwrap() });

    let mut config = Config::load();
    config.telegram_bot_token = None;
    config.recall_api_key = Some("test-key".to_string());
    config.recall_base_url = recall.clone();
    let mut cfg = PipelineConfig::from_env();
    cfg.groq_base_url = groq.clone();
    cfg.cf_account_id = None;
    cfg.cf_api_token = None;
    let media_dir = std::env::temp_dir().join(format!("opentask-test-media-{}", next_id()));
    cfg.media_store = Some(MediaStore::Local(LocalStore::new(media_dir.clone())));
    let llm = LlmClient::new(&groq, "test-key");
    let ctx = WorkerContext { pool: pool.clone(), config, realtime: RealtimeHub::new(), cfg, llm: Some(llm.clone()) };

    let p = seed(&pool).await;
    text_job_to_review(&ctx, &p, &llm, &state).await;
    gate_no_ends_without_tasks(&ctx, &p, &llm).await;
    recall_bot_failure_fails_the_job(&ctx, &p, &phase).await;
    recall_bot_without_audio_fails_after_grace(&ctx, &p, &phase).await;
    abandoned_upload_fails_and_is_removed(&ctx, &p).await;
    if ffmpeg_ready {
        recall_bot_to_drafts(&ctx, &p, &phase, &state).await;
        let audio = test_audio(&ctx.cfg.ffmpeg_path).expect("test audio");
        media_upload_to_drafts(&ctx, &p, &audio).await;
        media_falls_back_to_cloudflare(&ctx, &p, &state, &groq, &audio).await;
        transcription_waits_for_tomorrow_when_minutes_run_out(&ctx, &audio).await;
    } else {
        eprintln!("skipped the Recall audio scenario: ffmpeg/ffprobe not found (set FFMPEG_PATH / FFPROBE_PATH)");
    }
    crash_mid_extraction_resumes_from_checkpoint(&ctx, &p, &llm, &state).await;
    project_quotas_refuse_new_jobs(&ctx, &llm).await;
    health_retention_and_retry(&ctx, &p, &llm).await;
    project_key_is_used_and_lifts_quotas(&ctx, &state).await;

    let _ = std::fs::remove_dir_all(&media_dir);
    pool.close().await;
}

async fn text_job_to_review(ctx: &WorkerContext, p: &Project, llm: &LlmClient, state: &Shared) {
    let pool = &ctx.pool;
    let created = intake::create_text_job(
        pool,
        &ctx.realtime,
        &ctx.cfg,
        Some(llm),
        new_meeting(p, SourceType::Text, "Weekly sync"),
        &notes("RATE_LIMIT_ONCE"),
    )
    .await
    .unwrap();
    assert_eq!(created.job.status, JobStatus::Queued);
    assert_eq!(created.job.gate.as_ref().map(|g| g.verdict), Some(GateVerdict::Yes));
    let job_id = created.job.id.0;

    assert!(run_next_job(ctx).await, "the queued job was not claimed");
    assert!(state.lock().unwrap().rate_limited_once, "the 429 path was not exercised");
    assert_eq!(job_status(pool, job_id).await, JobStatus::DraftsReady);

    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.meeting.status, MeetingStatus::Completed);
    assert_eq!(detail.meeting.mom_summary.as_deref(), Some("Weekly sync summary."));
    assert_eq!(detail.drafts.len(), 2, "one task per commitment");
    assert!(detail.drafts.iter().all(|d| d.evidence_verified && d.bucket_state.as_deref() == Some("DRAFT")));
    assert!(detail.drafts.iter().all(|d| d.lead_assignee_id.is_none()), "drafts stay unassigned");
    let report = detail.drafts.iter().find(|d| d.evidence_quote.contains("laporan")).unwrap();
    let docs = detail.drafts.iter().find(|d| d.evidence_quote.contains("onboarding")).unwrap();
    assert_eq!(report.resolved_user_id.map(|u| u.0), Some(p.budi));
    assert_eq!(report.priority.as_deref(), Some("high"));
    assert_eq!(report.due_date, chrono::NaiveDate::from_ymd_opt(2026, 10, 23));
    assert_eq!(docs.resolved_user_id.map(|u| u.0), Some(p.sari));
    assert_eq!(report.task_type.as_deref(), Some("CODE"));

    let alert: (bool, i64, String) = sqlx::query_as(
        "SELECT a.is_resolved, a.user_id, a.type FROM opentask.alerts a JOIN opentask.meeting_jobs j ON j.alert_id = a.id WHERE j.id = $1;",
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(alert, (false, p.owner, "DRAFT_APPROVAL".to_string()));

    let summary = review::list_jobs(pool, p.id).await.unwrap();
    let listed = summary.iter().find(|s| s.job.id.0 == job_id).unwrap();
    assert_eq!((listed.pending_drafts, listed.total_drafts), (2, 2));

    // Approve the report into Todo, assigned to Budi, with the extracted due date and priority.
    let approve = vec![ApproveDraftItem {
        task_id: report.task_id,
        title: Some("Siapkan laporan keuangan".to_string()),
        description: Some("Untuk klien".to_string()),
        task_type: None,
        weight: Some(5),
        bucket_id: None,
        assignee_ids: vec![SafeId(p.budi)],
        due_date: None,
        priority: None,
    }];
    let approved = review::approve(pool, job_id, p.id, &approve).await.unwrap();
    assert_eq!(approved.pending_drafts, 1);
    assert_eq!(approved.job.status, JobStatus::DraftsReady);
    let task: (i64, Option<i64>, String, i32) = sqlx::query_as(
        "SELECT bucket_id, lead_assignee_id, description, weight FROM opentask.tasks WHERE id = $1;",
    )
    .bind(report.task_id.0)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(task.0, p.todo_bucket);
    assert_eq!(task.1, Some(p.budi));
    assert_eq!(task.2, "Untuk klien\n\nDue: 2026-10-23 (\u{201c}Jumat\u{201d})\nPriority: high");
    assert_eq!(task.3, 5);

    // Approving it again is refused; so is assigning a stranger.
    assert!(matches!(review::approve(pool, job_id, p.id, &approve).await, Err(AppError::Conflict(_))));
    let stranger = vec![ApproveDraftItem { task_id: docs.task_id, assignee_ids: vec![SafeId(next_id())], ..approve[0].clone() }];
    assert!(matches!(review::approve(pool, job_id, p.id, &stranger).await, Err(AppError::BadRequest(_))));

    // Rejecting the last draft archives it, ends the review and resolves the alert.
    let rejected = review::reject(pool, job_id, p.id, &[docs.task_id]).await.unwrap();
    assert_eq!((rejected.pending_drafts, rejected.job.status), (0, JobStatus::Reviewed));
    let archived_state: String = sqlx::query_scalar(
        "SELECT b.state FROM opentask.tasks t JOIN opentask.buckets b ON b.id = t.bucket_id WHERE t.id = $1;",
    )
    .bind(docs.task_id.0)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(archived_state, "ARCHIVED");
    let resolved: bool = sqlx::query_scalar(
        "SELECT a.is_resolved FROM opentask.alerts a JOIN opentask.meeting_jobs j ON j.alert_id = a.id WHERE j.id = $1;",
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(resolved);
    assert!(matches!(review::reject(pool, job_id, p.id, &[docs.task_id]).await, Err(AppError::Conflict(_))));

    move_to_column(pool, p.id, report.task_id.0, "DRAFT").await;
    assert_eq!(review::sync_review_status(pool, Some(p.id), None).await.unwrap(), vec![job_id]);
    assert_eq!(job_status(pool, job_id).await, JobStatus::DraftsReady);
    assert!(review::sync_review_status(pool, Some(p.id), None).await.unwrap().is_empty(), "already in line");
    let again = ApproveDraftItem { description: None, ..approve[0].clone() };
    let reapproved = review::approve(pool, job_id, p.id, &[again]).await.unwrap();
    assert_eq!((reapproved.pending_drafts, reapproved.job.status), (0, JobStatus::Reviewed));
    let description: String = sqlx::query_scalar("SELECT description FROM opentask.tasks WHERE id = $1;")
        .bind(report.task_id.0)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(description, "Untuk klien\n\nDue: 2026-10-23 (\u{201c}Jumat\u{201d})\nPriority: high");

    move_to_column(pool, p.id, docs.task_id.0, "DRAFT").await;
    assert_eq!(review::sync_review_status(pool, None, Some(job_id)).await.unwrap(), vec![job_id]);
    let rejected_again = review::reject(pool, job_id, p.id, &[docs.task_id]).await.unwrap();
    assert_eq!(rejected_again.job.status, JobStatus::Reviewed);
    move_to_column(pool, p.id, docs.task_id.0, "DRAFT").await;
    review::sync_review_status(pool, Some(p.id), None).await.unwrap();
    move_to_column(pool, p.id, docs.task_id.0, "TODO").await;
    assert_eq!(review::sync_review_status(pool, Some(p.id), None).await.unwrap(), vec![job_id]);
    assert_eq!(job_status(pool, job_id).await, JobStatus::Reviewed);
    let listed = review::list_jobs(pool, p.id).await.unwrap();
    let listed = listed.iter().find(|s| s.job.id.0 == job_id).unwrap();
    assert_eq!((listed.pending_drafts, listed.total_drafts), (0, 2));
}

async fn move_to_column(pool: &PgPool, project_id: i64, task_id: i64, state: &str) {
    sqlx::query(
        "UPDATE opentask.tasks SET bucket_id = (SELECT id FROM opentask.buckets WHERE project_id = $2 AND state = $3 ORDER BY order_idx LIMIT 1) WHERE id = $1;",
    )
    .bind(task_id)
    .bind(project_id)
    .bind(state)
    .execute(pool)
    .await
    .unwrap();
}

async fn gate_no_ends_without_tasks(ctx: &WorkerContext, p: &Project, llm: &LlmClient) {
    let text = "RECIPE: Nasi goreng. ".repeat(20);
    let created = intake::create_text_job(
        &ctx.pool,
        &ctx.realtime,
        &ctx.cfg,
        Some(llm),
        new_meeting(p, SourceType::Text, "Not a meeting"),
        &text,
    )
    .await
    .unwrap();
    assert_eq!(created.job.status, JobStatus::NoActions);
    assert_eq!(created.meeting.status, MeetingStatus::Completed);
    let gate = created.job.gate.unwrap();
    assert_eq!(gate.verdict, GateVerdict::No);
    assert_eq!(gate.reason.as_deref(), Some("This is a recipe, not a meeting."));
    assert!(!run_next_job(ctx).await, "a NO_ACTIONS job must not be claimed");

    // Too little text is refused before anything is stored.
    let short = intake::create_text_job(&ctx.pool, &ctx.realtime, &ctx.cfg, Some(llm), new_meeting(p, SourceType::Text, "x"), "hi").await;
    assert!(matches!(short, Err(AppError::BadRequest(_))));
}

async fn recall_bot_to_drafts(ctx: &WorkerContext, p: &Project, phase: &Arc<Mutex<BotPhase>>, state: &Shared) {
    let pool = &ctx.pool;
    *phase.lock().unwrap() = BotPhase::Recording;

    let mut new = new_meeting(p, SourceType::RecallBot, "Live standup");
    new.attendee_ids.clear();
    let created = intake::create_recall_job(pool, &ctx.config, &ctx.realtime, new, "https://meet.google.com/abc-defg-hij", "OpenTask Notetaker")
        .await
        .unwrap();
    assert_eq!(created.job.status, JobStatus::Created);
    let bot_id = created.meeting.recall_bot_id.clone().expect("bot id saved on the meeting");
    let job_id = created.job.id.0;

    // While the bot records, polling changes nothing and the worker has nothing to claim.
    intake::poll_recall_bots(pool, &ctx.config, &ctx.realtime, &ctx.cfg).await;
    assert_eq!(job_status(pool, job_id).await, JobStatus::Created);
    assert!(!run_next_job(ctx).await, "a CREATED job waits for the bot");

    // The bot finishes: the poller notices the audio and queues the job.
    *phase.lock().unwrap() = BotPhase::Done;
    intake::poll_recall_bots(pool, &ctx.config, &ctx.realtime, &ctx.cfg).await;
    assert_eq!(job_status(pool, job_id).await, JobStatus::Queued);
    // A webhook for the same bot afterwards, or for an unknown bot, changes nothing.
    intake::check_recall_bot(pool, &ctx.config, &ctx.realtime, &bot_id, &ctx.cfg).await.unwrap();
    intake::check_recall_bot(pool, &ctx.config, &ctx.realtime, "bot-unknown", &ctx.cfg).await.unwrap();
    assert_eq!(job_status(pool, job_id).await, JobStatus::Queued);

    // Worker: download -> ffmpeg -> Whisper -> speakers -> extraction -> drafts.
    let calls_before = state.lock().unwrap().whisper_calls;
    assert!(run_next_job(ctx).await);
    assert_eq!(state.lock().unwrap().whisper_calls, calls_before + 1, "15 s of audio is one part");
    assert_eq!(state.lock().unwrap().whisper_language.as_deref(), Some("id"));

    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.job.status, JobStatus::DraftsReady, "job ended as {:?}", detail.job.status);
    assert_eq!(detail.job.duration_sec, Some(15));
    let (language, segments) = review::transcript(pool, job_id).await.unwrap();
    assert_eq!(language.as_deref(), Some("indonesian"));
    assert_eq!(segments.len(), 3, "the silence hallucination is dropped");
    let speakers: Vec<_> = segments.iter().map(|s| s.speaker.as_deref()).collect();
    assert_eq!(speakers, [Some("Budi Santoso"), Some("Budi Santoso"), Some("Sari Dewi")]);

    assert_eq!(detail.drafts.len(), 2);
    let report = detail.drafts.iter().find(|d| d.evidence_quote.contains("laporan")).unwrap();
    assert!(report.evidence_verified);
    assert_eq!(report.evidence_start_sec, Some(5));
    assert_eq!(report.resolved_user_id.map(|u| u.0), Some(p.budi));
    let bug = detail.drafts.iter().find(|d| d.evidence_quote.contains("bug login")).unwrap();
    assert_eq!(bug.resolved_user_id.map(|u| u.0), Some(p.sari));

    let attendees: Vec<i64> = sqlx::query_scalar("SELECT attendee_ids FROM opentask.meeting_jobs WHERE id = $1;")
        .bind(job_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(attendees.len(), 2, "speakers matched to members: {attendees:?}");
}

async fn recall_bot_failure_fails_the_job(ctx: &WorkerContext, p: &Project, phase: &Arc<Mutex<BotPhase>>) {
    *phase.lock().unwrap() = BotPhase::Recording;
    let created = intake::create_recall_job(&ctx.pool, &ctx.config, &ctx.realtime, new_meeting(p, SourceType::RecallBot, "No show"), "https://zoom.us/j/1", "OpenTask Notetaker")
        .await
        .unwrap();
    *phase.lock().unwrap() = BotPhase::Fatal;
    intake::poll_recall_bots(&ctx.pool, &ctx.config, &ctx.realtime, &ctx.cfg).await;
    assert_eq!(job_status(&ctx.pool, created.job.id.0).await, JobStatus::Failed);
    let error: Option<String> = sqlx::query_scalar("SELECT last_error FROM opentask.meeting_jobs WHERE id = $1;")
        .bind(created.job.id.0)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert!(error.unwrap_or_default().contains("meeting_not_found"));
    let shown = review::job_detail(&ctx.pool, created.job.id.0).await.unwrap().job.failure_reason;
    assert_eq!(
        shown.as_deref(),
        Some("The meeting bot failed: the link does not lead to a meeting (meeting_not_found).")
    );
}

async fn recall_bot_without_audio_fails_after_grace(ctx: &WorkerContext, p: &Project, phase: &Arc<Mutex<BotPhase>>) {
    let pool = &ctx.pool;
    *phase.lock().unwrap() = BotPhase::Recording;
    let created = intake::create_recall_job(pool, &ctx.config, &ctx.realtime, new_meeting(p, SourceType::RecallBot, "Locked room"), "https://meet.google.com/xyz-abcd-efg", "OpenTask Notetaker")
        .await
        .unwrap();
    let job_id = created.job.id.0;
    let bot_id = created.meeting.recall_bot_id.clone().unwrap();

    // Recall just reported done with no recording: wait in case media shows up late.
    *phase.lock().unwrap() = BotPhase::LeftWithoutAudio { minutes_ago: 0 };
    intake::poll_recall_bots(pool, &ctx.config, &ctx.realtime, &ctx.cfg).await;
    intake::check_recall_bot(pool, &ctx.config, &ctx.realtime, &bot_id, &ctx.cfg).await.unwrap();
    assert_eq!(job_status(pool, job_id).await, JobStatus::Created, "the grace period has not passed");

    // Past the grace period the next poll fails the job, with the reason shown to members.
    *phase.lock().unwrap() = BotPhase::LeftWithoutAudio { minutes_ago: ctx.cfg.recall_no_audio_grace_mins + 1 };
    intake::poll_recall_bots(pool, &ctx.config, &ctx.realtime, &ctx.cfg).await;
    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.job.status, JobStatus::Failed);
    assert_eq!(detail.meeting.status, MeetingStatus::Failed);
    assert_eq!(
        detail.job.failure_reason.as_deref(),
        Some("The bot left without recording: nobody let it in from the waiting room (timeout_exceeded_waiting_room).")
    );
    assert!(!run_next_job(ctx).await, "nothing is left to run");
}

async fn crash_mid_extraction_resumes_from_checkpoint(ctx: &WorkerContext, p: &Project, llm: &LlmClient, state: &Shared) {
    let pool = &ctx.pool;
    let mut small = PipelineConfig::from_env();
    small.groq_base_url = ctx.cfg.groq_base_url.clone();
    small.chunk_tokens = 500;
    small.extract_tpm = 3_000; // budget = max(500, small) => 500 tokens per chunk
    let small_ctx = WorkerContext {
        pool: pool.clone(),
        config: ctx.config.clone(),
        realtime: ctx.realtime.clone(),
        cfg: small,
        llm: Some(llm.clone()),
    };

    let filler = "Pembahasan teknis tentang arsitektur layanan dan rencana migrasi data ke cluster baru.";
    let mut parts: Vec<String> = Vec::new();
    // ~33 tokens per line, 500-token chunks: ~15 lines each, so the marker at line ~20 is in chunk 2.
    for i in 0..40 {
        parts.push(format!("{filler} Bagian {i}."));
        if i == 2 {
            parts.push("Budi akan mengirim proposal desain ke klien.".to_string());
        }
        if i == 18 {
            parts.push("FAIL_CHUNK_TWO_ONCE Sari will deploy the staging cluster tonight.".to_string());
        }
    }
    let created = intake::create_text_job(
        pool,
        &small_ctx.realtime,
        &small_ctx.cfg,
        Some(llm),
        new_meeting(p, SourceType::Text, "Long meeting"),
        &parts.join("\n\n"),
    )
    .await
    .unwrap();
    let job_id = created.job.id.0;
    state.lock().unwrap().calls.clear();

    // First run: chunk 1 succeeds and is checkpointed, chunk 2 hits a 502 and the job is released.
    assert!(run_next_job(&small_ctx).await);
    let after_first: (JobStatus, i32, bool) = sqlx::query_as(
        "SELECT status, attempts, next_attempt_at > NOW() FROM opentask.meeting_jobs WHERE id = $1;",
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(after_first, (JobStatus::Extracting, 1, true));
    let checkpointed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM jsonb_object_keys((SELECT extraction_checkpoint->'results' FROM opentask.meeting_transcripts WHERE job_id = $1));",
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(checkpointed, 1);

    // Retry time comes: the job resumes at chunk 2 without calling chunk 1 again.
    sqlx::query("UPDATE opentask.meeting_jobs SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1;")
        .bind(job_id)
        .execute(pool)
        .await
        .unwrap();
    assert!(run_next_job(&small_ctx).await);
    assert_eq!(job_status(pool, job_id).await, JobStatus::DraftsReady);

    let calls = state.lock().unwrap().calls.clone();
    let chunk_calls: Vec<&str> = calls.iter().filter(|(k, _)| k == "meeting_tasks").map(|(_, c)| c.as_str()).collect();
    let total = chunk_calls[0].split('/').nth(1).unwrap().split(' ').next().unwrap().parse::<usize>().unwrap();
    assert!(total >= 3, "expected several chunks, got {total}");
    assert_eq!(chunk_calls.iter().filter(|c| c.starts_with("chunk: 1/")).count(), 1, "chunk 1 ran twice: {chunk_calls:?}");
    assert_eq!(chunk_calls.iter().filter(|c| c.starts_with("chunk: 2/")).count(), 2);
    assert_eq!(chunk_calls.len(), total + 1);

    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.drafts.len(), 2, "overlapping chunks must not duplicate tasks");
}

/// What the browser's PUT leaves behind: the file at the upload's key.
async fn put_upload(ctx: &WorkerContext, key: &str, bytes: &[u8]) {
    let Some(MediaStore::Local(local)) = ctx.cfg.media_store.as_ref() else { panic!("tests use the local store") };
    let path = local.path_for(key).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

async fn upload_key(pool: &PgPool, job_id: i64) -> Option<String> {
    sqlx::query_scalar("SELECT r2_keys->>0 FROM opentask.meeting_jobs WHERE id = $1;")
        .bind(job_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn media_upload_to_drafts(ctx: &WorkerContext, p: &Project, audio: &[u8]) {
    let pool = &ctx.pool;
    let store = ctx.cfg.media_store.as_ref().unwrap();
    let created = uploads::create_media_job(
        pool,
        &ctx.realtime,
        &ctx.cfg,
        new_meeting(p, SourceType::Media, "Sprint review"), UploadFile { name: "Sprint review.wav", content_type: Some("audio/wav"), size_bytes: audio.len() as u64, duration_sec: Some(15.0) })
    .await
    .unwrap();
    let job_id = created.job.id.0;
    assert_eq!(created.job.status, JobStatus::Created);
    assert_eq!(created.meeting.status, MeetingStatus::Processing);
    assert_eq!(created.upload.method, "PUT");
    assert!(created.upload.url.starts_with("/meeting-uploads?key=ingest%2F"), "{}", created.upload.url);
    assert_eq!(created.upload.headers.get("Content-Type").map(String::as_str), Some("audio/wav"));
    let key = upload_key(pool, job_id).await.unwrap();
    assert_eq!(key, format!("ingest/{}/{job_id}/source.wav", p.id));

    // Completing before the file is there is refused; the browser retries.
    let early = uploads::complete_upload(pool, &ctx.realtime, &ctx.cfg, p.id, job_id).await;
    assert!(matches!(early, Err(AppError::Conflict(_))));
    assert!(!run_next_job(ctx).await, "nothing to claim before the upload completes");

    put_upload(ctx, &key, audio).await;
    let done = uploads::complete_upload(pool, &ctx.realtime, &ctx.cfg, p.id, job_id).await.unwrap();
    assert_eq!(done.job.status, JobStatus::Queued);
    let again = uploads::complete_upload(pool, &ctx.realtime, &ctx.cfg, p.id, job_id).await.unwrap();
    assert_eq!(again.job.status, JobStatus::Queued, "completing twice is harmless");

    // One claim: copy from storage, ffmpeg, Whisper, the gate on the transcript, extraction.
    assert!(run_next_job(ctx).await);
    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.job.status, JobStatus::DraftsReady, "job ended as {:?}", detail.job.status);
    assert_eq!(detail.job.duration_sec, Some(15));
    assert_eq!(detail.job.gate.as_ref().map(|g| g.verdict), Some(GateVerdict::Yes), "uploads are gated, unlike bots");
    assert_eq!(detail.drafts.len(), 2);
    let (_, segments) = review::transcript(pool, job_id).await.unwrap();
    assert_eq!(segments.len(), 3);

    // Transcribed, so the upload is gone and forgotten.
    assert_eq!(store.size(&key).await.unwrap(), None);
    assert_eq!(upload_key(pool, job_id).await, None);
}

async fn media_falls_back_to_cloudflare(ctx: &WorkerContext, p: &Project, state: &Shared, mock_base: &str, audio: &[u8]) {
    let mut cfg = PipelineConfig::from_env();
    cfg.groq_base_url = ctx.cfg.groq_base_url.clone();
    cfg.media_store = ctx.cfg.media_store.clone();
    cfg.cf_account_id = Some("acct-1".to_string());
    cfg.cf_api_token = Some("cf-token".to_string());
    cfg.cf_api_base = mock_base.to_string();
    let cf_ctx = WorkerContext { pool: ctx.pool.clone(), config: ctx.config.clone(), realtime: ctx.realtime.clone(), cfg, llm: ctx.llm.clone() };
    let pool = &cf_ctx.pool;

    let created = uploads::create_media_job(pool, &cf_ctx.realtime, &cf_ctx.cfg, new_meeting(p, SourceType::Media, "Evaluasi"), UploadFile { name: "evaluasi.wav", content_type: Some("audio/wav"), size_bytes: audio.len() as u64, duration_sec: None })
        .await
        .unwrap();
    let job_id = created.job.id.0;
    put_upload(&cf_ctx, &upload_key(pool, job_id).await.unwrap(), audio).await;
    uploads::complete_upload(pool, &cf_ctx.realtime, &cf_ctx.cfg, p.id, job_id).await.unwrap();

    // Groq would make the job wait ten minutes; the part goes to Cloudflare instead.
    state.lock().unwrap().whisper_rate_limited = true;
    let cf_before = state.lock().unwrap().cf_calls;
    assert!(run_next_job(&cf_ctx).await);
    state.lock().unwrap().whisper_rate_limited = false;
    assert_eq!(state.lock().unwrap().cf_calls, cf_before + 1);

    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.job.status, JobStatus::DraftsReady, "job ended as {:?}", detail.job.status);
    let (language, segments) = review::transcript(pool, job_id).await.unwrap();
    assert_eq!(language.as_deref(), Some("id"));
    assert_eq!(segments.len(), 2);
    assert_eq!(detail.drafts.len(), 1);
}

async fn abandoned_upload_fails_and_is_removed(ctx: &WorkerContext, p: &Project) {
    let pool = &ctx.pool;
    let store = ctx.cfg.media_store.as_ref().unwrap();
    let created = uploads::create_media_job(pool, &ctx.realtime, &ctx.cfg, new_meeting(p, SourceType::Media, "Never finished"), UploadFile { name: "call.mp4", content_type: Some("video/mp4"), size_bytes: 4096, duration_sec: None })
        .await
        .unwrap();
    let job_id = created.job.id.0;
    let key = upload_key(pool, job_id).await.unwrap();
    put_upload(ctx, &key, &[0u8; 4096]).await;

    // Recent: the sweep leaves it alone.
    uploads::sweep(pool, &ctx.realtime, &ctx.cfg).await;
    assert_eq!(job_status(pool, job_id).await, JobStatus::Created);

    sqlx::query("UPDATE opentask.meetings SET created_at = NOW() - INTERVAL '7 hours' WHERE id = $1;")
        .bind(created.meeting.id.0)
        .execute(pool)
        .await
        .unwrap();
    uploads::sweep(pool, &ctx.realtime, &ctx.cfg).await;
    let detail = review::job_detail(pool, job_id).await.unwrap();
    assert_eq!(detail.job.status, JobStatus::Failed);
    assert_eq!(detail.job.failure_reason.as_deref(), Some("The upload did not finish within 6 hours."));
    assert_eq!(store.size(&key).await.unwrap(), None, "the partial upload is removed");
    assert_eq!(upload_key(pool, job_id).await, None);

    // Too big or empty never gets an upload URL.
    let too_big = (ctx.cfg.max_upload_mb + 1) * 1024 * 1024;
    let huge = uploads::create_media_job(pool, &ctx.realtime, &ctx.cfg, new_meeting(p, SourceType::Media, "x"), UploadFile { name: "x.mp4", content_type: None, size_bytes: too_big, duration_sec: None }).await;
    assert!(matches!(huge, Err(AppError::BadRequest(_))));
    let empty = uploads::create_media_job(pool, &ctx.realtime, &ctx.cfg, new_meeting(p, SourceType::Media, "x"), UploadFile { name: "x.mp4", content_type: None, size_bytes: 0, duration_sec: None }).await;
    assert!(matches!(empty, Err(AppError::BadRequest(_))));
}

async fn add_usage_today(pool: &PgPool, project_id: i64, model: &str, tokens: i64, audio_seconds: i32) {
    sqlx::query(
        r#"
        INSERT INTO opentask.ai_usage_daily (day, project_id, model, requests, tokens, audio_seconds)
        VALUES ((NOW() AT TIME ZONE 'UTC')::date, $1, $2, 1, $3, $4)
        ON CONFLICT (day, project_id, model, own_key) DO UPDATE
        SET tokens = ai_usage_daily.tokens + EXCLUDED.tokens, audio_seconds = ai_usage_daily.audio_seconds + EXCLUDED.audio_seconds;
        "#,
    )
    .bind(project_id)
    .bind(model)
    .bind(tokens)
    .bind(audio_seconds)
    .execute(pool)
    .await
    .unwrap();
}

async fn project_quotas_refuse_new_jobs(ctx: &WorkerContext, llm: &LlmClient) {
    let pool = &ctx.pool;
    let p = seed(pool).await;
    let mut cfg = PipelineConfig::from_env();
    cfg.groq_base_url = ctx.cfg.groq_base_url.clone();
    cfg.media_store = ctx.cfg.media_store.clone();
    cfg.project_jobs_per_day = 2;
    cfg.project_audio_minutes_per_day = 10;

    for title in ["Senin", "Selasa"] {
        intake::create_text_job(pool, &ctx.realtime, &cfg, Some(llm), new_meeting(&p, SourceType::Text, title), &notes(""))
            .await
            .unwrap();
    }
    let third = intake::create_text_job(pool, &ctx.realtime, &cfg, Some(llm), new_meeting(&p, SourceType::Text, "Rabu"), &notes("")).await;
    let Err(AppError::Conflict(message)) = third else { panic!("the third job of the day is refused") };
    assert!(message.contains("2 meeting jobs"), "{message}");

    // Minutes: 8 of 10 used, so a 3-minute recording is refused before anything is uploaded.
    cfg.project_jobs_per_day = 0;
    add_usage_today(pool, p.id, cfg.asr_model, 0, 8 * 60).await;
    let long = uploads::create_media_job(pool, &ctx.realtime, &cfg, new_meeting(&p, SourceType::Media, "Panjang"), UploadFile { name: "a.ogg", content_type: Some("audio/ogg"), size_bytes: 1000, duration_sec: Some(180.0) }).await;
    let Err(AppError::Conflict(message)) = long else { panic!("over the minutes quota") };
    assert!(message.contains("2 of its 10 transcription minutes"), "{message}");
    let short = uploads::create_media_job(pool, &ctx.realtime, &cfg, new_meeting(&p, SourceType::Media, "Pendek"), UploadFile { name: "b.ogg", content_type: Some("audio/ogg"), size_bytes: 1000, duration_sec: Some(60.0) }).await;
    assert!(short.is_ok(), "a minute fits");
}

async fn transcription_waits_for_tomorrow_when_minutes_run_out(ctx: &WorkerContext, audio: &[u8]) {
    let pool = &ctx.pool;
    let p = seed(pool).await;
    let mut cfg = PipelineConfig::from_env();
    cfg.groq_base_url = ctx.cfg.groq_base_url.clone();
    cfg.media_store = ctx.cfg.media_store.clone();
    cfg.cf_account_id = None;
    cfg.project_audio_minutes_per_day = 1;
    let quota_ctx = WorkerContext { pool: pool.clone(), config: ctx.config.clone(), realtime: ctx.realtime.clone(), cfg, llm: ctx.llm.clone() };

    // The browser did not know the length, so intake lets it through; transcription then waits.
    let created = uploads::create_media_job(pool, &quota_ctx.realtime, &quota_ctx.cfg, new_meeting(&p, SourceType::Media, "Kuota"), UploadFile { name: "kuota.wav", content_type: Some("audio/wav"), size_bytes: audio.len() as u64, duration_sec: None })
        .await
        .unwrap();
    let job_id = created.job.id.0;
    put_upload(&quota_ctx, &upload_key(pool, job_id).await.unwrap(), audio).await;
    uploads::complete_upload(pool, &quota_ctx.realtime, &quota_ctx.cfg, p.id, job_id).await.unwrap();
    add_usage_today(pool, p.id, quota_ctx.cfg.asr_model, 0, 50).await;

    assert!(run_next_job(&quota_ctx).await);
    let (status, next_attempt, reason, attempts): (JobStatus, Option<chrono::DateTime<Utc>>, Option<String>, i32) =
        sqlx::query_as("SELECT status, next_attempt_at, last_error, attempts FROM opentask.meeting_jobs WHERE id = $1;")
            .bind(job_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(status, JobStatus::Transcribing, "deferred, not failed");
    assert!(next_attempt.unwrap() > Utc::now() + chrono::Duration::minutes(1));
    assert_eq!(next_attempt.unwrap().time(), chrono::NaiveTime::MIN, "waits for the next UTC day");
    assert!(reason.unwrap().contains("transcription minutes for today are used up"));
    assert_eq!(attempts, 0, "a quota wait is not a failed attempt");
    assert!(!run_next_job(&quota_ctx).await, "nothing to claim until tomorrow");

    // The project's members see why it waits; an owner can push it on (it waits again here).
    let member_view = health::project_health(pool, &quota_ctx.cfg, p.id, false).await.unwrap();
    let waiting = member_view.jobs.iter().find(|j| j.job.id.0 == job_id).unwrap();
    assert!(waiting.problem.as_deref().unwrap().contains("used up"));
    assert!(!waiting.can_retry);
    assert_eq!(member_view.quota.audio_minutes_per_day, 1);
    let owner_view = health::project_health(pool, &quota_ctx.cfg, p.id, true).await.unwrap();
    assert!(owner_view.jobs.iter().find(|j| j.job.id.0 == job_id).unwrap().can_retry);
    let retried = health::retry(pool, job_id).await.unwrap();
    assert_eq!(retried.next_attempt_at, None);
    sqlx::query("DELETE FROM opentask.meetings WHERE id = $1;").bind(created.meeting.id.0).execute(pool).await.unwrap();
}

async fn health_retention_and_retry(ctx: &WorkerContext, p: &Project, llm: &LlmClient) {
    let pool = &ctx.pool;
    sqlx::query("UPDATE opentask.project_member SET role = 'Owner' WHERE project_id = $1 AND user_id = $2;")
        .bind(p.id)
        .bind(p.owner)
        .execute(pool)
        .await
        .unwrap();
    assert!(health::is_manager(pool, p.id, p.owner).await.unwrap());
    assert!(!health::is_manager(pool, p.id, p.budi).await.unwrap());

    // A job that failed in the worker: owners see the internal error and can retry it.
    let created = intake::create_text_job(pool, &ctx.realtime, &ctx.cfg, Some(llm), new_meeting(p, SourceType::Text, "Gagal"), &notes(""))
        .await
        .unwrap();
    let job_id = created.job.id.0;
    sqlx::query("UPDATE opentask.meeting_jobs SET status = 'FAILED', attempts = 8, last_error = 'Groq rejected the request: 400 provider detail' WHERE id = $1;")
        .bind(job_id)
        .execute(pool)
        .await
        .unwrap();
    let member = health::project_health(pool, &ctx.cfg, p.id, false).await.unwrap();
    let failed = member.jobs.iter().find(|j| j.job.id.0 == job_id).unwrap();
    assert_eq!(failed.problem, None, "worker errors stay internal for members");
    assert!(!member.can_manage);
    let owner = health::project_health(pool, &ctx.cfg, p.id, true).await.unwrap();
    let failed = owner.jobs.iter().find(|j| j.job.id.0 == job_id).unwrap();
    assert!(failed.problem.as_deref().unwrap().contains("provider detail"));
    assert!(failed.can_retry);
    assert!(owner.models.iter().any(|m| m.model == ctx.cfg.extract_model && m.limits.tpd > 0 || ctx.cfg.groq_tier != opentask_api::services::meeting_pipeline::config::GroqTier::Free));

    let retried = health::retry(pool, job_id).await.unwrap();
    assert_eq!((retried.status, retried.attempts), (JobStatus::Queued, 0));
    assert!(matches!(health::retry(pool, job_id).await, Err(AppError::Conflict(_))), "a queued job has nothing to retry");
    // Older queued jobs from other scenarios may run first.
    for _ in 0..10 {
        if job_status(pool, job_id).await != JobStatus::Queued || !run_next_job(ctx).await {
            break;
        }
    }
    assert_eq!(job_status(pool, job_id).await, JobStatus::DraftsReady, "the retried job ran again");

    // Retention: checkpoints go once a job is done; old transcripts of finished jobs go too.
    let checkpoints: (bool,) = sqlx::query_as(
        "SELECT asr_checkpoint IS NULL AND extraction_checkpoint IS NULL FROM opentask.meeting_transcripts WHERE job_id = $1;",
    )
    .bind(job_id)
    .fetch_one(pool)
    .await
    .unwrap();
    if !checkpoints.0 {
        assert!(retention::clear_checkpoints(pool).await.unwrap() >= 1);
    }
    let cleared: bool = sqlx::query_scalar("SELECT extraction_checkpoint IS NULL FROM opentask.meeting_transcripts WHERE job_id = $1;")
        .bind(job_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(cleared);

    sqlx::query("UPDATE opentask.meeting_jobs SET status = 'REVIEWED' WHERE id = $1;").bind(job_id).execute(pool).await.unwrap();
    sqlx::query("UPDATE opentask.meeting_transcripts SET created_at = NOW() - INTERVAL '120 days' WHERE job_id = $1;")
        .bind(job_id)
        .execute(pool)
        .await
        .unwrap();
    assert!(retention::delete_old_transcripts(pool, 90).await.unwrap() >= 1);
    assert!(review::transcript(pool, job_id).await.is_err(), "the transcript is gone");
    assert_eq!(review::job_detail(pool, job_id).await.unwrap().drafts.len(), 2, "tasks and their evidence stay");
}

async fn project_key_is_used_and_lifts_quotas(ctx: &WorkerContext, state: &Shared) {
    let pool = &ctx.pool;
    let p = seed(pool).await;
    let mut cfg = PipelineConfig::from_env();
    cfg.groq_base_url = ctx.cfg.groq_base_url.clone();
    cfg.project_jobs_per_day = 1;
    let project_key = "gsk_project_key_for_tests_0123abcd";

    let rejected = keys::save(pool, &ctx.config, &cfg, p.id, p.owner, "gsk_rejected_key_for_tests_0000", GroqTier::Free).await;
    assert!(matches!(rejected, Err(AppError::BadRequest(_))), "a key Groq refuses is not stored");
    assert!(!keys::info(pool, p.id, true).await.unwrap().configured);

    let saved = keys::save(pool, &ctx.config, &cfg, p.id, p.owner, project_key, GroqTier::Free).await.unwrap();
    assert!(saved.configured);
    assert_eq!((saved.hint.as_deref(), saved.tier.as_deref()), (Some("abcd"), Some("free")));
    let stored: Vec<u8> = sqlx::query_scalar("SELECT key_cipher FROM opentask.project_ai_keys WHERE project_id = $1;")
        .bind(p.id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&stored).contains("project_key"), "stored encrypted");

    // Gate (inline) and extraction (worker) both use the project's key, and the quota does not apply.
    let calls_before = state.lock().unwrap().chat_keys.len();
    let mut job_ids = Vec::new();
    for title in ["Satu", "Dua"] {
        let llm = keys::llm_for_project(pool, &ctx.config, &cfg, ctx.llm.as_ref(), p.id).await.unwrap().unwrap();
        assert!(llm.has_own_key());
        let created = intake::create_text_job(pool, &ctx.realtime, &cfg, Some(&llm), new_meeting(&p, SourceType::Text, title), &notes(""))
            .await
            .expect("a project with its own key is not held to the daily quota");
        job_ids.push(created.job.id.0);
    }
    for _ in 0..12 {
        let mut pending = false;
        for id in &job_ids {
            pending |= job_status(pool, *id).await == JobStatus::Queued;
        }
        if !pending || !run_next_job(ctx).await {
            break;
        }
    }
    for id in &job_ids {
        assert_eq!(job_status(pool, *id).await, JobStatus::DraftsReady);
    }
    let health = health::project_health(pool, &cfg, p.id, true).await.unwrap();
    assert!(health.quota.exempt && health.key.configured);
    let ours: Vec<String> = state.lock().unwrap().chat_keys[calls_before..].to_vec();
    assert!(ours.iter().filter(|k| *k == project_key).count() >= 4, "gate and extraction of both jobs: {ours:?}");

    // Without it the shared key is used again.
    assert!(keys::remove(pool, p.id).await.unwrap());
    assert!(keys::resolve_groq_key(pool, &ctx.config, p.id).await.unwrap().is_none());
    let shared = keys::llm_for_project(pool, &ctx.config, &cfg, ctx.llm.as_ref(), p.id).await.unwrap().unwrap();
    assert!(!shared.has_own_key());
    let third = intake::create_text_job(pool, &ctx.realtime, &cfg, Some(&shared), new_meeting(&p, SourceType::Text, "Tiga"), &notes("")).await;
    assert!(matches!(third, Err(AppError::Conflict(_))), "the quota applies again");
}
