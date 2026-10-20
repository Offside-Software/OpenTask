use serde::Deserialize;

use super::llm::{ChatRequest, LlmClient, ResponseFormat};
use super::prompts::{gate_user, GATE_SYSTEM};
use super::transcript::head_tail_sample;
use crate::models::meeting::{GateResult, GateVerdict};

#[derive(Debug, Deserialize)]
struct GateReply {
    #[serde(default)]
    doc_type: Option<String>,
    #[serde(default)]
    actionable: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Parses the model's reply. Anything unexpected reads as `unsure`.
pub fn parse_gate_reply(content: &str, model: &str) -> GateResult {
    let reply: Option<GateReply> = serde_json::from_str(content.trim()).ok();
    let verdict = match reply.as_ref().and_then(|r| r.actionable.as_deref()).map(str::trim) {
        Some(v) if v.eq_ignore_ascii_case("yes") => GateVerdict::Yes,
        Some(v) if v.eq_ignore_ascii_case("no") => GateVerdict::No,
        _ => GateVerdict::Unsure,
    };
    let doc_type = reply
        .as_ref()
        .and_then(|r| r.doc_type.clone())
        .filter(|d| {
            matches!(
                d.as_str(),
                "meeting_minutes" | "meeting_transcript" | "chat_or_email_thread" | "project_document" | "other"
            )
        })
        .or_else(|| Some("other".to_string()));
    let reason = reply
        .and_then(|r| r.reason)
        .map(|r| r.chars().take(300).collect::<String>())
        .filter(|r| !r.trim().is_empty());
    GateResult {
        verdict,
        reason,
        doc_type,
        model: Some(model.to_string()),
        failed_open: false,
    }
}

pub async fn run_gate(llm: Option<&LlmClient>, models: &[&str], text: &str, head: usize, tail: usize) -> GateResult {
    let failed_open = GateResult {
        verdict: GateVerdict::Unsure,
        reason: None,
        doc_type: None,
        model: None,
        failed_open: true,
    };
    let Some(llm) = llm else {
        return failed_open;
    };

    let user = gate_user(&head_tail_sample(text, head, tail));
    for model in models {
        let request = ChatRequest {
            model,
            messages: vec![("system", GATE_SYSTEM), ("user", &user)],
            max_completion_tokens: 800,
            format: ResponseFormat::JsonObject,
            reasoning_effort: model.starts_with("openai/gpt-oss").then_some("low"),
        };
        match llm.chat(&request).await {
            Ok(response) => return parse_gate_reply(&response.content, model),
            Err(e) => tracing::warn!("[Meeting Pipeline] Gate model {model} failed: {e:?}"),
        }
    }
    failed_open
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_parse_and_anything_odd_is_unsure() {
        let yes = parse_gate_reply(
            r#"{"doc_type":"meeting_minutes","actionable":"yes","reason":"Budi commits to a report."}"#,
            "m",
        );
        assert_eq!(yes.verdict, GateVerdict::Yes);
        assert_eq!(yes.doc_type.as_deref(), Some("meeting_minutes"));
        assert_eq!(yes.reason.as_deref(), Some("Budi commits to a report."));
        assert!(!yes.failed_open);

        assert_eq!(parse_gate_reply(r#"{"actionable":"NO"}"#, "m").verdict, GateVerdict::No);
        assert_eq!(parse_gate_reply(r#"{"actionable":"maybe"}"#, "m").verdict, GateVerdict::Unsure);
        assert_eq!(parse_gate_reply("not json", "m").verdict, GateVerdict::Unsure);
        let odd = parse_gate_reply(r#"{"doc_type":"poem","actionable":"yes"}"#, "m");
        assert_eq!(odd.doc_type.as_deref(), Some("other"));
    }
}
