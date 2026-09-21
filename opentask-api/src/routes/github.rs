use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::routes::auth::AppState;
use crate::services::github::{get_installation_token, verify_webhook_signature};
use crate::services::pr_evaluator::evaluate_pull_request;

#[derive(Debug, Deserialize)]
pub struct SearchUsersQuery {
    pub q: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/github/app", get(get_app_info))
        .route("/github/repos", get(get_user_repos))
        .route("/github/installations", get(get_installations))
        .route(
            "/github/installations/{installation_id}/repos",
            get(get_installation_repos),
        )
        .route("/github/app/install-url", get(get_install_url))
        .route("/github/webhook", post(handle_webhook))
        .route("/github/users/search", get(search_github_users))
}

pub async fn get_app_info(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "app_id": state.config.gh_app_id,
        "client_id": state.config.gh_app_client_id,
        "configured": state.config.gh_app_id > 0
    }))
}

pub async fn get_install_url(State(_state): State<AppState>) -> Json<Value> {
    let url = format!("https://github.com/apps/opentask/installations/new");
    Json(json!({ "install_url": url }))
}

pub async fn get_user_repos(
    CurrentUser(_user, token): CurrentUser,
) -> Result<Json<Value>, AppError> {
    let client = Client::new();
    let resp = client
        .get("https://api.github.com/user/repos?per_page=100&sort=updated")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let repos: Value = resp.json().await.unwrap_or(Value::Array(vec![]));
    Ok(Json(repos))
}

pub async fn get_installations(
    CurrentUser(_user, token): CurrentUser,
) -> Result<Json<Value>, AppError> {
    let client = Client::new();
    let resp = client
        .get("https://api.github.com/user/installations")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let data: Value = resp.json().await.unwrap_or(Value::Array(vec![]));
    Ok(Json(data))
}

pub async fn get_installation_repos(
    State(state): State<AppState>,
    Path(installation_id): Path<u64>,
) -> Result<Json<Value>, AppError> {
    let token = get_installation_token(
        state.config.gh_app_id,
        &state.config.gh_app_private_key,
        installation_id,
    )
    .await?;

    let client = Client::new();
    let resp = client
        .get("https://api.github.com/installation/repositories")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let data: Value = resp.json().await.unwrap_or(Value::Array(vec![]));
    Ok(Json(data))
}

pub async fn handle_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok());

    if !state.config.gh_webhook_secret.is_empty() {
        if !verify_webhook_signature(&state.config.gh_webhook_secret, &body, signature) {
            return Err(AppError::Unauthorized("Invalid webhook signature".to_string()));
        }
    }

    let event = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let payload: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);

    match event {
        "pull_request" => {
            let action = payload["action"].as_str().unwrap_or("");
            if matches!(action, "opened" | "synchronize" | "reopened") {
                let pr_number = payload["pull_request"]["number"].as_i64().unwrap_or(0);
                let repo_name = payload["repository"]["full_name"].as_str().unwrap_or("");
                let installation_id = payload["installation"]["id"].as_u64().unwrap_or(0);

                if pr_number > 0 && !repo_name.is_empty() && installation_id > 0 {
                    let pool_clone = state.pool.clone();
                    let config_clone = state.config.clone();
                    let repo_str = repo_name.to_string();

                    tokio::spawn(async move {
                        if let Err(e) = evaluate_pull_request(
                            &pool_clone,
                            &config_clone,
                            &repo_str,
                            pr_number,
                            installation_id,
                        )
                        .await
                        {
                            tracing::error!("PR evaluation background error: {:?}", e);
                        }
                    });
                }
            }
        }
        "push" => {
            let repo_name = payload["repository"]["full_name"].as_str().unwrap_or("");
            tracing::info!("Received push event for {}", repo_name);
        }
        _ => {}
    }

    Ok(StatusCode::OK)
}

pub async fn search_github_users(
    CurrentUser(_user, token): CurrentUser,
    Query(query): Query<SearchUsersQuery>,
) -> Result<Json<Value>, AppError> {
    let client = Client::new();
    let url = format!(
        "https://api.github.com/search/users?q={}&per_page=10",
        query.q.trim()
    );

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let data: Value = resp.json().await.unwrap_or(Value::Array(vec![]));
    Ok(Json(data))
}
