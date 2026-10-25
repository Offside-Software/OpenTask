use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde_json::{json, Value};
use sqlx::Row;

use crate::error::AppError;
use crate::models::pr_review::{
    DatabasePrReview, ExtractTasksPayload, ExtractTasksResponse, ExtractedTaskItem,
    TriggerPrReviewPayload,
};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::gemini::{generate_content, resolve_gemini_key, DEFAULT_TEXT_MODEL};
use crate::services::github::{get_installation_token, get_repository_installation};
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
        .route(
            "/projects/{project_id}/sync-prs",
            post(sync_project_prs),
        )
        .route("/projects/{project_id}/pulls", get(list_project_pulls))
        .route(
            "/projects/{project_id}/pr-reviews/{review_id}/extract-tasks",
            post(extract_tasks_from_review),
        )
}

pub async fn list_project_pr_reviews(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<DatabasePrReview>>, AppError> {
    let rows = crate::db::query_as::<_, DatabasePrReview>(
        r#"
        SELECT id, project_id, task_id,
               repo_full_name, pr_number::BIGINT AS pr_number, pr_title, pr_url, verdict, feedback, matched_task_title, completeness_score, reviewed_at
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
    let rows = crate::db::query_as::<_, DatabasePrReview>(
        r#"
        SELECT id, project_id, task_id,
               repo_full_name, pr_number::BIGINT AS pr_number, pr_title, pr_url, verdict, feedback, matched_task_title, completeness_score, reviewed_at
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
    let mut repo_full_name = payload.repo_full_name.clone();
    let mut pr_number = payload.pr_number;
    let task_id = payload.task_id.map(|id| id.0);

    if let Some(url) = payload.pr_url.as_deref() {
        if task_id.is_none() {
            return Err(AppError::BadRequest(
                "task_id is required when pr_url is provided".to_string(),
            ));
        }
        {
            let (repo, number) = parse_github_pr_url(url)?;
            repo_full_name = Some(repo);
            pr_number = Some(number);
        }
    }

    let task_context = if let Some(task_id) = task_id {
        crate::db::query(
            "SELECT branch_name, title, repo_url FROM opentask.tasks WHERE id = $1 AND project_id = $2 LIMIT 1;",
        )
        .bind(task_id)
        .bind(project_id.0)
        .fetch_optional(&state.pool)
        .await?
    } else {
        None
    };

    if repo_full_name.as_deref().map(str::trim).unwrap_or("").is_empty() {
        repo_full_name = task_context
            .as_ref()
            .and_then(|row| row.try_get::<Option<String>, _>("repo_url").ok().flatten())
            .and_then(|url| normalize_repo_name(&url));
    }

    if repo_full_name.as_deref().map(str::trim).unwrap_or("").is_empty() {
        let project = crate::db::query(
            "SELECT gh_repo_url FROM opentask.projects WHERE id = $1 LIMIT 1;",
        )
        .bind(project_id.0)
        .fetch_optional(&state.pool)
        .await?;
        repo_full_name = project
            .and_then(|row| row.try_get::<Option<Vec<String>>, _>("gh_repo_url").ok().flatten())
            .and_then(|repos| repos.into_iter().find_map(|repo| normalize_repo_name(&repo)));
    }

    let repo_full_name = repo_full_name
        .filter(|repo| !repo.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("No GitHub repository is configured for this task or project".to_string()))?;
    let mut installation_id = match payload.installation_id {
        Some(id) if id > 0 => id as u64,
        _ => crate::db::query_scalar::<_, Option<i64>>(
            "SELECT installation_id FROM opentask.github_installations WHERE project_id = $1 OR project_id IS NULL ORDER BY (project_id IS NULL), created_at DESC LIMIT 1;",
        )
        .bind(project_id.0)
        .fetch_one(&state.pool)
        .await?
        .or_else(|| state.config.gh_app_installation_id.map(|id| id as i64))
        .unwrap_or(0) as u64,
    };
    if installation_id == 0 {
        let (resolved_id, account_login, account_type) = get_repository_installation(
            state.config.gh_app_id,
            &state.config.gh_app_private_key,
            &repo_full_name,
        )
        .await?;
        crate::db::query(
            r#"
            INSERT INTO opentask.github_installations
                (id, installation_id, account_login, account_type, project_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (installation_id, project_id) DO UPDATE
            SET account_login = EXCLUDED.account_login,
                account_type = EXCLUDED.account_type;
            "#,
        )
        .bind(crate::services::id_generator::next_id())
        .bind(resolved_id as i64)
        .bind(account_login)
        .bind(account_type)
        .bind(project_id.0)
        .execute(&state.pool)
        .await?;
        installation_id = resolved_id;
    }
    let pr_number = match pr_number.filter(|number| *number > 0) {
        Some(number) => number,
        None => find_task_pull_request(
            &repo_full_name,
            task_context.as_ref(),
            &state.config,
            installation_id,
        )
        .await?,
    };

    // Run inline so the caller gets the real outcome (errors are surfaced to the UI
    // instead of being swallowed by a detached background task).
    evaluate_pull_request(
        &state.pool,
        &state.config,
        &state.realtime,
        &repo_full_name,
        pr_number,
        installation_id,
        task_id,
    )
    .await
    .map_err(|error| {
        tracing::error!("Triggered PR evaluation error: {error:?}");
        error
    })?;

    Ok(Json(json!({
        "status": "completed",
        "project_id": project_id,
        "task_id": task_id.map(SafeId),
        "repo_full_name": repo_full_name,
        "pr_number": pr_number
    })))
}

fn normalize_repo_name(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/').trim_end_matches(".git");
    let repo = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .unwrap_or(trimmed)
        .trim_matches('/');
    (!repo.is_empty() && repo.split('/').count() == 2).then(|| repo.to_string())
}

async fn find_task_pull_request(
    repo_full_name: &str,
    task: Option<&sqlx::postgres::PgRow>,
    config: &crate::config::Config,
    installation_id: u64,
) -> Result<i64, AppError> {
    let token = get_installation_token(
        config.gh_app_id,
        &config.gh_app_private_key,
        installation_id,
    )
    .await?;
    let response = Client::new()
        .get(format!(
            "https://api.github.com/repos/{repo_full_name}/pulls?state=all&per_page=50"
        ))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to find task pull request: {error}")))?;
    if !response.status().is_success() {
        return Err(AppError::BadRequest(format!(
            "GitHub could not list pull requests for {repo_full_name}"
        )));
    }

    let mut pulls = response
        .json::<Vec<Value>>()
        .await
        .map_err(|error| AppError::Internal(format!("Failed to parse GitHub pull requests: {error}")))?;
    // Prefer active (open) pull requests; stable sort keeps GitHub's newest-first order.
    pulls.sort_by_key(|pull| pull["state"].as_str() != Some("open"));
    let branch = task
        .and_then(|row| row.try_get::<Option<String>, _>("branch_name").ok().flatten())
        .unwrap_or_default()
        .to_lowercase();
    let title = task
        .and_then(|row| row.try_get::<String, _>("title").ok())
        .unwrap_or_default()
        .to_lowercase();

    let matching = pulls.iter().find(|pull| {
        let head = pull["head"]["ref"].as_str().unwrap_or("").to_lowercase();
        !branch.is_empty() && (head == branch || head.contains(&branch) || branch.contains(&head))
    });
    let matching = matching.or_else(|| {
        pulls.iter().find(|pull| {
            let pull_title = pull["title"].as_str().unwrap_or("").to_lowercase();
            title.split_whitespace()
                .filter(|word| word.len() > 3)
                .any(|word| pull_title.contains(word))
        })
    });
    let matching = matching.or_else(|| pulls.first()).ok_or_else(|| {
        AppError::BadRequest(format!(
            "No pull request found for task branch '{}' in {repo_full_name}",
            branch
        ))
    })?;

    matching["number"].as_i64().filter(|number| *number > 0).ok_or_else(|| {
        AppError::Internal("GitHub returned a pull request without a valid number".to_string())
    })
}

fn parse_github_pr_url(url: &str) -> Result<(String, i64), AppError> {
    let parts: Vec<&str> = url.trim_end_matches('/').split('/').collect();
    if parts.len() < 5 || parts[2] != "github.com" || parts[parts.len() - 2] != "pull" {
        return Err(AppError::BadRequest("Invalid GitHub pull request URL".to_string()));
    }
    let owner = parts[3];
    let repo = parts[4];
    let number = parts[parts.len() - 1]
        .parse::<i64>()
        .map_err(|_| AppError::BadRequest("Invalid GitHub pull request number".to_string()))?;

    Ok((format!("{owner}/{repo}"), number))
}

pub async fn sync_project_prs(
        State(state): State<AppState>,
        Path(project_id): Path<SafeId>,
    ) -> Result<Json<Value>, AppError> {
        let row = crate::db::query("SELECT gh_repo_url FROM opentask.projects WHERE id = $1;")
            .bind(project_id.0)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("Project {project_id} not found")))?;

        let repos = row
            .try_get::<Option<Vec<String>>, _>("gh_repo_url")
            .ok()
            .flatten()
            .unwrap_or_default();
        let installation_id = state
            .config
            .gh_app_installation_id
            .ok_or_else(|| AppError::BadRequest("GitHub App installation is not configured".to_string()))?;
        let token = get_installation_token(
            state.config.gh_app_id,
            &state.config.gh_app_private_key,
            installation_id,
        )
        .await?;
        let client = Client::new();
        let mut scanned = 0;
        let mut reviews_triggered = 0;
        let mut pull_requests = Vec::new();

        for configured_repo in repos {
            let repo = configured_repo
                .trim()
                .trim_end_matches(".git")
                .trim_end_matches('/')
                .trim_start_matches("https://github.com/")
                .trim_start_matches("http://github.com/")
                .to_string();
            if repo.is_empty() {
                continue;
            }

            let response = client
                .get(format!("https://api.github.com/repos/{repo}/pulls?state=open&per_page=50"))
                .bearer_auth(&token)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "OpenTask-App")
                .send()
                .await
                .map_err(|error| AppError::Internal(format!("Failed to list GitHub pull requests: {error}")))?;
            if !response.status().is_success() {
                continue;
            }

            let pulls = response.json::<Vec<Value>>().await.unwrap_or_default();
            for pull in pulls {
                scanned += 1;
                let number = pull["number"].as_i64().unwrap_or(0);
                if number <= 0 {
                    continue;
                }
                pull_requests.push(pull.clone());

                let already_reviewed = crate::db::query_scalar::<_, bool>(
                    "SELECT EXISTS (SELECT 1 FROM opentask.pr_reviews WHERE project_id = $1 AND repo_full_name = $2 AND pr_number = $3);",
                )
                .bind(project_id.0)
                .bind(&repo)
                .bind(number)
                .fetch_one(&state.pool)
                .await?;
                if already_reviewed {
                    continue;
                }

                let pool_clone = state.pool.clone();
                let config_clone = state.config.clone();
                let repo_clone = repo.clone();
                let realtime_clone = state.realtime.clone();
                tokio::spawn(async move {
                    if let Err(error) = evaluate_pull_request(
                        &pool_clone,
                        &config_clone,
                        &realtime_clone,
                        &repo_clone,
                        number,
                        installation_id,
                        None,
                    )
                    .await
                    {
                        tracing::error!("Synchronized PR evaluation error: {error:?}");
                    }
                });
                reviews_triggered += 1;
            }
        }

        Ok(Json(json!({
            "scanned": scanned,
            "reviews_triggered": reviews_triggered,
            "pull_requests": pull_requests
        })))
    }

pub async fn list_project_pulls(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Value>, AppError> {
    let row = crate::db::query("SELECT gh_repo_url FROM opentask.projects WHERE id = $1;")
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

pub async fn extract_tasks_from_review(
    State(state): State<AppState>,
    Path((project_id, review_id)): Path<(SafeId, SafeId)>,
    Json(payload): Json<ExtractTasksPayload>,
) -> Result<Json<ExtractTasksResponse>, AppError> {
    let feedback = match payload.feedback.filter(|f| !f.trim().is_empty()) {
        Some(fb) => fb,
        None => {
            let row = crate::db::query(
                "SELECT feedback FROM opentask.pr_reviews WHERE id = $1 LIMIT 1;",
            )
            .bind(review_id.0)
            .fetch_optional(&state.pool)
            .await?;

            row.and_then(|r| r.try_get::<Option<String>, _>("feedback").ok().flatten())
                .unwrap_or_default()
        }
    };

    if feedback.trim().is_empty() {
        return Ok(Json(ExtractTasksResponse { tasks: vec![] }));
    }

    let mut tasks = Vec::new();

    // 1. Try Gemini extraction if API key is configured
    let gemini_key = resolve_gemini_key(
        &state.pool,
        Some(project_id.0),
        None,
        Some(&state.config.gemini_api_key),
    )
    .await;

    if let Some(key) = gemini_key {
        let prompt = format!(
            "You are an expert technical lead and agile product manager.\n\
             Extract all actionable issues, bug fixes, refactoring suggestions, and improvements from this code review into discrete tasks.\n\n\
             Code Review:\n\
             \"\"\"\n\
             {feedback}\n\
             \"\"\"\n\n\
             Output a JSON object ONLY with no markdown wrapping in this format:\n\
             {{\n\
               \"tasks\": [\n\
                 {{\n\
                   \"title\": \"Concise action-oriented title\",\n\
                   \"description\": \"Clear context, specific file paths, and lines if mentioned in the review\",\n\
                   \"type\": \"BUG\" or \"IMPROVEMENT\" or \"CODE\" or \"SECURITY\",\n\
                   \"weight\": 1, 2, 3, 5, or 8\n\
                 }}\n\
               ]\n\
             }}"
        );

        if let Ok(raw_json) = generate_content(&key, DEFAULT_TEXT_MODEL, None, &prompt).await {
            let clean = raw_json
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();

            if let Ok(parsed) = serde_json::from_str::<Value>(clean) {
                if let Some(arr) = parsed["tasks"].as_array() {
                    for item in arr {
                        if let Some(title) = item["title"].as_str().filter(|s| !s.trim().is_empty()) {
                            let desc = item["description"].as_str().map(|s| s.trim().to_string());
                            let ttype = item["type"].as_str().unwrap_or("IMPROVEMENT").to_string();
                            let weight = item["weight"].as_i64().unwrap_or(3) as i32;

                            tasks.push(ExtractedTaskItem {
                                title: title.trim().to_string(),
                                description: desc,
                                task_type: Some(ttype),
                                weight: Some(weight),
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. Deterministic heuristic fallback if Gemini returned 0 tasks
    if tasks.is_empty() {
        tasks = extract_tasks_heuristic_fallback(&feedback);
    }

    Ok(Json(ExtractTasksResponse { tasks }))
}

fn extract_tasks_heuristic_fallback(feedback: &str) -> Vec<ExtractedTaskItem> {
    let mut tasks = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_desc = Vec::new();
    let mut in_actionable_section = false;

    for line in feedback.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            let lower = trimmed.to_lowercase();
            in_actionable_section = lower.contains("issue")
                || lower.contains("improvement")
                || lower.contains("recommend")
                || lower.contains("action")
                || lower.contains("fix")
                || lower.contains("todo");
            continue;
        }

        let is_numbered = trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && (trimmed.contains(". ") || trimmed.contains(") "));

        let is_bullet = trimmed.starts_with("- ") || trimmed.starts_with("* ");

        if (is_numbered || (is_bullet && in_actionable_section)) && !trimmed.starts_with("- [") {
            if let Some(t) = current_title.take() {
                if !t.trim().is_empty() {
                    let desc = if current_desc.is_empty() {
                        None
                    } else {
                        Some(current_desc.join("\n").trim().to_string())
                    };
                    let ttype = classify_task_type(&t, desc.as_deref().unwrap_or(""));
                    tasks.push(ExtractedTaskItem {
                        title: t,
                        description: desc,
                        task_type: Some(ttype),
                        weight: Some(3),
                    });
                    current_desc.clear();
                }
            }

            let raw_item = if is_numbered {
                if let Some((_, rest)) = trimmed.split_once(". ") {
                    rest
                } else if let Some((_, rest)) = trimmed.split_once(") ") {
                    rest
                } else {
                    trimmed
                }
            } else {
                trimmed.trim_start_matches("- ").trim_start_matches("* ")
            };

            let clean_title = raw_item
                .trim_start_matches("**")
                .trim_end_matches("**")
                .trim_end_matches(':')
                .replace("**", "")
                .replace('`', "")
                .trim()
                .to_string();

            if clean_title.len() > 3 {
                current_title = Some(clean_title);
            }
        } else if current_title.is_some() && !trimmed.is_empty() {
            current_desc.push(trimmed.to_string());
        }
    }

    if let Some(t) = current_title.take() {
        if !t.trim().is_empty() {
            let desc = if current_desc.is_empty() {
                None
            } else {
                Some(current_desc.join("\n").trim().to_string())
            };
            let ttype = classify_task_type(&t, desc.as_deref().unwrap_or(""));
            tasks.push(ExtractedTaskItem {
                title: t,
                description: desc,
                task_type: Some(ttype),
                weight: Some(3),
            });
        }
    }

    tasks
}

fn classify_task_type(title: &str, desc: &str) -> String {
    let combined = format!("{title} {desc}").to_lowercase();
    if combined.contains("security")
        || combined.contains("token")
        || combined.contains("leak")
        || combined.contains("auth")
    {
        "SECURITY".to_string()
    } else if combined.contains("critical")
        || combined.contains("bug")
        || combined.contains("fix")
        || combined.contains("error")
    {
        "BUG".to_string()
    } else if combined.contains("refactor")
        || combined.contains("clean")
        || combined.contains("style")
    {
        "CODE".to_string()
    } else {
        "IMPROVEMENT".to_string()
    }
}
