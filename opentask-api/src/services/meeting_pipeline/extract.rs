use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::config::{GroqTier, PipelineConfig};
use super::llm::{ChatRequest, LlmClient, LlmError, ResponseFormat};
use super::postprocess::{ExtractedTask, ExtractionOutput};
use super::prompts::{self, ExtractContext};
use super::StepError;

const PROMPT_OVERHEAD_TOKENS: u32 = 1_000;
const MAX_INLINE_WAIT: Duration = Duration::from_secs(60);
const MAX_INLINE_WAITS: u32 = 3;

pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count() as u32).div_ceil(3)
}

pub fn chunk_budget(cfg: &PipelineConfig) -> u32 {
    let (tpm, cap) = match cfg.groq_tier {
        GroqTier::Free => (cfg.extract_tpm, cfg.chunk_tokens),
        GroqTier::Developer => (cfg.extract_dev_tpm, 30_000),
    };
    let usable = (tpm as f32 * (1.0 - cfg.tpm_safety_margin)) as u32;
    usable
        .saturating_sub(cfg.max_output_tokens + PROMPT_OVERHEAD_TOKENS)
        .min(cap)
        .max(500)
}

pub fn plan_chunks(lines: &[String], budget: u32, overlap: u32) -> Vec<(usize, usize)> {
    let costs: Vec<u32> = lines.iter().map(|l| estimate_tokens(l) + 1).collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < costs.len() {
        let mut end = start;
        let mut total = 0;
        while end < costs.len() && (end == start || total + costs[end] <= budget) {
            total += costs[end];
            end += 1;
        }
        chunks.push((start, end));
        if end == costs.len() {
            break;
        }
        let mut next = end;
        let mut tail = 0;
        while next > start + 1 && tail + costs[next - 1] <= overlap {
            tail += costs[next - 1];
            next -= 1;
        }
        start = next;
    }
    chunks
}

/// Stored in `meeting_transcripts.extraction_checkpoint`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Checkpoint {
    pub chunks: Vec<(usize, usize)>,
    pub results: BTreeMap<usize, Vec<ExtractedTask>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_raw: Option<String>,
}

pub enum ChunkOutcome {
    Done(Vec<ExtractedTask>),
    Defer { until: DateTime<Utc>, reason: String },
}

pub async fn extract_chunk(
    llm: &LlmClient,
    cfg: &PipelineConfig,
    ctx: &ExtractContext<'_>,
    chunk_index: usize,
    chunk_count: usize,
    record: &str,
) -> Result<ChunkOutcome, (StepError, Option<String>)> {
    let system = prompts::extract_system(cfg.max_tasks_per_job);
    let user = prompts::extract_user(ctx, chunk_index, chunk_count, record);
    let schema = prompts::extraction_schema();
    let mut repair: Option<(String, String)> = None;
    let mut waits = 0;

    loop {
        let mut messages = vec![("system", system.as_str()), ("user", user.as_str())];
        if let Some((raw, fix)) = &repair {
            messages.push(("assistant", raw.as_str()));
            messages.push(("user", fix.as_str()));
        }
        let request = ChatRequest {
            model: cfg.extract_model,
            messages,
            max_completion_tokens: cfg.max_output_tokens,
            format: ResponseFormat::JsonSchema { name: "meeting_tasks", schema: &schema },
            reasoning_effort: Some("low"),
        };

        match llm.chat(&request).await {
            Ok(response) => match serde_json::from_str::<ExtractionOutput>(&response.content) {
                Ok(output) => return Ok(ChunkOutcome::Done(output.tasks)),
                Err(e) if repair.is_none() => {
                    let fix = format!("That reply was not valid ({e}). Return the corrected JSON only.");
                    repair = Some((response.content, fix));
                }
                Err(e) => {
                    let message = format!("extraction output was still invalid after a repair: {e}");
                    return Err((StepError::Fatal(message), Some(response.content)));
                }
            },
            Err(LlmError::RateLimited { retry_after }) => {
                let wait = retry_after.unwrap_or(Duration::from_secs(30));
                if wait <= MAX_INLINE_WAIT && waits < MAX_INLINE_WAITS {
                    waits += 1;
                    tokio::time::sleep(wait).await;
                    continue;
                }
                let until = Utc::now() + chrono::Duration::from_std(wait).unwrap_or(chrono::Duration::minutes(1));
                return Ok(ChunkOutcome::Defer { until, reason: "Groq rate limit".to_string() });
            }
            Err(LlmError::Transient(m)) => return Err((StepError::Retryable(m), None)),
            Err(LlmError::Fatal(m)) => return Err((StepError::Fatal(format!("Groq rejected the request: {m}")), None)),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct MomSummary {
    pub mom_summary: String,
    #[serde(default)]
    pub key_decisions: Vec<String>,
}

/// Minutes and decisions for the meeting row. Any failure returns `None`
pub async fn summarize(
    llm: &LlmClient,
    cfg: &PipelineConfig,
    meeting_date: &str,
    task_titles: &[String],
    sample: &str,
) -> Option<MomSummary> {
    let user = prompts::summary_user(meeting_date, task_titles, sample);
    let schema = prompts::summary_schema();
    let request = ChatRequest {
        model: cfg.summary_model,
        messages: vec![("system", prompts::SUMMARY_SYSTEM), ("user", &user)],
        max_completion_tokens: 800,
        format: ResponseFormat::JsonSchema { name: "meeting_summary", schema: &schema },
        reasoning_effort: Some("low"),
    };
    match llm.chat(&request).await {
        Ok(response) => match serde_json::from_str::<MomSummary>(&response.content) {
            Ok(mut summary) => {
                summary.mom_summary = summary.mom_summary.chars().take(600).collect();
                summary.key_decisions.truncate(10);
                for decision in &mut summary.key_decisions {
                    *decision = decision.chars().take(160).collect();
                }
                Some(summary)
            }
            Err(e) => {
                tracing::warn!("[Meeting Pipeline] Summary reply was not valid: {e}");
                None
            }
        },
        Err(e) => {
            tracing::warn!("[Meeting Pipeline] Summary call failed: {e:?}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(sizes: &[usize]) -> Vec<String> {
        sizes.iter().map(|n| "x".repeat(*n)).collect()
    }

    #[test]
    fn free_tier_budget_leaves_room_for_prompt_and_output() {
        let cfg = PipelineConfig::from_env();
        let budget = chunk_budget(&cfg);
        assert!(budget <= cfg.chunk_tokens);
        assert!(budget + cfg.max_output_tokens + PROMPT_OVERHEAD_TOKENS <= cfg.extract_tpm);
    }

    #[test]
    fn everything_fits_in_one_chunk_when_small() {
        assert_eq!(plan_chunks(&lines(&[30, 30, 30]), 100, 20), vec![(0, 3)]);
        assert!(plan_chunks(&[], 100, 20).is_empty());
    }

    #[test]
    fn chunks_respect_the_budget_and_overlap() {
        // each line costs 10 + 1 = 11 tokens
        let input = lines(&[30; 10]);
        let chunks = plan_chunks(&input, 40, 11);
        assert_eq!(chunks, vec![(0, 3), (2, 5), (4, 7), (6, 9), (8, 10)]);
        for (s, e) in &chunks {
            assert!((e - s) as u32 * 11 <= 40);
        }
        assert_eq!(chunks.last().unwrap().1, 10);
    }

    #[test]
    fn an_oversized_line_gets_its_own_chunk_and_progress_continues() {
        let chunks = plan_chunks(&lines(&[30, 600, 30]), 40, 40);
        assert_eq!(chunks, vec![(0, 1), (1, 2), (2, 3)]);
    }
}
