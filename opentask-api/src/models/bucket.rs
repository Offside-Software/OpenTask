use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DatabaseBucket {
    pub id: Option<SafeId>,
    pub project_id: Option<SafeId>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub state: Option<String>,
    pub is_system_locked: Option<bool>,
    pub task_count: Option<i64>,
    pub order_idx: Option<i32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BucketReorderItem {
    pub id: SafeId,
    #[serde(default)]
    pub order_idx: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BucketReorderPayload {
    Object { buckets: Vec<BucketReorderItem> },
    List(Vec<SafeId>),
}
