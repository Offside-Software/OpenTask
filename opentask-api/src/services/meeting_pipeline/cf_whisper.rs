use std::path::Path;
use std::time::Duration;

use base64ct::{Base64, Encoding};
use reqwest::StatusCode;
use serde_json::{json, Value};

use super::llm::{LlmError, WhisperResponse, WhisperSegment};
use super::usage;

pub struct CfWhisper<'a> {
    pub base_url: &'a str,
    pub account_id: &'a str,
    pub api_token: &'a str,
    pub model: &'a str,
    pub project_id: Option<i64>,
}

impl CfWhisper<'_> {
    pub async fn transcribe(
        &self,
        path: &Path,
        language: Option<&str>,
        prompt: Option<&str>,
        audio_secs: f32,
    ) -> Result<WhisperResponse, LlmError> {
        let audio = audio_secs.ceil() as u32;
        if let Some(wait) = usage::global().and_then(|l| l.wait_for(None, self.model, 0, audio)) {
            return Err(LlmError::RateLimited { retry_after: Some(wait) });
        }
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|e| LlmError::Fatal(format!("could not read the audio part: {e}")))?;
        let mut body = json!({ "audio": Base64::encode_string(&bytes), "task": "transcribe" });
        if let Some(language) = language {
            body["language"] = json!(language);
        }
        if let Some(prompt) = prompt.filter(|p| !p.is_empty()) {
            body["initial_prompt"] = json!(prompt);
        }

        let url = format!("{}/accounts/{}/ai/run/{}", self.base_url.trim_end_matches('/'), self.account_id, self.model);
        let resp = reqwest::Client::new()
            .post(url)
            .bearer_auth(self.api_token)
            .json(&body)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| LlmError::Transient(format!("Cloudflare request failed: {}", e.without_url())))?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(LlmError::RateLimited { retry_after: None });
        }
        let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !status.is_success() || value["success"] == json!(false) {
            let detail = value["errors"][0]["message"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| text.chars().take(300).collect());
            return Err(if status.is_server_error() {
                LlmError::Transient(format!("Cloudflare {status}: {detail}"))
            } else {
                LlmError::Fatal(format!("Cloudflare {status}: {detail}"))
            });
        }
        let response = parse_response(&value["result"])
            .ok_or_else(|| LlmError::Transient("Cloudflare returned no segments".to_string()))?;
        if let Some(limiter) = usage::global() {
            limiter.record(self.project_id, false, self.model, 0, audio);
        }
        Ok(response)
    }
}

/// Maps Workers AI's result (`transcription_info`, `segments`) onto Groq's verbose_json shape.
pub fn parse_response(result: &Value) -> Option<WhisperResponse> {
    let segments = result["segments"].as_array()?;
    let number = |v: &Value| v.as_f64().map(|n| n as f32);
    Some(WhisperResponse {
        language: result["transcription_info"]["language"].as_str().map(str::to_string),
        duration: number(&result["transcription_info"]["duration"]),
        segments: segments
            .iter()
            .filter_map(|s| {
                Some(WhisperSegment {
                    start: number(&s["start"])?,
                    end: number(&s["end"])?,
                    text: s["text"].as_str()?.to_string(),
                    avg_logprob: number(&s["avg_logprob"]),
                    no_speech_prob: number(&s["no_speech_prob"]),
                    compression_ratio: number(&s["compression_ratio"]),
                })
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_workers_ai_result() {
        let result = json!({
            "transcription_info": { "language": "id", "language_probability": 0.98, "duration": 31.5, "duration_after_vad": 30.0 },
            "text": "Halo semua. Budi kirim laporan.",
            "word_count": 5,
            "segments": [
                { "start": 0.0, "end": 2.1, "text": " Halo semua.", "temperature": 0.0, "avg_logprob": -0.2, "compression_ratio": 1.1, "no_speech_prob": 0.01, "words": [] },
                { "start": 2.4, "end": 5.0, "text": " Budi kirim laporan.", "avg_logprob": -0.3, "no_speech_prob": 0.02 },
                { "start": "bad" }
            ],
            "vtt": "WEBVTT"
        });
        let parsed = parse_response(&result).unwrap();
        assert_eq!(parsed.language.as_deref(), Some("id"));
        assert_eq!(parsed.duration, Some(31.5));
        assert_eq!(parsed.segments.len(), 2, "malformed segments are skipped");
        assert_eq!(parsed.segments[1].text, " Budi kirim laporan.");
        assert_eq!(parsed.segments[1].compression_ratio, None);
        assert!(parse_response(&json!({ "text": "no segments" })).is_none());
    }
}
