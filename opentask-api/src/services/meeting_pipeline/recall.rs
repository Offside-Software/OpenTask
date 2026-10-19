use std::path::Path;
use std::time::Duration;

use axum::http::HeaderMap;
use base64ct::{Base64, Encoding};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde_json::{json, Value};
use sha2::Sha256;
use tokio::io::AsyncWriteExt;

/// Webhooks older or newer than this are rejected.
const TIMESTAMP_TOLERANCE_SECS: i64 = 5 * 60;

fn client(timeout_secs: u64) -> Client {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn api(base_url: &str, path: &str) -> String {
    format!("{}{path}", base_url.trim_end_matches('/'))
}

/// Sends a bot that records the meeting's mixed audio (MP3). 
pub async fn create_bot(
    base_url: &str,
    api_key: &str,
    meeting_url: &str,
    bot_name: &str,
    metadata: Value,
) -> Result<String, String> {
    let resp = client(30)
        .post(api(base_url, "/api/v1/bot/"))
        .header("Authorization", format!("Token {api_key}"))
        .json(&json!({
            "meeting_url": meeting_url,
            "bot_name": bot_name,
            "metadata": metadata,
            "recording_config": { "audio_mixed_mp3": {} },
        }))
        .send()
        .await
        .map_err(|e| format!("could not reach Recall at {base_url}: {}", e.without_url()))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let detail = match status.as_u16() {
            401 | 403 => "Recall rejected the API key (check RECALL_API_KEY and RECALL_REGION)".to_string(),
            507 => "Recall has no bot free right now; try again in a few minutes".to_string(),
            _ => format!("Recall answered {status}: {}", body.to_string().chars().take(300).collect::<String>()),
        };
        return Err(detail);
    }
    body["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "Recall's response had no bot id".to_string())
}

/// `GET /api/v1/bot/{id}/`.
pub async fn get_bot(base_url: &str, api_key: &str, bot_id: &str) -> Result<Value, String> {
    client(30)
        .get(api(base_url, &format!("/api/v1/bot/{bot_id}/")))
        .header("Authorization", format!("Token {api_key}"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("could not read bot {bot_id}: {}", e.without_url()))?
        .json()
        .await
        .map_err(|e| format!("unreadable bot {bot_id}: {}", e.without_url()))
}

/// What a bot has produced so far.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BotMedia {
    pub status: Option<String>,
    pub sub_code: Option<String>,
    pub done_at: Option<DateTime<Utc>>,
    pub recorded: bool,
    pub audio_status: Option<String>,
    pub audio_url: Option<String>,
    pub speaker_timeline_url: Option<String>,
}

impl BotMedia {
    pub fn is_fatal(&self) -> bool {
        self.status.as_deref() == Some("fatal")
    }
}

/// Reads status and download URLs from a Retrieve Bot response.
pub fn bot_media(bot: &Value) -> BotMedia {
    let changes = bot["status_changes"].as_array().map(Vec::as_slice).unwrap_or_default();
    let text = |v: &Value| v.as_str().filter(|s| !s.is_empty()).map(str::to_string);
    let mut media = BotMedia {
        status: changes.last().and_then(|c| text(&c["code"])),
        sub_code: changes.iter().rev().find_map(|c| text(&c["sub_code"])),
        done_at: changes
            .iter()
            .rev()
            .find(|c| c["code"] == "done")
            .and_then(|c| c["created_at"].as_str()?.parse().ok()),
        recorded: changes.iter().any(|c| c["code"] == "in_call_recording"),
        ..Default::default()
    };
    for recording in bot["recordings"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let shortcuts = &recording["media_shortcuts"];
        if media.audio_status.is_none() {
            media.audio_status = text(&shortcuts["audio_mixed"]["status"]["code"]);
        }
        if media.audio_url.is_none() {
            media.audio_url = text(&shortcuts["audio_mixed"]["data"]["download_url"]);
        }
        if media.speaker_timeline_url.is_none() {
            media.speaker_timeline_url = text(&shortcuts["participant_events"]["data"]["speaker_timeline_download_url"]);
        }
    }
    media
}

#[derive(Debug, Clone, PartialEq)]
pub enum DownloadError {
    TooLarge(String),
    Failed(String),
}

/// Streams a (presigned) download to `path`, refusing more than `max_bytes`.
pub async fn download_to_file(url: &str, path: &Path, max_bytes: u64) -> Result<u64, DownloadError> {
    let mut resp = client(15 * 60)
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| DownloadError::Failed(format!("could not download the recording: {}", e.without_url())))?;
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| DownloadError::Failed(format!("could not create a temporary file: {e}")))?;
    let mut total = 0u64;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| DownloadError::Failed(format!("the recording download broke off: {}", e.without_url())))?
    {
        total += chunk.len() as u64;
        if total > max_bytes {
            return Err(DownloadError::TooLarge(format!("the recording is larger than {} MB", max_bytes / (1024 * 1024))));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| DownloadError::Failed(format!("could not write the recording: {e}")))?;
    }
    file.flush().await.map_err(|e| DownloadError::Failed(format!("could not write the recording: {e}")))?;
    Ok(total)
}

/// Downloads a JSON artifact (e.g. the speaker timeline).
pub async fn fetch_json(url: &str) -> Result<Value, String> {
    client(60)
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("could not download: {}", e.without_url()))?
        .json()
        .await
        .map_err(|e| format!("unreadable download: {}", e.without_url()))
}

pub fn verify_webhook(secret: &str, headers: &HeaderMap, body: &[u8], now_secs: i64) -> bool {
    let header = |a: &str, b: &str| {
        headers
            .get(a)
            .or_else(|| headers.get(b))
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
    };
    let (Some(id), Some(timestamp), Some(signatures)) = (
        header("webhook-id", "svix-id"),
        header("webhook-timestamp", "svix-timestamp"),
        header("webhook-signature", "svix-signature"),
    ) else {
        return false;
    };
    let Ok(sent_at) = timestamp.parse::<i64>() else {
        return false;
    };
    if (now_secs - sent_at).abs() > TIMESTAMP_TOLERANCE_SECS {
        return false;
    }
    let Ok(key) = Base64::decode_vec(secret.trim().strip_prefix("whsec_").unwrap_or(secret.trim())) else {
        return false;
    };

    let mut signed = Vec::with_capacity(id.len() + timestamp.len() + body.len() + 2);
    signed.extend_from_slice(id.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(timestamp.as_bytes());
    signed.push(b'.');
    signed.extend_from_slice(body);

    signatures.split_whitespace().any(|entry| {
        let Some(signature) = entry.strip_prefix("v1,") else {
            return false;
        };
        let Ok(expected) = Base64::decode_vec(signature) else {
            return false;
        };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&key) else {
            return false;
        };
        mac.update(&signed);
        mac.verify_slice(&expected).is_ok()
    })
}

/// Signs a body the way Recall does; used by tests and local tools.
pub fn sign_webhook(secret: &str, id: &str, timestamp: i64, body: &[u8]) -> String {
    let key = Base64::decode_vec(secret.strip_prefix("whsec_").unwrap_or(secret)).unwrap_or_default();
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).expect("HMAC accepts any key length");
    mac.update(format!("{id}.{timestamp}.").as_bytes());
    mac.update(body);
    format!("v1,{}", Base64::encode_string(&mac.finalize().into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

    fn headers(prefix: &str, id: &str, timestamp: i64, signature: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::HeaderName::from_bytes(format!("{prefix}-id").as_bytes()).unwrap(),
            HeaderValue::from_str(id).unwrap(),
        );
        h.insert(
            axum::http::HeaderName::from_bytes(format!("{prefix}-timestamp").as_bytes()).unwrap(),
            HeaderValue::from_str(&timestamp.to_string()).unwrap(),
        );
        h.insert(
            axum::http::HeaderName::from_bytes(format!("{prefix}-signature").as_bytes()).unwrap(),
            HeaderValue::from_str(signature).unwrap(),
        );
        h
    }

    #[test]
    fn bot_media_reads_status_and_urls() {
        let bot = json!({
            "status_changes": [
                { "code": "in_call_recording", "sub_code": null },
                { "code": "done", "sub_code": null }
            ],
            "recordings": [{
                "id": "rec-1",
                "media_shortcuts": {
                    "audio_mixed": { "status": { "code": "done" }, "data": { "download_url": "https://s3/audio.mp3" } },
                    "participant_events": { "data": { "speaker_timeline_download_url": "https://s3/timeline.json" } },
                    "video_mixed": null
                }
            }]
        });
        let media = bot_media(&bot);
        assert_eq!(media.status.as_deref(), Some("done"));
        assert_eq!(media.audio_url.as_deref(), Some("https://s3/audio.mp3"));
        assert_eq!(media.speaker_timeline_url.as_deref(), Some("https://s3/timeline.json"));
        assert!(!media.is_fatal());

        let waiting = bot_media(&json!({
            "status_changes": [{ "code": "in_call_recording" }],
            "recordings": [{ "media_shortcuts": { "audio_mixed": null } }]
        }));
        assert_eq!((waiting.status.as_deref(), waiting.audio_url), (Some("in_call_recording"), None));

        let failed = bot_media(&json!({ "status_changes": [{ "code": "fatal", "sub_code": "meeting_not_found" }] }));
        assert!(failed.is_fatal());
        assert_eq!(failed.sub_code.as_deref(), Some("meeting_not_found"));
        assert_eq!(bot_media(&json!({})), BotMedia::default());
    }

    #[test]
    fn bot_media_reads_how_the_bot_ended() {
        // Never admitted: the reason sits on call_ended, done has none, no recording exists.
        let unadmitted = bot_media(&json!({
            "status_changes": [
                { "code": "joining_call", "created_at": "2026-10-19T11:32:01Z" },
                { "code": "in_waiting_room", "created_at": "2026-10-19T11:32:20Z" },
                { "code": "call_ended", "sub_code": "timeout_exceeded_waiting_room", "created_at": "2026-10-19T11:42:20Z" },
                { "code": "done", "sub_code": null, "created_at": "2026-10-19T11:42:31.081625Z" }
            ],
            "recordings": []
        }));
        assert_eq!(unadmitted.status.as_deref(), Some("done"));
        assert_eq!(unadmitted.sub_code.as_deref(), Some("timeout_exceeded_waiting_room"));
        assert_eq!(unadmitted.done_at, Some("2026-10-19T11:42:31.081625Z".parse().unwrap()));
        assert!(!unadmitted.recorded);
        assert_eq!((unadmitted.audio_status, unadmitted.audio_url), (None, None));

        // Recorded, but the audio is still being processed.
        let processing = bot_media(&json!({
            "status_changes": [{ "code": "in_call_recording" }, { "code": "call_ended" }],
            "recordings": [{ "media_shortcuts": { "audio_mixed": { "status": { "code": "processing" }, "data": null } } }]
        }));
        assert!(processing.recorded);
        assert_eq!(processing.done_at, None);
        assert_eq!(processing.audio_status.as_deref(), Some("processing"));
        assert_eq!(processing.audio_url, None);
    }

    #[test]
    fn matches_the_svix_reference_signature() {
        // Svix's documented example: secret, msg_id, timestamp, payload and expected signature.
        let body = br#"{"test": 2432232314}"#;
        let signature = sign_webhook(SECRET, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, body);
        assert_eq!(signature, "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
    }

    #[test]
    fn accepts_valid_signatures_on_either_header_set() {
        let body = br#"{"event":"transcript.done"}"#;
        let now = 1_800_000_000;
        let signature = sign_webhook(SECRET, "msg_1", now, body);
        assert!(verify_webhook(SECRET, &headers("webhook", "msg_1", now, &signature), body, now + 10));
        assert!(verify_webhook(SECRET, &headers("svix", "msg_1", now, &signature), body, now));
        let rotated = format!("v1,AAAA {signature}");
        assert!(verify_webhook(SECRET, &headers("webhook", "msg_1", now, &rotated), body, now));
    }

    #[test]
    fn rejects_tampering_staleness_and_missing_headers() {
        let body = br#"{"event":"transcript.done"}"#;
        let now = 1_800_000_000;
        let signature = sign_webhook(SECRET, "msg_1", now, body);
        assert!(!verify_webhook(SECRET, &headers("webhook", "msg_1", now, &signature), b"{}", now));
        assert!(!verify_webhook(SECRET, &headers("webhook", "msg_2", now, &signature), body, now));
        assert!(!verify_webhook(SECRET, &headers("webhook", "msg_1", now, &signature), body, now + 301));
        assert!(!verify_webhook("whsec_b3RoZXJzZWNyZXQ=", &headers("webhook", "msg_1", now, &signature), body, now));
        assert!(!verify_webhook(SECRET, &HeaderMap::new(), body, now));
        let v2 = signature.replacen("v1,", "v2,", 1);
        assert!(!verify_webhook(SECRET, &headers("webhook", "msg_1", now, &v2), body, now));
    }
}
