use axum::{
    extract::FromRequestParts,
    http::request::Parts,
};
use sqlx::{PgPool, Row};

use crate::error::AppError;
use crate::models::safe_id::SafeId;

#[derive(Debug, Clone)]
pub struct ProjectContext {
    pub id: SafeId,
    pub name: String,
}

impl<S> FromRequestParts<S> for ProjectContext
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let pool = parts
            .extensions
            .get::<PgPool>()
            .cloned()
            .ok_or_else(|| AppError::Internal("Database pool not available in request".to_string()))?;

        // 1. Check X-Project-Key header
        let mut raw_key = parts
            .headers
            .get("x-project-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_string());

        // 2. Fallback to Authorization: Bearer <key>
        if raw_key.is_none() {
            if let Some(auth) = parts.headers.get("Authorization").and_then(|v| v.to_str().ok()) {
                if let Some(bearer) = auth.strip_prefix("Bearer ") {
                    raw_key = Some(bearer.trim().to_string());
                }
            }
        }

        let key = raw_key
            .filter(|k| !k.is_empty())
            .ok_or_else(|| AppError::Unauthorized("Missing X-Project-Key or Bearer token".to_string()))?;

        let row = sqlx::query("SELECT id, name FROM opentask.projects WHERE api_key = $1 LIMIT 1;")
            .bind(key)
            .fetch_optional(&pool)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to verify project API key: {e}")))?;

        match row {
            Some(r) => {
                let id: i64 = r.try_get("id").unwrap_or(0);
                let name: String = r.try_get("name").unwrap_or_default();
                Ok(ProjectContext {
                    id: SafeId(id),
                    name,
                })
            }
            None => Err(AppError::Forbidden("Invalid project API key".to_string())),
        }
    }
}
