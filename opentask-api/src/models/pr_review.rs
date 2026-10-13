use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabasePrReview {
    pub id: Option<SafeId>,
    pub project_id: Option<SafeId>,
    pub task_id: Option<SafeId>,
    pub repo_full_name: String,
    pub pr_number: i64,
    pub pr_title: Option<String>,
    pub pr_url: Option<String>,
    pub verdict: String,
    pub feedback: Option<String>,
    pub matched_task_title: Option<String>,
    pub completeness_score: Option<i32>,
    pub reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerPrReviewPayload {
    pub repo_full_name: Option<String>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    pub task_id: Option<SafeId>,
    pub installation_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ExtractTasksPayload {
    pub feedback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedTaskItem {
    pub title: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub weight: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractTasksResponse {
    pub tasks: Vec<ExtractedTaskItem>,
}
