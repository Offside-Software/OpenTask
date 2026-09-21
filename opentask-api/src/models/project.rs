use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::bucket::DatabaseBucket;
use crate::models::safe_id::SafeId;
use crate::models::task::DatabaseTask;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseProject {
    pub id: Option<SafeId>,
    pub name: String,
    pub gh_repo_url: Option<Vec<String>>,
    pub description: Option<String>,
    pub custom_ai_api_key: Option<String>,
    pub api_key: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardResponse {
    pub buckets: Vec<DatabaseBucket>,
    pub tasks: Vec<DatabaseTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProjectMember {
    pub id: Option<SafeId>,
    pub project_id: SafeId,
    pub user_id: SafeId,
    pub role: String,
    pub kpi_score: Option<f64>,
    pub max_capacity: Option<i32>,
    pub current_load: Option<i32>,
    pub gh_username: Option<String>,
    #[sqlx(default)]
    pub display_name: Option<String>,
    #[sqlx(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectApiKeyResponse {
    pub project_id: SafeId,
    pub api_key: String,
}
