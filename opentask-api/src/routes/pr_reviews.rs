use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::Row;

use crate::error::AppError;
use crate::models::pr_review::{DatabasePrReview, TriggerPrReviewPayload};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::github::get_installation_token;
use crate::services::pr_evaluator::evaluate_pull_request;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/projects/{project_id}/pr-reviews",
            get(list_project_pr_reviews),
        )
        .route("/tasks/{task_id}/pr-reviews", get(list_task_pr_reviews))
        .route(
            "/projects/{project_id}/pr-reviews/trigger",
            post(trigger_pr_review),
        )
        .route("/projects/{project_id}/pulls", get(list_project_pulls))
}

pub async fn list_project_pr_reviews(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<DatabasePrReview>>, AppError> {
    let rows = sqlx::query_as::<_, DatabasePrReview>(
        r#"
        SELECT id, project_id, task_id,
               repo_full_name, pr_number, pr_title, pr_url, verdict, feedback, matched_task_title, completeness_score, reviewed_at
        FROM opentask.pr_reviews
        WHERE project_id = $1
        ORDER BY reviewed_at DESC;
        "#
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn list_task_pr_reviews(
    State(state): State<AppState>,
    Path(task_id): Path<SafeId>,
) -> Result<Json<Vec<DatabasePrReview>>, AppError> {
    let rows = sqlx::query_as::<_, DatabasePrReview>(
        r#"
        SELECT id, project_id, task_id,
               repo_full_name, pr_number, pr_title, pr_url, verdict, feedback, matched_task_title, completeness_score, reviewed_at
        FROM opentask.pr_reviews
        WHERE task_id = $1
        ORDER BY reviewed_at DESC;
        "#
    )
    .bind(task_id.0)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

pub async fn trigger_pr_review(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Json(payload): Json<TriggerPrReviewPayload>,
) -> Result<Json<Value>, AppError> {
    let installation_id = payload.installation_id.unwrap_or(
        state.config.gh_app_installation_id.unwrap_or(0) as i64,
    ) as u64;

    if installation_id == 0 {
        return Err(AppError::BadRequest("No GitHub installation ID provided or configured".to_string()));
    }

    let pool_clone = state.pool.clone();
    let config_clone = state.config.clone();
    let repo_clone = payload.repo_full_name.clone();
    let pr_num = payload.pr_number;

    tokio::spawn(async move {
        if let Err(e) = evaluate_pull_request(&pool_clone, &config_clone, &repo_clone, pr_num, installation_id).await {
            tracing::error!("Triggered PR evaluation error: {:?}", e);
        }
    });

    Ok(Json(json!({
        "status": "queued",
        "project_id": project_id,
        "repo_full_name": payload.repo_full_name,
        "pr_number": payload.pr_number
    })))
}

pub async fn list_project_pulls(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Value>, AppError> {
    let row = sqlx::query("SELECT gh_repo_url FROM opentask.projects WHERE id = $1;")
        .bind(project_id.0)
        .fetch_optional(&state.pool)
        .await?;

    let repos: Vec<String> = row
        .and_then(|r| r.try_get::<Option<Vec<String>>, _>("gh_repo_url").ok())
        .flatten()
        .unwrap_or_default();

    if repos.is_empty() {
        return Ok(Json(Value::Array(vec![])));
    }

    let installation_id = state.config.gh_app_installation_id.unwrap_or(0);
    if installation_id == 0 {
        return Ok(Json(Value::Array(vec![])));
    }

    let token = get_installation_token(state.config.gh_app_id, &state.config.gh_app_private_key, installation_id).await?;
    let client = Client::new();

    let mut all_pulls = Vec::new();
    for repo in repos {
        let clean_repo = repo.trim_start_matches("https://github.com/").trim_end_matches(".git");
        let url = format!("https://api.github.com/repos/{clean_repo}/pulls?state=open&per_page=20");

        if let Ok(resp) = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "OpenTask-App")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(data) = resp.json::<Vec<Value>>().await {
                    all_pulls.extend(data);
                }
            }
        }
    }

    Ok(Json(Value::Array(all_pulls)))
}
