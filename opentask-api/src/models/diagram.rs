use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProjectDiagram {
    pub id: SafeId,
    pub project_id: SafeId,
    pub title: String,
    pub code: String,
    pub description: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDiagramPayload {
    pub title: String,
    pub code: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDiagramPayload {
    pub title: Option<String>,
    pub code: Option<String>,
    pub description: Option<String>,
}
