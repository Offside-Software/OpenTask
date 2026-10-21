use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use super::config::{GroqTier, PipelineConfig};
use super::llm::LlmClient;
use super::{StepError, WorkerContext};
use crate::config::Config;
use crate::error::AppError;

pub const GROQ: &str = "groq";
const DEV_DEFAULT_SECRET: &str = "opentask-local-development-secret-key-32chars";

pub struct KeyCipher {
    cipher: Aes256Gcm,
}

impl KeyCipher {
    pub fn from_secret(secret: &str) -> Self {
        let digest = Sha256::digest(format!("opentask:project-ai-key:v1:{secret}").as_bytes());
        let cipher = Aes256Gcm::new_from_slice(&digest[..]).expect("a SHA-256 digest is a valid 32-byte AES key");
        Self { cipher }
    }

    pub fn encrypt(&self, project_id: i64, plaintext: &str) -> Vec<u8> {
        let nonce = rand::random::<[u8; 12]>();
        let aad = project_id.to_be_bytes();
        let sealed = self
            .cipher
            .encrypt(&Nonce::from(nonce), Payload { msg: plaintext.as_bytes(), aad: &aad })
            .expect("AES-GCM encryption does not fail for small inputs");
        [nonce.as_slice(), &sealed].concat()
    }

    pub fn decrypt(&self, project_id: i64, data: &[u8]) -> Option<String> {
        if data.len() < 12 {
            return None;
        }
        let (nonce, sealed) = data.split_at(12);
        let nonce: [u8; 12] = nonce.try_into().ok()?;
        let aad = project_id.to_be_bytes();
        let plain = self.cipher.decrypt(&Nonce::from(nonce), Payload { msg: sealed, aad: &aad }).ok()?;
        String::from_utf8(plain).ok()
    }
}

/// A placeholder or the built-in development secret would make the encryption pointless.
pub fn weak_secret(secret: &str) -> bool {
    secret == DEV_DEFAULT_SECRET || secret.contains("replace-this") || secret.chars().count() < 32
}

fn cipher(config: &Config) -> Result<KeyCipher, AppError> {
    if weak_secret(&config.secret_key) && !cfg!(debug_assertions) {
        return Err(AppError::ServiceUnavailable(
            "Set SECRET_KEY to 32 or more random characters before storing project API keys".to_string(),
        ));
    }
    Ok(KeyCipher::from_secret(&config.secret_key))
}

fn tier_name(tier: GroqTier) -> &'static str {
    match tier {
        GroqTier::Free => "free",
        GroqTier::Developer => "developer",
    }
}

pub fn parse_tier(value: Option<&str>) -> Result<GroqTier, AppError> {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("free") => Ok(GroqTier::Free),
        Some("developer") | Some("dev") => Ok(GroqTier::Developer),
        Some(other) => Err(AppError::BadRequest(format!("Unknown Groq tier {other}; use free or developer"))),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectKeyInfo {
    pub provider: &'static str,
    pub configured: bool,
    /// The key's last four characters.
    pub hint: Option<String>,
    pub tier: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub can_manage: bool,
}

pub async fn info(pool: &PgPool, project_id: i64, can_manage: bool) -> Result<ProjectKeyInfo, sqlx::Error> {
    let row = crate::db::query_as::<_, (String, String, DateTime<Utc>)>(
        "SELECT key_hint, tier, updated_at FROM opentask.project_ai_keys WHERE project_id = $1 AND provider = $2;",
    )
    .bind(project_id)
    .bind(GROQ)
    .fetch_optional(pool)
    .await?;
    Ok(ProjectKeyInfo {
        provider: GROQ,
        configured: row.is_some(),
        hint: row.as_ref().map(|r| r.0.clone()),
        tier: row.as_ref().map(|r| r.1.clone()),
        updated_at: row.map(|r| r.2),
        can_manage,
    })
}

pub async fn has_project_key(pool: &PgPool, project_id: i64) -> Result<bool, sqlx::Error> {
    crate::db::query_scalar("SELECT EXISTS (SELECT 1 FROM opentask.project_ai_keys WHERE project_id = $1 AND provider = $2);")
        .bind(project_id)
        .bind(GROQ)
        .fetch_one(pool)
        .await
}

/// Asks Groq whether the key works before storing it.
async fn check_with_groq(base_url: &str, api_key: &str) -> Result<(), AppError> {
    let resp = reqwest::Client::new()
        .get(format!("{}/models", base_url.trim_end_matches('/')))
        .bearer_auth(api_key)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AppError::ServiceUnavailable(format!("Could not reach Groq to check the key: {}", e.without_url())))?;
    match resp.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(AppError::BadRequest("Groq rejected this API key".to_string())),
        status => Err(AppError::ServiceUnavailable(format!("Groq answered {status} while checking the key; try again"))),
    }
}

pub async fn save(
    pool: &PgPool,
    config: &Config,
    cfg: &PipelineConfig,
    project_id: i64,
    user_id: i64,
    api_key: &str,
    tier: GroqTier,
) -> Result<ProjectKeyInfo, AppError> {
    let api_key = api_key.trim();
    if api_key.len() < 20 || api_key.len() > 200 || api_key.chars().any(char::is_whitespace) {
        return Err(AppError::BadRequest("That does not look like a Groq API key".to_string()));
    }
    let cipher = cipher(config)?;
    check_with_groq(&cfg.groq_base_url, api_key).await?;
    let hint: String = api_key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    crate::db::query(
        r#"
        INSERT INTO opentask.project_ai_keys (project_id, provider, key_cipher, key_hint, tier, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (project_id, provider) DO UPDATE
        SET key_cipher = EXCLUDED.key_cipher, key_hint = EXCLUDED.key_hint, tier = EXCLUDED.tier,
            updated_by = EXCLUDED.updated_by, updated_at = NOW();
        "#,
    )
    .bind(project_id)
    .bind(GROQ)
    .bind(cipher.encrypt(project_id, api_key))
    .bind(&hint)
    .bind(tier_name(tier))
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(info(pool, project_id, true).await?)
}

pub async fn remove(pool: &PgPool, project_id: i64) -> Result<bool, sqlx::Error> {
    Ok(crate::db::query("DELETE FROM opentask.project_ai_keys WHERE project_id = $1 AND provider = $2;")
        .bind(project_id)
        .bind(GROQ)
        .execute(pool)
        .await?
        .rows_affected()
        > 0)
}

pub struct ProjectKey {
    pub api_key: String,
    pub tier: GroqTier,
}

/// The project's own Groq key, or `None` to use the shared one. A key that no longer decrypts
/// (SECRET_KEY changed) is treated as absent.
pub async fn resolve_groq_key(pool: &PgPool, config: &Config, project_id: i64) -> Result<Option<ProjectKey>, sqlx::Error> {
    let row = crate::db::query_as::<_, (Vec<u8>, String)>(
        "SELECT key_cipher, tier FROM opentask.project_ai_keys WHERE project_id = $1 AND provider = $2;",
    )
    .bind(project_id)
    .bind(GROQ)
    .fetch_optional(pool)
    .await?;
    let Some((data, tier)) = row else { return Ok(None) };
    match KeyCipher::from_secret(&config.secret_key).decrypt(project_id, &data) {
        Some(api_key) => Ok(Some(ProjectKey { api_key, tier: parse_tier(Some(&tier)).unwrap_or(GroqTier::Free) })),
        None => {
            tracing::warn!("[Meeting Pipeline] Project {project_id}'s Groq key does not decrypt (SECRET_KEY changed?); using the shared key");
            Ok(None)
        }
    }
}

/// The Groq client for a project: its own key when it has one, else the shared client.
pub async fn llm_for_project(
    pool: &PgPool,
    config: &Config,
    cfg: &PipelineConfig,
    shared: Option<&LlmClient>,
    project_id: i64,
) -> Result<Option<LlmClient>, sqlx::Error> {
    Ok(match resolve_groq_key(pool, config, project_id).await? {
        Some(key) => Some(LlmClient::new(&cfg.groq_base_url, &key.api_key).for_project(project_id).with_own_key(key.tier)),
        None => shared.map(|l| l.for_project(project_id)),
    })
}

pub async fn llm_for(ctx: &WorkerContext, project_id: i64) -> Result<Option<LlmClient>, StepError> {
    llm_for_project(&ctx.pool, &ctx.config, &ctx.cfg, ctx.llm.as_ref(), project_id)
        .await
        .map_err(|e| StepError::Retryable(format!("database error: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_only_for_their_project_and_secret() {
        let cipher = KeyCipher::from_secret("a-long-random-secret-for-tests-0123456789");
        let sealed = cipher.encrypt(42, "gsk_example_key_value_1234");
        assert!(!String::from_utf8_lossy(&sealed).contains("gsk_example"), "stored encrypted");
        assert_eq!(cipher.decrypt(42, &sealed).as_deref(), Some("gsk_example_key_value_1234"));
        assert_eq!(cipher.decrypt(43, &sealed), None, "bound to its project");
        assert_eq!(KeyCipher::from_secret("another-secret-entirely-0123456789").decrypt(42, &sealed), None);
        assert_ne!(cipher.encrypt(42, "same"), cipher.encrypt(42, "same"), "a fresh nonce every time");
        assert_eq!(cipher.decrypt(42, b"short"), None);
    }

    #[test]
    fn placeholder_secrets_are_weak() {
        assert!(weak_secret(DEV_DEFAULT_SECRET));
        assert!(weak_secret("replace-this-with-a-secure-random-key"));
        assert!(weak_secret("too-short"));
        assert!(!weak_secret("k3Jf9sL2pQ8vX1mN7bR4tY6wZ0aC5dE8"));
    }

    #[test]
    fn tiers_parse() {
        assert_eq!(parse_tier(None).unwrap(), GroqTier::Free);
        assert_eq!(parse_tier(Some("Developer")).unwrap(), GroqTier::Developer);
        assert!(parse_tier(Some("enterprise")).is_err());
    }
}
