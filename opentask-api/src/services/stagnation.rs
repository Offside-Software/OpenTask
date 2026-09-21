use chrono::{Duration, Utc};
use sqlx::{PgPool, Row};

use crate::config::Config;
use crate::services::id_generator::next_id;
use crate::services::telegram::send_telegram_message;

pub async fn run_stagnation_radar(pool: &PgPool, config: &Config) -> Result<(), sqlx::Error> {
    tracing::info!("Running Stagnation Radar check...");

    // 1. Find ongoing buckets
    let ongoing_rows = sqlx::query("SELECT id FROM opentask.buckets WHERE state = 'ONGOING';")
        .fetch_all(pool)
        .await?;

    if ongoing_rows.is_empty() {
        tracing::info!("No ONGOING buckets found.");
        return Ok(());
    }

    let bucket_ids: Vec<i64> = ongoing_rows
        .into_iter()
        .map(|r| r.try_get::<i64, _>("id").unwrap_or(0))
        .collect();

    // 2. Find stagnant tasks (> 48h without activity)
    let threshold = Utc::now() - Duration::hours(48);

    let stagnant_tasks = sqlx::query(
        r#"
        SELECT id, title, project_id, lead_assignee_id, suggested_assignee_id
        FROM opentask.tasks
        WHERE bucket_id = ANY($1)
          AND last_activity_at < $2
          AND suggested_assignee_id IS NULL;
        "#
    )
    .bind(&bucket_ids)
    .bind(threshold)
    .fetch_all(pool)
    .await?;

    if stagnant_tasks.is_empty() {
        tracing::info!("Clean: No stagnant tasks found.");
        return Ok(());
    }

    for task in stagnant_tasks {
        let task_id: i64 = task.try_get("id").unwrap_or(0);
        let task_title: String = task.try_get("title").unwrap_or_default();
        let project_id: Option<i64> = task.try_get("project_id").ok();
        let lead_assignee_id: Option<i64> = task.try_get("lead_assignee_id").ok();

        tracing::warn!("Stagnation detected on Task ID {}", task_id);

        let pid = match project_id {
            Some(pid) => pid,
            None => continue,
        };

        // 3. Nudge developer via Telegram if configured
        if let (Some(assignee_id), Some(bot_token)) = (lead_assignee_id, &config.telegram_bot_token) {
            let user = sqlx::query("SELECT telegram_chat_id FROM opentask.users WHERE id = $1 LIMIT 1;")
                .bind(assignee_id)
                .fetch_optional(pool)
                .await?;

            if let Some(u) = user {
                if let Ok(Some(chat_id)) = u.try_get::<Option<String>, _>("telegram_chat_id") {
                    let msg = format!(
                        "*STAGNATION RADAR ALERT*\n\n\
                         Task: *{task_title}*\n\
                         No activity detected in the last 48 hours.\n\n\
                         Please update the GitHub branch or the task will be proposed for reallocation."
                    );
                    let _ = send_telegram_message(bot_token, &chat_id, &msg).await;
                }
            }
        }

        // 4. Find candidate with minimum load
        let cand = sqlx::query(
            r#"
            SELECT user_id, current_load
            FROM opentask.project_member
            WHERE project_id = $1
              AND role IN ('PROGRAMMER', 'DESIGNER')
              AND ($2::BIGINT IS NULL OR user_id != $2)
            ORDER BY current_load ASC NULLS FIRST
            LIMIT 1;
            "#
        )
        .bind(pid)
        .bind(lead_assignee_id)
        .fetch_optional(pool)
        .await?;

        if let Some(cand_row) = cand {
            let cand_user_id: i64 = cand_row.try_get("user_id").unwrap_or(0);

            // Update task with suggested assignee
            let _ = sqlx::query(
                "UPDATE opentask.tasks SET suggested_assignee_id = $1, updated_at = NOW() WHERE id = $2;"
            )
            .bind(cand_user_id)
            .bind(task_id)
            .execute(pool)
            .await;

            // 5. Alert the project manager
            let pm = sqlx::query(
                "SELECT user_id FROM opentask.project_member WHERE project_id = $1 AND role = 'MANAGER' LIMIT 1;"
            )
            .bind(pid)
            .fetch_optional(pool)
            .await?;

            if let Some(manager) = pm {
                let pm_user_id: i64 = manager.try_get("user_id").unwrap_or(0);
                let alert_id = next_id();
                let title = format!("Task Reallocation Suggestion: {task_title}");
                let desc = format!("Task #{task_id} has had no activity for >48h. Suggested reallocation to user #{cand_user_id}.");

                let _ = sqlx::query(
                    r#"
                    INSERT INTO opentask.alerts (id, user_id, context_id, project_id, title, description, type, severity, is_resolved, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'STAGNATION', 'warning', FALSE, NOW());
                    "#
                )
                .bind(alert_id)
                .bind(pm_user_id)
                .bind(task_id)
                .bind(pid)
                .bind(title)
                .bind(desc)
                .execute(pool)
                .await;

                tracing::info!("Suggested reallocation for Task {task_id}. Alerted PM {pm_user_id}.");
            }
        }
    }

    Ok(())
}
