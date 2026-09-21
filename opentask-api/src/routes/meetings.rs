use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::meeting::{AnalyzeMeetingRequest, DatabaseMeeting};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::gemini::{generate_content, resolve_gemini_key};
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct InviteBotRequest {
    pub meeting_url: String,
    pub bot_name: Option<String>,
    pub project_id: Option<SafeId>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/meetings", post(create_meeting))
        .route("/db-meetings", post(create_meeting))
        .route("/meetings/project/{project_id}", get(list_project_meetings))
        .route("/db-meetings/project/{project_id}", get(list_project_meetings))
        .route("/analyze-meeting", post(analyze_meeting))
        .route("/invite-bot", post(invite_bot))
        .route("/webhooks/recall", post(handle_recall_webhook))
}

pub async fn create_meeting(
    State(state): State<AppState>,
    Json(payload): Json<DatabaseMeeting>,
) -> Result<Json<DatabaseMeeting>, AppError> {
    let meeting_id = next_id();
    let project_id = payload.project_id.map(|p| p.0);

    let row = sqlx::query_as::<_, DatabaseMeeting>(
        r#"
        INSERT INTO opentask.meetings
            (id, project_id, user_uuid, title, date, time, duration, source_type, mom_summary, key_decisions, action_items, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING id, project_id, user_uuid, title, date, time, duration, source_type, mom_summary, key_decisions, action_items, created_at;
        "#
    )
    .bind(meeting_id)
    .bind(project_id)
    .bind(payload.user_uuid)
    .bind(payload.title)
    .bind(payload.date)
    .bind(payload.time)
    .bind(payload.duration)
    .bind(payload.source_type)
    .bind(payload.mom_summary)
    .bind(payload.key_decisions)
    .bind(payload.action_items)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

pub async fn list_project_meetings(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<DatabaseMeeting>>, AppError> {
    let rows = sqlx::query_as::<_, DatabaseMeeting>(
        r#"
        SELECT id, project_id, user_uuid, title, date, time, duration, source_type, mom_summary, key_decisions, action_items, created_at
        FROM opentask.meetings
        WHERE project_id = $1
        ORDER BY created_at DESC;
        "#
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn analyze_meeting(
    State(state): State<AppState>,
    Json(payload): Json<AnalyzeMeetingRequest>,
) -> Result<Json<Value>, AppError> {
    let pid = payload.project_id.map(|p| p.0);
    let key = resolve_gemini_key(&state.pool, pid, None, Some(&state.config.gemini_api_key))
        .await
        .ok_or_else(|| AppError::BadRequest("No valid Google Gemini API key configured".to_string()))?;

    let prompt = format!(
        "Analyze this meeting transcript and extract structured MOM (Minutes of Meeting).\n\n\
         Transcript:\n{}\n\n\
         Respond with JSON strictly in this format:\n\
         {{\n\
           \"mom_summary\": \"High-level executive summary\",\n\
           \"key_decisions\": [\"decision 1\", \"decision 2\"],\n\
           \"action_items\": [\n\
             {{\"title\": \"Task Title\", \"description\": \"Details\", \"type\": \"CODE|DESIGN|REQUIREMENT\", \"weight\": 1-8}}\n\
           ]\n\
         }}",
        payload.transcript
    );

    let raw = generate_content(&key, "gemini-2.5-flash", None, &prompt).await?;
    let clean = raw.trim().trim_start_matches("```json").trim_end_matches("```").trim();
    let parsed: Value = serde_json::from_str(clean).unwrap_or(json!({
        "mom_summary": raw,
        "key_decisions": [],
        "action_items": []
    }));

    Ok(Json(parsed))
}

pub async fn invite_bot(
    State(state): State<AppState>,
    Json(payload): Json<InviteBotRequest>,
) -> Result<Json<Value>, AppError> {
    let recall_key = state
        .config
        .recall_api_key
        .as_deref()
        .ok_or_else(|| AppError::ServiceUnavailable("RECALL_API_KEY is not configured".to_string()))?;

    let client = Client::new();
    let bot_name = payload.bot_name.unwrap_or_else(|| "OpenTask Notetaker".to_string());

    let resp = client
        .post("https://us-east-1.recall.ai/api/v1/bot")
        .header("Authorization", format!("Token {recall_key}"))
        .json(&json!({
            "meeting_url": payload.meeting_url,
            "bot_name": bot_name,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let data: Value = resp.json().await.unwrap_or(Value::Null);
    Ok(Json(data))
}

pub async fn handle_recall_webhook(
    State(_state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let event = payload["event"].as_str().unwrap_or("");
    tracing::info!("Received Recall.ai webhook: {}", event);
    Json(json!({ "status": "received" }))
}
