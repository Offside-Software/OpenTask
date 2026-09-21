use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseAlert {
    pub id: Option<SafeId>,
    pub user_id: Option<SafeId>,
    pub context_id: Option<SafeId>,
    pub project_id: Option<SafeId>,
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub alert_type: Option<String>,
    pub severity: Option<String>,
    pub suggested_actions: Option<Vec<String>>,
    pub is_resolved: Option<bool>,
    pub pr_url: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}
