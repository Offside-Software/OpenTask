use reqwest::Client;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::error::AppError;
use crate::models::ai_key::TestKeyResponse;

pub fn mask_api_key(key: &str) -> Option<String> {
    let cleaned = key.trim();
    if cleaned.is_empty() {
        return None;
    }
    if cleaned.len() <= 8 {
        return Some("********".to_string());
    }
    Some(format!("{}****************{}", &cleaned[..6], &cleaned[cleaned.len() - 4..]))
}

pub async fn test_gemini_api_key(api_key: &str) -> TestKeyResponse {
    let cleaned = api_key.trim();
    if cleaned.is_empty() {
        return TestKeyResponse {
            valid: false,
            message: None,
            error: Some("API key cannot be empty".to_string()),
            model: None,
        };
    }

    let client = Client::new();
    let ping_models = ["gemini-3.6-flash", "gemini-flash-lite-latest"];

    for model in ping_models {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={cleaned}"
        );

        let body = json!({
            "contents": [{
                "parts": [{ "text": "ping" }]
            }],
            "generationConfig": {
                "maxOutputTokens": 10,
                "temperature": 0.0
            }
        });

        match client.post(&url).json(&body).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    return TestKeyResponse {
                        valid: true,
                        message: Some("Google Gemini API key successfully verified and operational!".to_string()),
                        error: None,
                        model: Some(model.to_string()),
                    };
                }
            }
            Err(_) => continue,
        }
    }

    TestKeyResponse {
        valid: false,
        message: None,
        error: Some("Verification failed: unable to validate API key with Gemini API".to_string()),
        model: None,
    }
}

pub async fn resolve_gemini_key(
    pool: &PgPool,
    project_id: Option<i64>,
    user_id: Option<i64>,
    explicit_key: Option<&str>,
) -> Option<String> {
    // 1. Explicit key
    if let Some(key) = explicit_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    // 2. Project custom key
    if let Some(pid) = project_id {
        let row = sqlx::query("SELECT custom_ai_api_key FROM opentask.projects WHERE id = $1 LIMIT 1;")
            .bind(pid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

        if let Some(r) = row {
            if let Ok(Some(k)) = r.try_get::<Option<String>, _>("custom_ai_api_key") {
                let trimmed = k.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
    }

    // 3. User personal key
    if let Some(uid) = user_id {
        let row = sqlx::query("SELECT custom_ai_api_key FROM opentask.users WHERE id = $1 LIMIT 1;")
            .bind(uid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

        if let Some(r) = row {
            if let Ok(Some(k)) = r.try_get::<Option<String>, _>("custom_ai_api_key") {
                let trimmed = k.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
    }

    None
}

pub async fn generate_content(
    api_key: &str,
    model: &str,
    system_prompt: Option<&str>,
    user_prompt: &str,
) -> Result<String, AppError> {
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    );

    let mut body = json!({
        "contents": [{
            "parts": [{ "text": user_prompt }]
        }]
    });

    if let Some(sys) = system_prompt {
        body["systemInstruction"] = json!({
            "parts": [{ "text": sys }]
        });
    }

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Gemini API request failed: {e}")))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("Gemini API error: {err_text}")));
    }

    let json_resp: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Gemini response: {e}")))?;

    let text = json_resp["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(text)
}
