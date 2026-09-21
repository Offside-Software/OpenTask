use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseTask {
    pub id: Option<SafeId>,
    pub project_id: Option<SafeId>,
    pub bucket_id: Option<SafeId>,
    pub meeting_id: Option<SafeId>,
    pub parent_task_id: Option<SafeId>,
    pub lead_assignee_id: Option<SafeId>,
    pub suggested_assignee_id: Option<SafeId>,
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub weight: Option<i32>,
    pub branch_name: Option<String>,
    pub repo_url: Option<String>,
    pub last_activity_at: Option<DateTime<Utc>>,
    pub order_idx: Option<i32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskReviewItem {
    pub title: String,
    pub description: Option<String>,
    pub weight: i32,
    #[serde(rename = "type")]
    pub task_type: String,
    pub assignee_id: Option<SafeId>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchReviewPayload {
    pub alert_id: SafeId,
    pub project_id: SafeId,
    pub tasks: Vec<TaskReviewItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskReorderItem {
    pub id: SafeId,
    #[serde(default)]
    pub order_idx: i32,
    pub bucket_id: Option<SafeId>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum TaskReorderPayload {
    Object { tasks: Vec<TaskReorderItem> },
    List(Vec<SafeId>),
}
