//! Quality check of the gate and task extraction on labelled cases (tests/eval/meeting_cases.json)
//! with the real Groq API, about 20 free-tier requests:
//!
//!   cargo test --test meeting_eval -- --ignored --nocapture
//!
//! EVAL_CASE=<name> runs one case; EVAL_MIN_RECALL and EVAL_MIN_PRECISION change the bar.

use chrono::{Datelike, NaiveDate};
use serde::Deserialize;

use opentask_api::config::Config;
use opentask_api::models::meeting::GateVerdict;
use opentask_api::services::meeting_pipeline::config::PipelineConfig;
use opentask_api::services::meeting_pipeline::extract::{self, ChunkOutcome};
use opentask_api::services::meeting_pipeline::gate::run_gate;
use opentask_api::services::meeting_pipeline::llm::LlmClient;
use opentask_api::services::meeting_pipeline::postprocess::{self, DraftCandidate, MemberName, PostProcessInput};
use opentask_api::services::meeting_pipeline::prompts::ExtractContext;
use opentask_api::services::meeting_pipeline::steps::DEFAULT_TASK_TYPES;
use opentask_api::services::meeting_pipeline::transcript::{format_segment, segments_from_text};

#[derive(Deserialize)]
struct Case {
    name: String,
    meeting_date: String,
    attendees: Vec<String>,
    /// "yes", "no", or null when either is acceptable.
    gate: Option<String>,
    text: String,
    tasks: Vec<Expected>,
    #[serde(default)]
    allowed_extra: Vec<Vec<String>>,
    #[serde(default)]
    not_tasks: Vec<Vec<String>>,
}

#[derive(Deserialize)]
struct Expected {
    keywords: Vec<String>,
    assignee: Option<String>,
    due: Option<String>,
}

#[derive(Default)]
struct Score {
    gate_scored: u32,
    gate_correct: u32,
    expected: u32,
    matched: u32,
    extra: u32,
    forbidden: u32,
    assignee_checked: u32,
    assignee_correct: u32,
    due_checked: u32,
    due_correct: u32,
}

fn text_of(c: &DraftCandidate) -> String {
    format!("{} {} {}", c.title, c.evidence_quote, c.description.clone().unwrap_or_default()).to_lowercase()
}

fn has_all(text: &str, keywords: &[String]) -> bool {
    keywords.iter().all(|k| text.contains(&k.to_lowercase()))
}

async fn extract_case(llm: &LlmClient, cfg: &PipelineConfig, case: &Case, doc_type: &str) -> Result<Vec<DraftCandidate>, String> {
    let segments = segments_from_text(&case.text);
    let lines: Vec<String> = segments.iter().map(format_segment).collect();
    let planned = extract::plan_chunks(&lines, extract::chunk_budget(cfg), cfg.overlap_tokens);
    let date = NaiveDate::parse_from_str(&case.meeting_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let date_text = date.to_string();
    let weekday = date.weekday().to_string();
    let types: Vec<String> = DEFAULT_TASK_TYPES.iter().map(|t| t.to_string()).collect();
    let ctx = ExtractContext {
        meeting_date: &date_text,
        weekday: &weekday,
        timezone: "Asia/Jakarta",
        attendees: &case.attendees,
        doc_type,
        allowed_types: &types,
    };

    let mut tasks = Vec::new();
    for (index, (start, end)) in planned.iter().copied().enumerate() {
        let record = lines[start..end].join("\n");
        match extract::extract_chunk(llm, cfg, &ctx, index, planned.len(), &record).await {
            Ok(ChunkOutcome::Done(found)) => tasks.extend(found),
            Ok(ChunkOutcome::Defer { until, reason }) => return Err(format!("{reason} until {until}")),
            Err((error, _)) => return Err(format!("{error:?}")),
        }
    }
    let members: Vec<MemberName> = case
        .attendees
        .iter()
        .enumerate()
        .map(|(i, name)| MemberName { user_id: i as i64 + 1, display_name: Some(name.clone()), gh_username: None })
        .collect();
    Ok(postprocess::post_process(PostProcessInput {
        tasks,
        segments: &segments,
        meeting_date: date,
        allowed_types: &types,
        members: &members,
        max_tasks: cfg.max_tasks_per_job,
    }))
}

fn score_case(case: &Case, found: &[DraftCandidate], score: &mut Score) -> Vec<String> {
    let mut notes = Vec::new();
    let mut used = vec![false; found.len()];
    for expected in &case.tasks {
        score.expected += 1;
        let hit = found.iter().enumerate().find(|(i, c)| !used[*i] && has_all(&text_of(c), &expected.keywords));
        let Some((i, candidate)) = hit else {
            notes.push(format!("missed: {}", expected.keywords.join(" + ")));
            continue;
        };
        used[i] = true;
        score.matched += 1;
        if let Some(name) = &expected.assignee {
            score.assignee_checked += 1;
            let resolved = candidate
                .resolved_user_id
                .and_then(|id| case.attendees.get(id as usize - 1))
                .is_some_and(|member| member.to_lowercase().contains(&name.to_lowercase()));
            if resolved {
                score.assignee_correct += 1;
            } else {
                notes.push(format!("{}: assignee {:?}, expected {name}", candidate.title, candidate.assignee_hint));
            }
        }
        if let Some(due) = &expected.due {
            score.due_checked += 1;
            if candidate.due_date.map(|d| d.to_string()).as_deref() == Some(due.as_str()) {
                score.due_correct += 1;
            } else {
                notes.push(format!("{}: due {:?}, expected {due}", candidate.title, candidate.due_date));
            }
        }
    }
    for (i, candidate) in found.iter().enumerate() {
        let text = text_of(candidate);
        if case.not_tasks.iter().any(|k| has_all(&text, k)) {
            score.forbidden += 1;
            notes.push(format!("should not be a task: {}", candidate.title));
        } else if !used[i] && !case.allowed_extra.iter().any(|k| has_all(&text, k)) {
            score.extra += 1;
            notes.push(format!("extra: {}", candidate.title));
        }
    }
    notes
}

fn ratio(a: u32, b: u32) -> f32 {
    if b == 0 { 1.0 } else { a as f32 / b as f32 }
}

fn env_ratio(name: &str, default: f32) -> f32 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[tokio::test]
#[ignore = "calls the real Groq API; run with --ignored"]
async fn gate_and_extraction_quality() {
    let config = Config::load();
    let key = config.groq_api_key.clone().expect("set GROQ_API_KEY in the environment or .env");
    let cfg = PipelineConfig::from_env();
    let llm = LlmClient::new(&cfg.groq_base_url, &key);
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("eval/meeting_cases.json")).expect("tests/eval/meeting_cases.json");
    let only = std::env::var("EVAL_CASE").ok();

    let mut score = Score::default();
    println!("| case | gate | expected | found | matched | notes |\n|---|---|---|---|---|---|");
    for case in cases.iter().filter(|c| only.as_deref().is_none_or(|n| n == c.name)) {
        let models = [cfg.gate_model, cfg.gate_fallback_model];
        let gate = run_gate(Some(&llm), &models, &case.text, cfg.gate_head_chars, cfg.gate_tail_chars).await;
        let said_no = gate.verdict == GateVerdict::No;
        if let Some(expected) = &case.gate {
            score.gate_scored += 1;
            if (expected == "no") == said_no {
                score.gate_correct += 1;
            }
        }
        let gate_text = format!("{:?}{}", gate.verdict, if gate.failed_open { " (failed open)" } else { "" });

        // Extraction is scored on every case that should reach it, whatever the gate said.
        if case.gate.as_deref() == Some("no") {
            println!("| {} | {gate_text} | - | - | - | {} |", case.name, gate.reason.unwrap_or_default());
            continue;
        }
        let doc_type = gate.doc_type.clone().unwrap_or_else(|| "other".to_string());
        let found = match extract_case(&llm, &cfg, case, &doc_type).await {
            Ok(found) => found,
            Err(e) => panic!("{}: extraction failed: {e}", case.name),
        };
        let before = score.matched;
        let notes = score_case(case, &found, &mut score);
        println!(
            "| {} | {gate_text} | {} | {} | {} | {} |",
            case.name,
            case.tasks.len(),
            found.len(),
            score.matched - before,
            notes.join("; ")
        );
    }

    let recall = ratio(score.matched, score.expected);
    let precision = ratio(score.matched, score.matched + score.extra + score.forbidden);
    println!(
        "\ngate {}/{} correct · recall {:.0}% ({}/{}) · precision {:.0}% · assignee {}/{} · due {}/{} · must-not-be-tasks {}",
        score.gate_correct,
        score.gate_scored,
        recall * 100.0,
        score.matched,
        score.expected,
        precision * 100.0,
        score.assignee_correct,
        score.assignee_checked,
        score.due_correct,
        score.due_checked,
        score.forbidden
    );
    assert_eq!(score.gate_correct, score.gate_scored, "the gate got a case wrong");
    assert!(recall >= env_ratio("EVAL_MIN_RECALL", 0.8), "recall below the bar");
    assert!(precision >= env_ratio("EVAL_MIN_PRECISION", 0.7), "precision below the bar");
    assert_eq!(score.forbidden, 0, "something that must not be a task became one");
}
