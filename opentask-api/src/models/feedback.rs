use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Feedback {
    pub id: SafeId,
    pub user_id: Option<SafeId>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub feedback_type: String,
    pub category: Option<String>,
    pub rating: Option<i32>,
    pub title: Option<String>,
    pub description: String,
    pub device_info: Option<Value>,
    pub status: String,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateFeedbackPayload {
    pub feedback_type: Option<String>,
    pub category: Option<String>,
    pub rating: Option<i32>,
    pub title: Option<String>,
    pub description: String,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub device_info: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateFeedbackPayload {
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FeedbackQuery {
    pub status: Option<String>,
    pub feedback_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
