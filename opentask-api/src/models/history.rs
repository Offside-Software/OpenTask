use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseProjectHistory {
    pub id: Option<SafeId>,
    pub project_id: SafeId,
    pub user_id: Option<SafeId>,
    pub user_name: Option<String>,
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: Option<SafeId>,
    pub description: String,
    pub metadata: Option<Value>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseActivity {
    pub id: Option<SafeId>,
    pub project_id: SafeId,
    pub user_name: Option<String>,
    pub action: String,
    pub target: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineActivity {
    pub id: String,
    pub user_name: String,
    pub action: String,
    pub target: String,
    pub created_at: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineBucket {
    pub timestamp: String,
    pub label: String,
    pub count: i64,
    pub activities: Vec<TimelineActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineData {
    pub interval: String,
    pub range_start: String,
    pub range_end: String,
    pub total_activities: i64,
    pub peak_count: i64,
    pub buckets: Vec<TimelineBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectHistoryResponse {
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub items: Vec<DatabaseProjectHistory>,
}
