use reqwest::Client;
use serde_json::json;

use crate::error::AppError;

pub async fn send_telegram_message(
    bot_token: &str,
    chat_id: &str,
    text: &str,
) -> Result<(), AppError> {
    let client = Client::new();
    let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");

    let payload = json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown"
    });

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to send Telegram message: {e}")))?;

    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        tracing::warn!("Telegram send error: {}", err);
    }

    Ok(())
}
