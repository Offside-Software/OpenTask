use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::{json, Value};

use super::config::GroqTier;
use super::usage;

pub const GROQ_BASE_URL: &str = "https://api.groq.com/openai/v1";

#[derive(Debug, Clone)]
pub struct LlmClient {
    http: Client,
    base_url: String,
    api_key: String,
    /// Usage is booked to this project.
    project_id: Option<i64>,
    /// Set when this is the project's own key rather than the shared one.
    own_key: Option<GroqTier>,
}

#[derive(Debug, Clone, Copy)]
pub enum ResponseFormat<'a> {
    JsonObject,
    JsonSchema { name: &'a str, schema: &'a Value },
}

#[derive(Debug, Clone)]
pub struct ChatRequest<'a> {
    pub model: &'a str,
    pub messages: Vec<(&'a str, &'a str)>,
    pub max_completion_tokens: u32,
    pub format: ResponseFormat<'a>,
    pub reasoning_effort: Option<&'a str>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

#[derive(Debug, Clone)]
pub struct ChatResponse {
    pub content: String,
    pub usage: Usage,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LlmError {
    RateLimited { retry_after: Option<Duration> },
    Transient(String),
    Fatal(String),
}

impl LlmClient {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            project_id: None,
            own_key: None,
        }
    }

    pub fn with_own_key(self, tier: GroqTier) -> Self {
        Self { own_key: Some(tier), ..self }
    }

    pub fn has_own_key(&self) -> bool {
        self.own_key.is_some()
    }

    /// The budget calls are checked against; `None` for an own Developer-tier key (no local limits).
    fn limit_scope(&self) -> Option<usage::Scope> {
        match self.own_key {
            None => Some(None),
            Some(GroqTier::Free) => Some(self.project_id),
            Some(GroqTier::Developer) => None,
        }
    }

    fn wait_for(&self, model: &str, tokens: u32, audio: u32) -> Option<Duration> {
        let scope = self.limit_scope()?;
        usage::global()?.wait_for(scope, model, tokens, audio)
    }

    fn record(&self, model: &str, tokens: u32, audio: u32) {
        if let Some(limiter) = usage::global() {
            limiter.record(self.project_id, self.own_key.is_some(), model, tokens, audio);
        }
    }

    pub fn for_project(&self, project_id: i64) -> Self {
        Self { project_id: Some(project_id), ..self.clone() }
    }

    pub async fn chat(&self, req: &ChatRequest<'_>) -> Result<ChatResponse, LlmError> {
        let estimate = req.messages.iter().map(|(_, c)| c.chars().count() as u32).sum::<u32>().div_ceil(3)
            + req.max_completion_tokens;
        if let Some(wait) = self.wait_for(req.model, estimate, 0) {
            return Err(LlmError::RateLimited { retry_after: Some(wait) });
        }
        let messages: Vec<Value> = req
            .messages
            .iter()
            .map(|(role, content)| json!({ "role": role, "content": content }))
            .collect();

        let mut body = json!({
            "model": req.model,
            "messages": messages,
            "temperature": 0,
            "max_completion_tokens": req.max_completion_tokens,
            "response_format": match req.format {
                ResponseFormat::JsonObject => json!({ "type": "json_object" }),
                ResponseFormat::JsonSchema { name, schema } => json!({
                    "type": "json_schema",
                    "json_schema": { "name": name, "strict": true, "schema": schema }
                }),
            },
        });
        if let Some(effort) = req.reasoning_effort {
            body["reasoning_effort"] = json!(effort);
            body["include_reasoning"] = json!(false);
        }

        let resp = self
            .http
            .post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| LlmError::Transient(format!("request failed: {}", e.without_url())))?;

        let status = resp.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<f64>().ok())
                .map(|secs| Duration::from_secs_f64(secs.max(0.0)));
            return Err(LlmError::RateLimited { retry_after });
        }
        if !status.is_success() {
            let detail = provider_error(resp).await;
            return Err(if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT {
                LlmError::Transient(format!("{status}: {detail}"))
            } else {
                LlmError::Fatal(format!("{status}: {detail}"))
            });
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| LlmError::Transient(format!("unreadable response: {}", e.without_url())))?;
        let content = data["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| LlmError::Transient("response had no message content".to_string()))?
            .to_string();
        let usage = Usage {
            prompt_tokens: data["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: data["usage"]["completion_tokens"].as_u64().unwrap_or(0) as u32,
        };
        self.record(req.model, usage.prompt_tokens + usage.completion_tokens, 0);
        Ok(ChatResponse { content, usage })
    }
}

/// Whisper `verbose_json` reply
#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, PartialEq)]
pub struct WhisperResponse {
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub duration: Option<f32>,
    #[serde(default)]
    pub segments: Vec<WhisperSegment>,
}

#[derive(Debug, Clone, Default, serde::Deserialize, serde::Serialize, PartialEq)]
pub struct WhisperSegment {
    pub start: f32,
    pub end: f32,
    pub text: String,
    #[serde(default)]
    pub avg_logprob: Option<f32>,
    #[serde(default)]
    pub no_speech_prob: Option<f32>,
    #[serde(default)]
    pub compression_ratio: Option<f32>,
}

impl LlmClient {
    pub async fn transcribe(
        &self,
        model: &str,
        path: &std::path::Path,
        language: Option<&str>,
        prompt: Option<&str>,
        audio_secs: f32,
    ) -> Result<WhisperResponse, LlmError> {
        let audio = audio_secs.ceil() as u32;
        if let Some(wait) = self.wait_for(model, 0, audio) {
            return Err(LlmError::RateLimited { retry_after: Some(wait) });
        }
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|e| LlmError::Fatal(format!("could not read the audio part: {e}")))?;
        let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("audio.ogg").to_string();
        let file = reqwest::multipart::Part::bytes(bytes)
            .file_name(file_name)
            .mime_str("audio/ogg")
            .map_err(|e| LlmError::Fatal(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", file)
            .text("model", model.to_string())
            .text("response_format", "verbose_json")
            .text("timestamp_granularities[]", "segment")
            .text("temperature", "0");
        if let Some(language) = language {
            form = form.text("language", language.to_string());
        }
        if let Some(prompt) = prompt.filter(|p| !p.is_empty()) {
            form = form.text("prompt", prompt.to_string());
        }

        let resp = self
            .http
            .post(format!("{}/audio/transcriptions", self.base_url))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .timeout(Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| LlmError::Transient(format!("request failed: {}", e.without_url())))?;

        let status = resp.status();
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<f64>().ok())
                .map(|secs| Duration::from_secs_f64(secs.max(0.0)));
            return Err(LlmError::RateLimited { retry_after });
        }
        if !status.is_success() {
            let detail = provider_error(resp).await;
            return Err(if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT {
                LlmError::Transient(format!("{status}: {detail}"))
            } else {
                LlmError::Fatal(format!("{status}: {detail}"))
            });
        }
        let response = resp
            .json::<WhisperResponse>()
            .await
            .map_err(|e| LlmError::Transient(format!("unreadable transcription: {}", e.without_url())))?;
        self.record(model, 0, audio);
        Ok(response)
    }
}

/// The provider's error message, shortened.
async fn provider_error(resp: reqwest::Response) -> String {
    let text = resp.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or(text);
    message.chars().take(300).collect()
}
