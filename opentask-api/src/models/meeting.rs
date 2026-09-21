use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseMeeting {
    pub id: Option<SafeId>,
    pub project_id: Option<SafeId>,
    pub user_uuid: Option<String>,
    pub title: Option<String>,
    pub date: Option<String>,
    pub time: Option<String>,
    pub duration: Option<String>,
    pub source_type: Option<String>,
    pub mom_summary: Option<String>,
    pub key_decisions: Option<Value>,
    pub action_items: Option<Value>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnalyzeMeetingRequest {
    pub transcript: String,
    pub title: Option<String>,
    pub project_id: Option<SafeId>,
}
