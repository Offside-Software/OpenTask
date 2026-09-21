use hmac::{Hmac, Mac};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
struct GitHubAppClaims {
    iat: i64,
    exp: i64,
    iss: String,
}

#[derive(Debug, Deserialize)]
struct InstallationTokenResponse {
    token: String,
}

pub fn generate_app_jwt(app_id: u64, private_key_pem: &str) -> Result<String, AppError> {
    if app_id == 0 || private_key_pem.trim().is_empty() {
        return Err(AppError::Internal("GitHub App ID or Private Key is missing".to_string()));
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| AppError::Internal(e.to_string()))?
        .as_secs() as i64;

    let claims = GitHubAppClaims {
        iat: now - 60,
        exp: now + (10 * 60),
        iss: app_id.to_string(),
    };

    let key = EncodingKey::from_rsa_pem(private_key_pem.as_bytes())
        .map_err(|e| AppError::Internal(format!("Invalid RSA private key: {e}")))?;

    encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| AppError::Internal(format!("Failed to sign GitHub App JWT: {e}")))
}

pub async fn get_installation_token(
    app_id: u64,
    private_key_pem: &str,
    installation_id: u64,
) -> Result<String, AppError> {
    let jwt = generate_app_jwt(app_id, private_key_pem)?;
    let client = Client::new();

    let url = format!("https://api.github.com/app/installations/{installation_id}/access_tokens");
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to request installation token: {e}")))?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "GitHub refused installation token request: {err_text}"
        )));
    }

    let token_resp = resp
        .json::<InstallationTokenResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse token response: {e}")))?;

    Ok(token_resp.token)
}

pub fn verify_webhook_signature(secret: &str, payload: &[u8], signature_header: Option<&str>) -> bool {
    let sig_header = match signature_header {
        Some(s) if s.starts_with("sha256=") => &s[7..],
        _ => return false,
    };

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };

    mac.update(payload);
    let expected_bytes = mac.finalize().into_bytes();
    let expected_hex = hex::encode(expected_bytes);

    expected_hex.eq_ignore_ascii_case(sig_header)
}
