use std::time::Duration;
use base64ct::{Base64UrlUnpadded, Encoding as _};
use sqlx::{PgPool, Row};
use serde_json::json;
use web_push_native::{
    jwt_simple::algorithms::ES256KeyPair, p256::PublicKey, Auth, WebPushBuilder,
};

use crate::config::Config;
use crate::error::AppError;
use crate::services::id_generator::next_id;

pub fn decode_base64_url(s: &str) -> Result<Vec<u8>, AppError> {
    let trimmed = s.trim().trim_matches('"').trim_matches('\'').trim_end_matches('=');
    Base64UrlUnpadded::decode_vec(trimmed)
        .map_err(|e| AppError::Internal(format!("Base64Url decode failed: {e}")))
}

pub async fn send_single_web_push(
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    payload_json: &str,
    vapid_priv_key: &str,
    vapid_claim: &str,
) -> Result<bool, AppError> {
    let priv_bytes = decode_base64_url(vapid_priv_key)?;
    let key_pair = ES256KeyPair::from_bytes(&priv_bytes)
        .map_err(|e| AppError::Internal(format!("Invalid VAPID private key: {e}")))?;

    let p256dh_bytes = decode_base64_url(p256dh)?;
    let pub_key = PublicKey::from_sec1_bytes(&p256dh_bytes)
        .map_err(|e| AppError::Internal(format!("Invalid p256dh key: {e}")))?;

    let auth_bytes = decode_base64_url(auth)?;
    if auth_bytes.len() != 16 {
        return Err(AppError::Internal(format!("Invalid auth secret length: expected 16 bytes, got {}", auth_bytes.len())));
    }
    let mut auth_arr = [0u8; 16];
    auth_arr.copy_from_slice(&auth_bytes);
    let auth_struct = Auth::from(auth_arr);

    let endpoint_uri: axum::http::Uri = endpoint
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid push endpoint URI: {e}")))?;

    let builder = WebPushBuilder::new(endpoint_uri, pub_key, auth_struct)
        .with_valid_duration(Duration::from_secs(3600))
        .with_vapid(&key_pair, vapid_claim);

    let http_req = builder
        .build(payload_json)
        .map_err(|e| AppError::Internal(format!("Failed to build push message: {e}")))?;

    let (parts, body) = http_req.into_parts();
    let uri = parts.uri.to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut req = client.request(parts.method, &uri).body(body);
    for (name, val) in parts.headers.iter() {
        req = req.header(name.as_str(), val.as_bytes());
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("[NOTIFICATIONS] Push network request failed to {}: {}", uri, e);
            return Ok(false);
        }
    };

    let status = resp.status();
    if status.is_success() {
        let preview = &uri[..uri.len().min(40)];
        tracing::info!("[NOTIFICATIONS] Push sent successfully to {}...", preview);
        Ok(true)
    } else if status.as_u16() == 404 || status.as_u16() == 410 {
        let preview = &uri[..uri.len().min(40)];
        tracing::info!("[NOTIFICATIONS] Push endpoint expired ({}) for {}...", status.as_u16(), preview);
        Ok(false)
    } else {
        let err_text = resp.text().await.unwrap_or_default();
        tracing::warn!("[NOTIFICATIONS] Provider returned status {}: {}", status, err_text);
        Ok(false)
    }
}

pub async fn send_push_notification(
    pool: &PgPool,
    config: &Config,
    user_id: i64,
    title: &str,
    body: &str,
    url: &str,
    tag: &str,
) -> Result<(usize, usize), AppError> {
    let rows = sqlx::query(
        "SELECT id, endpoint, p256dh, auth FROM opentask.push_subscriptions WHERE user_id = $1;"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        tracing::info!("[NOTIFICATIONS] No active push subscriptions found for user {}", user_id);
        return Ok((0, 0));
    }

    let total = rows.len();
    let payload = json!({
        "title": title,
        "body": body,
        "url": url,
        "tag": tag,
        "icon": "/logo.svg"
    })
    .to_string();

    let mut delivered = 0;
    for row in rows {
        let sub_id: i64 = row.try_get("id")?;
        let endpoint: String = row.try_get("endpoint")?;
        let p256dh: String = row.try_get("p256dh")?;
        let auth: String = row.try_get("auth")?;

        match send_single_web_push(
            &endpoint,
            &p256dh,
            &auth,
            &payload,
            &config.vapid_private_key,
            &config.vapid_claim_email,
        )
        .await
        {
            Ok(true) => delivered += 1,
            Ok(false) => {
                let _ = sqlx::query("DELETE FROM opentask.push_subscriptions WHERE id = $1;")
                    .bind(sub_id)
                    .execute(pool)
                    .await;
            }
            Err(e) => {
                tracing::warn!("[NOTIFICATIONS] Push delivery error for subscription {}: {}", sub_id, e);
            }
        }
    }

    Ok((delivered, total))
}

pub async fn notify_task_assigned(
    pool: &PgPool,
    config: &Config,
    task_title: &str,
    assignee_id: i64,
    project_id: i64,
    project_name: Option<&str>,
    task_id: Option<i64>,
    assigned_by_name: Option<&str>,
) {
    let proj_text = match project_name {
        Some(name) => format!(" in {}", name),
        None => String::new(),
    };
    let by_text = match assigned_by_name {
        Some(by) => format!(" by {}", by),
        None => String::new(),
    };

    let alert_title = format!("Task Assigned: {}", task_title);
    let alert_body = format!("You were assigned to \"{}\"{}{}.", task_title, by_text, proj_text);
    let alert_id = next_id();
    let context_id = task_id.unwrap_or(project_id);

    let _ = sqlx::query(
        r#"
        INSERT INTO opentask.alerts (
            id, user_id, context_id, project_id, title, description,
            type, severity, suggested_actions, is_resolved, created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            'TASK_ASSIGNED', 'info', ARRAY['View Task', 'Go to Project'], FALSE, NOW(), NOW()
        );
        "#
    )
    .bind(alert_id)
    .bind(assignee_id)
    .bind(context_id)
    .bind(project_id)
    .bind(&alert_title)
    .bind(&alert_body)
    .execute(pool)
    .await;

    let title = "Task Assigned";
    let body = format!("You were assigned to \"{}\"{}{}.", task_title, by_text, proj_text);
    let url = match task_id {
        Some(tid) => format!("/projects/{}?taskId={}", project_id, tid),
        None => format!("/projects/{}", project_id),
    };
    let tag = format!("task-assigned-{}", task_id.unwrap_or(project_id));

    let _ = send_push_notification(pool, config, assignee_id, title, &body, &url, &tag).await;
}

pub async fn notify_task_unassigned(
    pool: &PgPool,
    config: &Config,
    task_title: &str,
    unassigned_user_id: i64,
    project_id: i64,
    project_name: Option<&str>,
    task_id: Option<i64>,
    unassigned_by_name: Option<&str>,
) {
    let proj_text = match project_name {
        Some(name) => format!(" in {}", name),
        None => String::new(),
    };
    let by_text = match unassigned_by_name {
        Some(by) => format!(" by {}", by),
        None => String::new(),
    };

    let alert_title = format!("Task Unassigned: {}", task_title);
    let alert_body = format!("You were unassigned from \"{}\"{}{}.", task_title, by_text, proj_text);
    let alert_id = next_id();
    let context_id = task_id.unwrap_or(project_id);

    let _ = sqlx::query(
        r#"
        INSERT INTO opentask.alerts (
            id, user_id, context_id, project_id, title, description,
            type, severity, suggested_actions, is_resolved, created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            'TASK_UNASSIGNED', 'info', ARRAY['View Task', 'Go to Project'], FALSE, NOW(), NOW()
        );
        "#
    )
    .bind(alert_id)
    .bind(unassigned_user_id)
    .bind(context_id)
    .bind(project_id)
    .bind(&alert_title)
    .bind(&alert_body)
    .execute(pool)
    .await;

    let title = "Task Unassigned";
    let body = format!("You were unassigned from \"{}\"{}{}.", task_title, by_text, proj_text);
    let url = match task_id {
        Some(tid) => format!("/projects/{}?taskId={}", project_id, tid),
        None => format!("/projects/{}", project_id),
    };
    let tag = format!("task-unassigned-{}", task_id.unwrap_or(project_id));

    let _ = send_push_notification(pool, config, unassigned_user_id, title, &body, &url, &tag).await;
}

pub async fn notify_task_completed(
    pool: &PgPool,
    config: &Config,
    task_title: &str,
    project_id: i64,
    actor_name: Option<&str>,
    task_id: Option<i64>,
    assignee_id: Option<i64>,
    extra_user_ids: Option<Vec<i64>>,
) {
    let mut targets = std::collections::HashSet::new();
    if let Some(uid) = assignee_id {
        targets.insert(uid);
    }
    if let Some(extras) = extra_user_ids {
        for uid in extras {
            targets.insert(uid);
        }
    }

    let by_text = match actor_name {
        Some(actor) => format!(" by {}", actor),
        None => String::new(),
    };
    let alert_title = format!("Task Completed: {}", task_title);
    let body = format!("\"{}\" has been marked as COMPLETED{}.", task_title, by_text);
    let url = match task_id {
        Some(tid) => format!("/projects/{}?taskId={}", project_id, tid),
        None => format!("/projects/{}", project_id),
    };
    let context_id = task_id.unwrap_or(project_id);
    let tag = format!("task-completed-{}", task_id.unwrap_or(project_id));

    for uid in targets {
        let alert_id = next_id();
        let _ = sqlx::query(
            r#"
            INSERT INTO opentask.alerts (
                id, user_id, context_id, project_id, title, description,
                type, severity, suggested_actions, is_resolved, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'TASK_COMPLETED', 'info', ARRAY['View Task', 'Go to Project'], FALSE, NOW(), NOW()
            );
            "#
        )
        .bind(alert_id)
        .bind(uid)
        .bind(context_id)
        .bind(project_id)
        .bind(&alert_title)
        .bind(&body)
        .execute(pool)
        .await;

        let _ = send_push_notification(pool, config, uid, "Task Completed", &body, &url, &tag).await;
    }
}

pub async fn notify_task_reopened(
    pool: &PgPool,
    config: &Config,
    task_title: &str,
    project_id: i64,
    actor_name: Option<&str>,
    task_id: Option<i64>,
    assignee_id: Option<i64>,
    extra_user_ids: Option<Vec<i64>>,
) {
    let mut targets = std::collections::HashSet::new();
    if let Some(uid) = assignee_id {
        targets.insert(uid);
    }
    if let Some(extras) = extra_user_ids {
        for uid in extras {
            targets.insert(uid);
        }
    }

    let by_text = match actor_name {
        Some(actor) => format!(" by {}", actor),
        None => String::new(),
    };
    let alert_title = format!("Task Reopened: {}", task_title);
    let body = format!("\"{}\" completed status was reverted{}.", task_title, by_text);
    let url = match task_id {
        Some(tid) => format!("/projects/{}?taskId={}", project_id, tid),
        None => format!("/projects/{}", project_id),
    };
    let context_id = task_id.unwrap_or(project_id);
    let tag = format!("task-reopened-{}", task_id.unwrap_or(project_id));

    for uid in targets {
        let alert_id = next_id();
        let _ = sqlx::query(
            r#"
            INSERT INTO opentask.alerts (
                id, user_id, context_id, project_id, title, description,
                type, severity, suggested_actions, is_resolved, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'TASK_REOPENED', 'info', ARRAY['View Task', 'Go to Project'], FALSE, NOW(), NOW()
            );
            "#
        )
        .bind(alert_id)
        .bind(uid)
        .bind(context_id)
        .bind(project_id)
        .bind(&alert_title)
        .bind(&body)
        .execute(pool)
        .await;

        let _ = send_push_notification(pool, config, uid, "Task Reopened", &body, &url, &tag).await;
    }
}

pub async fn notify_pr_reviewed(
    pool: &PgPool,
    config: &Config,
    task_title: &str,
    assignee_id: Option<i64>,
    verdict: &str,
    pr_url: &str,
    pr_number: u64,
    project_id: Option<i64>,
    extra_user_ids: Option<Vec<i64>>,
    task_id: Option<i64>,
) {
    let mut targets = std::collections::HashSet::new();
    if let Some(uid) = assignee_id {
        targets.insert(uid);
    }
    if let Some(extras) = extra_user_ids {
        for uid in extras {
            targets.insert(uid);
        }
    }

    let is_pass = verdict == "PASS";
    let verdict_label = if is_pass { "PASSED" } else { "FAILED" };
    let alert_title = format!("PR Review: {}", verdict_label);
    let body = format!("AI review for \"{}\" - PR #{} {}. Tap to view.", task_title, pr_number, verdict_label);
    let direct_url = match (project_id, task_id) {
        (Some(pid), Some(tid)) => format!("/projects/{}?taskId={}", pid, tid),
        _ => pr_url.to_string(),
    };
    let tag = format!("pr-review-{}", pr_number);

    for uid in targets {
        let alert_id = next_id();
        let _ = sqlx::query(
            r#"
            INSERT INTO opentask.alerts (
                id, user_id, context_id, project_id, title, description,
                type, severity, suggested_actions, is_resolved, pr_url, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                'PR_REVIEWED', $7, ARRAY['View Task', 'View PR on GitHub'], FALSE, $8, NOW(), NOW()
            );
            "#
        )
        .bind(alert_id)
        .bind(uid)
        .bind(task_id.or(project_id).unwrap_or(uid))
        .bind(project_id)
        .bind(&alert_title)
        .bind(&body)
        .bind(if is_pass { "info" } else { "warning" })
        .bind(pr_url)
        .execute(pool)
        .await;

        let _ = send_push_notification(pool, config, uid, &alert_title, &body, &direct_url, &tag).await;
    }
}
