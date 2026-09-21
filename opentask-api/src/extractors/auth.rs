use axum::{
    extract::FromRequestParts,
    http::request::Parts,
};
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::models::user::GitHubUserResponse;

static USER_CACHE: LazyLock<RwLock<HashMap<String, (Instant, GitHubUserResponse)>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

const CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes cache

pub fn extract_token_from_parts(parts: &Parts) -> Option<String> {
    // 1. Authorization: Bearer <token>
    if let Some(auth_header) = parts.headers.get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                let trimmed = token.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // 2. Cookie: gh_token=<token>
    if let Some(cookie_header) = parts.headers.get("Cookie") {
        if let Ok(cookie_str) = cookie_header.to_str() {
            for item in cookie_str.split(';') {
                let item = item.trim();
                if let Some(token) = item.strip_prefix("gh_token=") {
                    let trimmed = token.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

pub async fn resolve_github_user(token: &str) -> Result<GitHubUserResponse, AppError> {
    // Check cache
    {
        let cache = USER_CACHE.read().unwrap();
        if let Some((inserted, user)) = cache.get(token) {
            if inserted.elapsed() < CACHE_TTL {
                return Ok(user.clone());
            }
        }
    }

    // Call GitHub API
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Unauthorized(format!("Failed to contact GitHub: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Unauthorized("Invalid or expired access token".to_string()));
    }

    let user = resp
        .json::<GitHubUserResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse GitHub user response: {e}")))?;

    // Update cache
    {
        let mut cache = USER_CACHE.write().unwrap();
        cache.insert(token.to_string(), (Instant::now(), user.clone()));
    }

    Ok(user)
}

#[derive(Debug, Clone)]
pub struct CurrentUser(pub GitHubUserResponse, pub String); // user, token

impl<S> FromRequestParts<S> for CurrentUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let token = extract_token_from_parts(parts)
            .ok_or_else(|| AppError::Unauthorized("Not authenticated".to_string()))?;

        let user = resolve_github_user(&token).await?;
        Ok(CurrentUser(user, token))
    }
}

#[derive(Debug, Clone)]
pub struct OptionalCurrentUser(pub Option<GitHubUserResponse>);

impl<S> FromRequestParts<S> for OptionalCurrentUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let user = match extract_token_from_parts(parts) {
            Some(token) => resolve_github_user(&token).await.ok(),
            None => None,
        };

        Ok(OptionalCurrentUser(user))
    }
}
