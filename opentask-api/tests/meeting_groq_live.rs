//! Checks that the real Groq API accepts the pipeline's requests (models, JSON modes, reasoning
//! settings). Uses a few free-tier requests, so it only runs on demand:
//!
//!   cargo test --test meeting_groq_live -- --ignored --nocapture
//!
//! Reads GROQ_API_KEY from the environment or .env. Touches no database.

use opentask_api::config::Config;
use opentask_api::models::meeting::GateVerdict;
use opentask_api::services::meeting_pipeline::config::PipelineConfig;
use opentask_api::services::meeting_pipeline::extract::{self, ChunkOutcome};
use opentask_api::services::meeting_pipeline::gate::run_gate;
use opentask_api::services::meeting_pipeline::llm::LlmClient;
use opentask_api::services::meeting_pipeline::prompts::ExtractContext;

const NOTES: &str = "Rapat mingguan tim produk, Senin 19 Oktober 2026. Hadir: Budi Santoso, Sari Dewi.\n\
[00:01:05] Budi Santoso: Saya akan menyiapkan laporan keuangan sebelum Jumat, ini urgent untuk klien.\n\
[00:02:10] Sari Dewi: I'll update the onboarding docs for the new release next week.\n\
[00:03:00] Budi Santoso: Oke, kita putuskan rilis tetap hari Jumat.";

#[tokio::test]
#[ignore = "calls the real Groq API; run with --ignored"]
async fn groq_accepts_the_pipeline_requests() {
    let config = Config::load();
    let key = config.groq_api_key.clone().expect("set GROQ_API_KEY in the environment or .env");
    let cfg = PipelineConfig::from_env();
    let llm = LlmClient::new(&cfg.groq_base_url, &key);

    for model in [cfg.gate_model, cfg.gate_fallback_model] {
        let gate = run_gate(Some(&llm), &[model], NOTES, cfg.gate_head_chars, cfg.gate_tail_chars).await;
        println!("gate {model}: {:?} ({:?}) {:?}", gate.verdict, gate.doc_type, gate.reason);
        assert!(!gate.failed_open, "{model} call failed (see the warning above)");
        assert_ne!(gate.verdict, GateVerdict::No, "{model} rejected obvious meeting notes");
    }

    let attendees = vec!["Budi Santoso".to_string(), "Sari Dewi".to_string()];
    let types: Vec<String> = ["CODE", "REQUIREMENT", "DESIGN", "NON-CODE", "OTHER"].iter().map(|t| t.to_string()).collect();
    let ctx = ExtractContext {
        meeting_date: "2026-10-19",
        weekday: "Mon",
        timezone: "Asia/Jakarta",
        attendees: &attendees,
        doc_type: "meeting_transcript",
        allowed_types: &types,
    };
    let tasks = match extract::extract_chunk(&llm, &cfg, &ctx, 0, 1, NOTES).await {
        Ok(ChunkOutcome::Done(tasks)) => tasks,
        Ok(ChunkOutcome::Defer { reason, .. }) => panic!("rate limited: {reason}"),
        Err((error, raw)) => panic!("{} extraction failed: {error:?}\nraw: {raw:?}", cfg.extract_model),
    };
    for task in &tasks {
        println!(
            "task: {} | hint={:?} due={:?}/{:?} priority={:?} confidence={:?}\n  evidence: {}",
            task.title, task.assignee_hint, task.due_text, task.due_date, task.priority, task.confidence, task.evidence_quote
        );
    }
    assert!(tasks.len() >= 2, "expected the two commitments, got {}", tasks.len());

    let titles: Vec<String> = tasks.iter().map(|t| t.title.clone()).collect();
    let summary = extract::summarize(&llm, &cfg, "2026-10-19", &titles, NOTES)
        .await
        .unwrap_or_else(|| panic!("{} summary failed (see the warning above)", cfg.summary_model));
    println!("summary: {}\ndecisions: {:?}", summary.mom_summary, summary.key_decisions);
    assert!(!summary.mom_summary.is_empty());
}

/// Real ffmpeg + real Whisper on an audio file: `LIVE_AUDIO_FILE=path` (any format ffmpeg reads),
/// optional `LIVE_AUDIO_LANGUAGE=en|id|auto` (defaults to MEETING_ASR_LANGUAGE / id).
#[tokio::test]
#[ignore = "calls the real Groq API and needs ffmpeg; run with --ignored"]
async fn whisper_transcribes_a_recording() {
    use opentask_api::services::meeting_pipeline::media::{self, TempDir};
    use opentask_api::services::meeting_pipeline::transcript::{format_segment, segments_from_asr};

    let Ok(audio) = std::env::var("LIVE_AUDIO_FILE") else {
        eprintln!("skipped: set LIVE_AUDIO_FILE to an audio file");
        return;
    };
    let config = Config::load();
    let key = config.groq_api_key.clone().expect("set GROQ_API_KEY in the environment or .env");
    let cfg = PipelineConfig::from_env();
    let language = match std::env::var("LIVE_AUDIO_LANGUAGE").ok().as_deref() {
        Some("auto") => None,
        Some(lang) => Some(lang.to_string()),
        None => cfg.asr_language.clone(),
    };
    let llm = LlmClient::new(&cfg.groq_base_url, &key);

    let input = std::path::PathBuf::from(audio);
    let duration = media::probe_audio_duration(&cfg.ffprobe_path, &input).await.expect("ffprobe");
    let dir = TempDir::create("opentask-live").unwrap();
    let parts = media::split_for_asr(&cfg.ffmpeg_path, &input, dir.path(), cfg.asr_part_secs, cfg.asr_bitrate)
        .await
        .expect("ffmpeg split");
    println!("{duration:.1}s of audio -> {} part(s), {} bytes", parts.len(), std::fs::metadata(&parts[0]).unwrap().len());

    let mut replies = Vec::new();
    let mut offset = 0.0f32;
    for part in &parts {
        let part_duration = media::probe_audio_duration(&cfg.ffprobe_path, part).await.unwrap();
        let reply = llm
            .transcribe(cfg.asr_model, part, language.as_deref(), Some("Project meeting: OpenTask."))
            .await
            .unwrap_or_else(|e| panic!("Whisper failed: {e:?}"));
        replies.push((offset, reply));
        offset += part_duration;
    }
    let joined: Vec<(f32, &_)> = replies.iter().map(|(o, r)| (*o, r)).collect();
    let segments = segments_from_asr(&joined);
    println!("language: {:?}", replies[0].1.language);
    for segment in &segments {
        println!("{}", format_segment(segment));
    }
    assert!(!segments.is_empty(), "no speech transcribed");
}
