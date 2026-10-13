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

use sqlx::Row;

use crate::error::AppError;
use crate::extractors::auth::CurrentUser;
use crate::routes::auth::AppState;
use crate::services::gemini::resolve_gemini_key;
use crate::services::github::{get_installation_token, get_repository_installation, verify_webhook_signature};
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
    let url = format!("https://github.com/apps/opentask-app/installations/new");
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

async fn resolve_installation_id(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    repo_name: &str,
    payload_id: u64,
) -> Option<u64> {
    if payload_id > 0 {
        return Some(payload_id);
    }

    // 1. Check existing installations in the database
    if let Ok(Some(row)) = crate::db::query_scalar::<_, Option<i64>>(
        r#"
        SELECT gi.installation_id
        FROM opentask.github_installations gi
        LEFT JOIN opentask.projects p ON gi.project_id = p.id
        WHERE EXISTS (
            SELECT 1 FROM unnest(p.gh_repo_url) AS configured_repo
            WHERE lower(trim(both '/' from regexp_replace(configured_repo, '^https?://github.com/', '', 'i'))) = lower($1)
        )
        OR gi.project_id IS NULL
        ORDER BY (gi.project_id IS NULL), gi.created_at DESC
        LIMIT 1;
        "#
    )
    .bind(repo_name)
    .fetch_optional(pool)
    .await
    {
        if let Some(id) = row.filter(|id| *id > 0) {
            return Some(id as u64);
        }
    }

    // 2. Fall back to global config
    if let Some(id) = config.gh_app_installation_id.filter(|id| *id > 0) {
        return Some(id as u64);
    }

    // 3. Query GitHub App API for the repo installation
    if config.gh_app_id > 0 && !config.gh_app_private_key.is_empty() {
        if let Ok((resolved, account_login, account_type)) =
            get_repository_installation(config.gh_app_id, &config.gh_app_private_key, repo_name).await
        {
            let _ = crate::db::query(
                r#"
                INSERT INTO opentask.github_installations
                    (id, installation_id, account_login, account_type)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (installation_id, project_id) DO UPDATE
                SET account_login = EXCLUDED.account_login,
                    account_type = EXCLUDED.account_type;
                "#
            )
            .bind(crate::services::id_generator::next_id())
            .bind(resolved as i64)
            .bind(account_login)
            .bind(account_type)
            .execute(pool)
            .await;

            return Some(resolved);
        }
    }

    None
}

async fn trigger_review_if_gemini_active(
    pool: &sqlx::PgPool,
    config: &crate::config::Config,
    repo_name: &str,
    pr_number: i64,
    installation_id: u64,
) {
    // 1. Find matching project
    let project_row = crate::db::query(
        r#"
        SELECT id FROM opentask.projects
        WHERE EXISTS (
            SELECT 1 FROM unnest(gh_repo_url) AS configured_repo
            WHERE lower(trim(both '/' from regexp_replace(configured_repo, '^https?://github.com/', '', 'i'))) = lower($1)
        )
        LIMIT 1;
        "#
    )
    .bind(repo_name)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let project_id: Option<i64> = project_row.as_ref().and_then(|r| r.try_get("id").ok());

    // 2. Verify Gemini API key exists
    let has_gemini = resolve_gemini_key(pool, project_id, None, Some(&config.gemini_api_key))
        .await
        .is_some();

    if !has_gemini {
        tracing::info!(
            "Skipping automated PR review for {repo_name}#{pr_number}: no Gemini API key configured"
        );
        return;
    }

    // 3. Debounce rapid duplicate reviews (within 15 seconds)
    let recent = crate::db::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM opentask.pr_reviews WHERE repo_full_name = $1 AND pr_number = $2 AND reviewed_at > NOW() - INTERVAL '15 seconds');"
    )
    .bind(repo_name)
    .bind(pr_number)
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if recent {
        tracing::info!(
            "Debouncing duplicate PR evaluation for {repo_name}#{pr_number} (evaluated recently)"
        );
        return;
    }

    tracing::info!(
        "Auto-triggering Gemini PR review for {repo_name}#{pr_number} (installation {installation_id})"
    );

    let pool_clone = pool.clone();
    let config_clone = config.clone();
    let repo_clone = repo_name.to_string();

    tokio::spawn(async move {
        if let Err(e) = evaluate_pull_request(
            &pool_clone,
            &config_clone,
            &repo_clone,
            pr_number,
            installation_id,
            None,
        )
        .await
        {
            tracing::error!("Automated PR evaluation error: {:?}", e);
        }
    });
}

async fn resolve_project_id_for_repo(
    pool: &sqlx::PgPool,
    repo_name: &str,
    head_branch: Option<&str>,
) -> Option<i64> {
    // 1. Projects configured with this repo URL
    let row = crate::db::query(
        r#"
        SELECT id FROM opentask.projects
        WHERE EXISTS (
            SELECT 1 FROM unnest(gh_repo_url) AS configured_repo
            WHERE lower(trim(both '/' from regexp_replace(configured_repo, '^https?://github.com/', '', 'i'))) = lower($1)
        )
        LIMIT 1;
        "#
    )
    .bind(repo_name)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(r) = row {
        if let Ok(pid) = r.try_get::<i64, _>("id") {
            return Some(pid);
        }
    }

    // 2. Check opentask.github_installations
    let row_inst = crate::db::query(
        "SELECT project_id FROM opentask.github_installations WHERE lower(repository_name) = lower($1) AND project_id IS NOT NULL LIMIT 1;"
    )
    .bind(repo_name)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(r) = row_inst {
        if let Ok(pid) = r.try_get::<Option<i64>, _>("project_id") {
            if let Some(pid) = pid {
                return Some(pid);
            }
        }
    }

    // 3. Fallback: Check if any task in any project has this branch_name
    if let Some(branch) = head_branch {
        let clean_branch = branch.trim_start_matches("refs/heads/").trim();
        if !clean_branch.is_empty() {
            let row_task = crate::db::query(
                "SELECT project_id FROM opentask.tasks WHERE lower(trim(branch_name)) = lower($1) AND project_id IS NOT NULL LIMIT 1;"
            )
            .bind(clean_branch)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

            if let Some(r) = row_task {
                if let Ok(pid) = r.try_get::<Option<i64>, _>("project_id") {
                    if let Some(pid) = pid {
                        return Some(pid);
                    }
                }
            }
        }
    }

    None
}

async fn find_bucket_by_target_state(
    pool: &sqlx::PgPool,
    project_id: i64,
    target_state: &str, // "ON_REVIEW" or "COMPLETED"
) -> Option<i64> {
    let row = crate::db::query(
        r#"
        SELECT id
        FROM opentask.buckets
        WHERE project_id = $1
        ORDER BY
            (upper(state) = upper($2)) DESC,
            (CASE 
                WHEN upper($2) = 'ON_REVIEW' AND (upper(name) LIKE '%REVIEW%' OR upper(state) LIKE '%REVIEW%') THEN 1
                WHEN upper($2) = 'COMPLETED' AND (upper(name) LIKE '%COMPLET%' OR upper(name) LIKE '%DONE%' OR upper(state) LIKE '%COMPLET%' OR upper(state) LIKE '%DONE%') THEN 1
                ELSE 0
            END) DESC,
            order_idx ASC
        LIMIT 1;
        "#
    )
    .bind(project_id)
    .bind(target_state)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;

    row.try_get::<i64, _>("id").ok()
}

async fn find_matching_tasks(
    pool: &sqlx::PgPool,
    project_id: i64,
    head_branch: &str,
    pr_title: Option<&str>,
    pr_body: Option<&str>,
) -> Vec<i64> {
    let clean_branch = head_branch.trim_start_matches("refs/heads/").trim();
    let mut matched_ids = Vec::new();

    // 1. Direct branch_name match
    if !clean_branch.is_empty() {
        if let Ok(rows) = crate::db::query(
            "SELECT id FROM opentask.tasks WHERE project_id = $1 AND lower(trim(branch_name)) = lower($2);"
        )
        .bind(project_id)
        .bind(clean_branch)
        .fetch_all(pool)
        .await
        {
            for r in rows {
                if let Ok(tid) = r.try_get::<i64, _>("id") {
                    matched_ids.push(tid);
                }
            }
        }
    }

    // 2. Scan branch name, title, and body for Snowflake ID patterns (17-20 digits)
    let text_to_scan = format!("{} {} {}", clean_branch, pr_title.unwrap_or(""), pr_body.unwrap_or(""));
    if let Ok(re) = regex::Regex::new(r"\b(\d{17,20})\b") {
        for cap in re.captures_iter(&text_to_scan) {
            if let Some(m) = cap.get(1) {
                if let Ok(potential_id) = m.as_str().parse::<i64>() {
                    if !matched_ids.contains(&potential_id) {
                        if let Ok(Some(_)) = crate::db::query(
                            "SELECT id FROM opentask.tasks WHERE id = $1 AND project_id = $2 LIMIT 1;"
                        )
                        .bind(potential_id)
                        .bind(project_id)
                        .fetch_optional(pool)
                        .await
                        {
                            matched_ids.push(potential_id);
                        }
                    }
                }
            }
        }
    }

    matched_ids
}

async fn auto_move_tasks_to_bucket(
    pool: &sqlx::PgPool,
    realtime: &crate::services::realtime::RealtimeHub,
    project_id: i64,
    task_ids: &[i64],
    target_bucket_id: i64,
    target_state_name: &str,
    trigger_reason: &str,
    actor_username: Option<&str>,
) {
    for &task_id in task_ids {
        let update_result = crate::db::query(
            r#"
            UPDATE opentask.tasks
            SET bucket_id = $1, updated_at = NOW(), last_activity_at = NOW()
            WHERE id = $2 AND bucket_id != $1
            RETURNING id, lead_assignee_id, title;
            "#
        )
        .bind(target_bucket_id)
        .bind(task_id)
        .fetch_optional(pool)
        .await;

        match update_result {
            Ok(Some(row)) => {
                let lead_assignee_id: Option<i64> = row.try_get("lead_assignee_id").ok().flatten();
                let title: String = row.try_get("title").unwrap_or_default();

                tracing::info!(
                    "Auto-moved task #{} ('{}') in project #{} to bucket #{} ({}) due to {}",
                    task_id,
                    title,
                    project_id,
                    target_bucket_id,
                    target_state_name,
                    trigger_reason
                );

                // Publish realtime event to project WebSocket listeners
                realtime.publish(project_id, "task", "moved", Some(task_id));

                // Record event in activity timeline
                let action_msg = if target_state_name == "COMPLETED" {
                    "moved to Completed (PR closed/merged)"
                } else {
                    "moved to On Review (PR active)"
                };

                let _ = crate::routes::activities::record_project_event(
                    pool,
                    project_id,
                    lead_assignee_id,
                    actor_username,
                    action_msg,
                    &title,
                    "TASK_MOVED",
                    "TASK",
                    Some(task_id),
                    None,
                )
                .await;
            }
            Ok(None) => {
                tracing::debug!("Task #{} is already in bucket #{}", task_id, target_bucket_id);
            }
            Err(e) => {
                tracing::error!("Failed to auto-move task #{}: {:?}", task_id, e);
            }
        }
    }
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
            let pr_number = payload["pull_request"]["number"].as_i64().unwrap_or(0);
            let repo_name = payload["repository"]["full_name"].as_str().unwrap_or("");
            let head_branch = payload["pull_request"]["head"]["ref"].as_str().unwrap_or("");
            let pr_title = payload["pull_request"]["title"].as_str();
            let pr_body = payload["pull_request"]["body"].as_str();
            let sender = payload["sender"]["login"].as_str();
            let raw_inst_id = payload["installation"]["id"].as_u64().unwrap_or(0);

            if matches!(action, "opened" | "synchronize" | "reopened" | "ready_for_review") {
                // 1. Auto-move task(s) to "ON_REVIEW"
                if let Some(project_id) = resolve_project_id_for_repo(&state.pool, repo_name, Some(head_branch)).await {
                    if let Some(target_bucket_id) = find_bucket_by_target_state(&state.pool, project_id, "ON_REVIEW").await {
                        let task_ids = find_matching_tasks(&state.pool, project_id, head_branch, pr_title, pr_body).await;
                        if !task_ids.is_empty() {
                            auto_move_tasks_to_bucket(
                                &state.pool,
                                &state.realtime,
                                project_id,
                                &task_ids,
                                target_bucket_id,
                                "ON_REVIEW",
                                &format!("PR #{pr_number} {action}"),
                                sender,
                            )
                            .await;
                        }
                    }
                }

                // 2. Automated PR Review if Gemini active
                if pr_number > 0 && !repo_name.is_empty() {
                    if let Some(installation_id) =
                        resolve_installation_id(&state.pool, &state.config, repo_name, raw_inst_id).await
                    {
                        trigger_review_if_gemini_active(
                            &state.pool,
                            &state.config,
                            repo_name,
                            pr_number,
                            installation_id,
                        )
                        .await;
                    } else {
                        tracing::warn!(
                            "Could not resolve GitHub installation ID for webhook on {}",
                            repo_name
                        );
                    }
                }
            } else if action == "closed" {
                // Auto-move task(s) to "COMPLETED" when PR is closed or merged
                if let Some(project_id) = resolve_project_id_for_repo(&state.pool, repo_name, Some(head_branch)).await {
                    if let Some(target_bucket_id) = find_bucket_by_target_state(&state.pool, project_id, "COMPLETED").await {
                        let task_ids = find_matching_tasks(&state.pool, project_id, head_branch, pr_title, pr_body).await;
                        if !task_ids.is_empty() {
                            let is_merged = payload["pull_request"]["merged"].as_bool().unwrap_or(false);
                            let reason = if is_merged {
                                format!("PR #{pr_number} merged")
                            } else {
                                format!("PR #{pr_number} closed")
                            };
                            auto_move_tasks_to_bucket(
                                &state.pool,
                                &state.realtime,
                                project_id,
                                &task_ids,
                                target_bucket_id,
                                "COMPLETED",
                                &reason,
                                sender,
                            )
                            .await;
                        }
                    }
                }
            }
        }
        "push" => {
            let repo_name = payload["repository"]["full_name"].as_str().unwrap_or("");
            let ref_str = payload["ref"].as_str().unwrap_or("");
            let is_deleted = payload["deleted"].as_bool().unwrap_or(false);
            let sender = payload["sender"]["login"].as_str();

            if !is_deleted && ref_str.starts_with("refs/heads/") && !repo_name.is_empty() {
                let branch_name = &ref_str["refs/heads/".len()..];
                let raw_inst_id = payload["installation"]["id"].as_u64().unwrap_or(0);

                if let Some(installation_id) =
                    resolve_installation_id(&state.pool, &state.config, repo_name, raw_inst_id).await
                {
                    // Look up open PRs matching this pushed branch
                    if let Ok(token) = get_installation_token(
                        state.config.gh_app_id,
                        &state.config.gh_app_private_key,
                        installation_id,
                    )
                    .await
                    {
                        let client = Client::new();
                        let url = format!(
                            "https://api.github.com/repos/{repo_name}/pulls?state=open&per_page=20"
                        );
                        if let Ok(resp) = client
                            .get(&url)
                            .bearer_auth(token)
                            .header("Accept", "application/vnd.github+json")
                            .header("User-Agent", "OpenTask-App")
                            .send()
                            .await
                        {
                            if let Ok(pulls) = resp.json::<Vec<Value>>().await {
                                for pull in pulls {
                                    let head_ref = pull["head"]["ref"].as_str().unwrap_or("");
                                    if head_ref == branch_name {
                                        let pr_number = pull["number"].as_i64().unwrap_or(0);
                                        let pr_title = pull["title"].as_str();
                                        let pr_body = pull["body"].as_str();

                                        // Auto-move task(s) to "ON_REVIEW" on pushing to active PR branch
                                        if let Some(project_id) = resolve_project_id_for_repo(&state.pool, repo_name, Some(branch_name)).await {
                                            if let Some(target_bucket_id) = find_bucket_by_target_state(&state.pool, project_id, "ON_REVIEW").await {
                                                let task_ids = find_matching_tasks(&state.pool, project_id, branch_name, pr_title, pr_body).await;
                                                if !task_ids.is_empty() {
                                                    auto_move_tasks_to_bucket(
                                                        &state.pool,
                                                        &state.realtime,
                                                        project_id,
                                                        &task_ids,
                                                        target_bucket_id,
                                                        "ON_REVIEW",
                                                        &format!("Push to branch '{branch_name}' with active PR #{pr_number}"),
                                                        sender,
                                                    )
                                                    .await;
                                                }
                                            }
                                        }

                                        if pr_number > 0 {
                                            tracing::info!(
                                                "Push to branch '{}' matches open PR #{} on {}",
                                                branch_name,
                                                pr_number,
                                                repo_name
                                            );
                                            trigger_review_if_gemini_active(
                                                &state.pool,
                                                &state.config,
                                                repo_name,
                                                pr_number,
                                                installation_id,
                                            )
                                            .await;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
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
