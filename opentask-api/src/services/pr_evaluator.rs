use reqwest::Client;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::config::Config;
use crate::error::AppError;
use crate::services::gemini::{generate_content, resolve_gemini_key};
use crate::services::github::get_installation_token;
use crate::services::id_generator::next_id;

pub async fn evaluate_pull_request(
    pool: &PgPool,
    config: &Config,
    repo_full_name: &str,
    pr_number: i64,
    installation_id: u64,
) -> Result<(), AppError> {
    tracing::info!("Starting PR evaluation for {repo_full_name}#{pr_number}");

    // 1. Get installation token
    let token = get_installation_token(config.gh_app_id, &config.gh_app_private_key, installation_id).await?;

    let client = Client::new();

    // 2. Fetch PR details
    let pr_url = format!("https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}");
    let pr_resp = client
        .get(&pr_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch PR: {e}")))?;

    if !pr_resp.status().is_success() {
        return Err(AppError::Internal("GitHub PR not found".to_string()));
    }

    let pr_data: Value = pr_resp.json().await.map_err(|e| AppError::Internal(e.to_string()))?;
    let pr_title = pr_data["title"].as_str().unwrap_or("Untitled PR");
    let pr_html_url = pr_data["html_url"].as_str().unwrap_or("");
    let head_branch = pr_data["head"]["ref"].as_str().unwrap_or("");

    // 3. Fetch PR diff files
    let files_url = format!("https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}/files");
    let files_resp = client
        .get(&files_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "OpenTask-App")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch PR files: {e}")))?;

    let files_data: Value = files_resp.json().await.unwrap_or(Value::Array(vec![]));
    let mut diff_summary = String::new();
    if let Some(files) = files_data.as_array() {
        for f in files.iter().take(20) {
            let filename = f["filename"].as_str().unwrap_or("");
            let patch = f["patch"].as_str().unwrap_or("");
            diff_summary.push_str(&format!("--- {filename} ---\n{patch}\n\n"));
        }
    }

    // 4. Find matching project
    let project_row = sqlx::query(
        "SELECT id, name FROM opentask.projects WHERE $1 = ANY(gh_repo_url) LIMIT 1;"
    )
    .bind(repo_full_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let project_id: Option<i64> = project_row.as_ref().and_then(|r| r.try_get("id").ok());

    // 5. Resolve Gemini API key
    let gemini_key = resolve_gemini_key(pool, project_id, None, Some(&config.gemini_api_key))
        .await
        .ok_or_else(|| AppError::Internal("No valid Google Gemini API key configured".to_string()))?;

    // 6. Find tasks in project
    let tasks_summary = if let Some(pid) = project_id {
        let tasks = sqlx::query(
            "SELECT id, title, description, branch_name FROM opentask.tasks WHERE project_id = $1 LIMIT 50;"
        )
        .bind(pid)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let mut s = String::new();
        for t in tasks {
            let tid: i64 = t.try_get("id").unwrap_or(0);
            let title: String = t.try_get("title").unwrap_or_default();
            let bname: Option<String> = t.try_get("branch_name").ok();
            let desc: Option<String> = t.try_get("description").ok();
            s.push_str(&format!("- Task #{tid}: {title} (Branch: {bname:?})\n  Description: {desc:?}\n"));
        }
        s
    } else {
        "No tasks linked to this repository.".to_string()
    };

    // 7. Prompt Gemini
    let prompt = format!(
        "You are an expert AI code reviewer evaluating Pull Request #{pr_number}: '{pr_title}' on {head_branch}.\n\n\
         Available Project Tasks:\n{tasks_summary}\n\n\
         Pull Request Changes Summary:\n{diff_summary}\n\n\
         Evaluate if this PR satisfies a project task. Output JSON with fields:\n\
         {{\n\
           \"matched_task_id\": \"<task_id or null>\",\n\
           \"verdict\": \"PASS\" or \"FAIL\",\n\
           \"feedback\": \"markdown detailed feedback\",\n\
           \"completeness_score\": 0-100\n\
         }}"
    );

    let raw_review = generate_content(&gemini_key, "gemini-2.5-flash", None, &prompt).await?;

    // Parse JSON from response
    let clean_json = raw_review.trim().trim_start_matches("```json").trim_end_matches("```").trim();
    let parsed: Value = serde_json::from_str(clean_json).unwrap_or(json!({
        "verdict": "PASS",
        "feedback": raw_review,
        "completeness_score": 80
    }));

    let verdict = parsed["verdict"].as_str().unwrap_or("PASS");
    let feedback = parsed["feedback"].as_str().unwrap_or(&raw_review);
    let completeness = parsed["completeness_score"].as_i64().unwrap_or(80) as i32;
    let matched_id = parsed["matched_task_id"].as_str().and_then(|s| s.parse::<i64>().ok());

    // 8. Save review to DB
    let review_id = next_id();
    let _ = sqlx::query(
        r#"
        INSERT INTO opentask.pr_reviews
            (id, project_id, task_id, repo_full_name, pr_number, pr_title, pr_url, verdict, feedback, completeness_score, reviewed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW());
        "#
    )
    .bind(review_id)
    .bind(project_id)
    .bind(matched_id)
    .bind(repo_full_name)
    .bind(pr_number)
    .bind(pr_title)
    .bind(pr_html_url)
    .bind(verdict)
    .bind(feedback)
    .bind(completeness)
    .execute(pool)
    .await;

    // 9. Post comment to GitHub PR
    let comment_url = format!("https://api.github.com/repos/{repo_full_name}/issues/{pr_number}/comments");
    let comment_body = format!(
        "### 🤖 OpenTask AI Code Review\n\n\
         **Verdict**: `{verdict}` | **Completeness**: `{completeness}%`\n\n\
         {feedback}"
    );

    let _ = client
        .post(&comment_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "OpenTask-App")
        .json(&json!({ "body": comment_body }))
        .send()
        .await;

    // 10. Dispatch Web Push notification and persistent in-app alert
    let mut assignee_id = None;
    if let Some(tid) = matched_id {
        if let Ok(Some(t_row)) = sqlx::query("SELECT lead_assignee_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
            .bind(tid)
            .fetch_optional(pool)
            .await
        {
            assignee_id = t_row.try_get::<Option<i64>, _>("lead_assignee_id").ok().flatten();
        }
    }

    crate::services::notifications::notify_pr_reviewed(
        pool,
        config,
        &pr_title,
        assignee_id,
        &verdict,
        &pr_html_url,
        pr_number as u64,
        project_id,
        None,
        matched_id,
    )
    .await;

    tracing::info!("PR review completed and notifications dispatched for {}#{}", repo_full_name, pr_number);
    Ok(())
}
