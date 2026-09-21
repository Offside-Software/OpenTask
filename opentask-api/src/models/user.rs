use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseUser {
    pub id: Option<SafeId>,
    pub display_name: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub telegram_chat_id: Option<String>,
    pub gh_username: Option<String>,
    pub gh_access_token: Option<String>,
    pub gh_id: Option<String>,
    pub email: Option<String>,
    pub custom_ai_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AuthMeResponse {
    pub id: Option<SafeId>,
    pub login: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: Option<String>,
    pub public_repos: Option<i64>,
    pub followers: Option<i64>,
    pub db_user: Option<DatabaseUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUserResponse {
    pub id: i64,
    pub login: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub html_url: Option<String>,
    pub public_repos: Option<i64>,
    pub followers: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserUpdate {
    pub display_name: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub gh_username: Option<String>,
    pub gh_access_token: Option<String>,
    pub gh_id: Option<String>,
    pub email: Option<String>,
    pub custom_ai_api_key: Option<String>,
}
