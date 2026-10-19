use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};

use super::extract::MomSummary;
use super::postprocess::DraftCandidate;
use crate::config::Config;
use crate::models::meeting::JobStatus;
use crate::services::id_generator::next_id;
use crate::services::realtime::RealtimeHub;

pub struct SavedDrafts {
    pub status: JobStatus,
    pub task_ids: Vec<i64>,
    pub draft_bucket_id: Option<i64>,
}

/// The project's AI Drafts bucket, created (locked, first column) when missing.
pub async fn ensure_bucket(
    tx: &mut Transaction<'_, Postgres>,
    project_id: i64,
    state: &str,
    name: &str,
    first: bool,
) -> Result<i64, sqlx::Error> {
    if let Some(id) = crate::db::query_scalar::<_, i64>(
        "SELECT id FROM opentask.buckets WHERE project_id = $1 AND state = $2 ORDER BY order_idx, id LIMIT 1;",
    )
    .bind(project_id)
    .bind(state)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(id);
    }

    let id = next_id();
    let order_sql = if first {
        "SELECT COALESCE(MIN(order_idx), 1) - 1 FROM opentask.buckets WHERE project_id = $1;"
    } else {
        "SELECT COALESCE(MAX(order_idx), -1) + 1 FROM opentask.buckets WHERE project_id = $1;"
    };
    let order_idx: i32 = crate::db::query_scalar(order_sql)
        .bind(project_id)
        .fetch_one(&mut **tx)
        .await?;
    crate::db::query(
        r#"
        INSERT INTO opentask.buckets (id, project_id, name, state, is_system_locked, order_idx, created_at, updated_at)
        VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW());
        "#,
    )
    .bind(id)
    .bind(project_id)
    .bind(name)
    .bind(state)
    .bind(order_idx)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}

/// Legacy `meetings.action_items` shape the meeting history card reads.
fn action_items(drafts: &[DraftCandidate]) -> Value {
    Value::Array(
        drafts
            .iter()
            .map(|d| {
                let initials: String = d
                    .assignee_hint
                    .as_deref()
                    .unwrap_or("?")
                    .split_whitespace()
                    .filter_map(|w| w.chars().next())
                    .take(2)
                    .collect::<String>()
                    .to_uppercase();
                json!({
                    "task": d.title,
                    "initials": initials,
                    "deadline": d.due_date.map(|d| d.to_string()).or_else(|| d.due_text.clone()).unwrap_or_else(|| "TBD".to_string()),
                })
            })
            .collect(),
    )
}

/// Replaces job's drafts, saves the summary on the meeting and ends the job as DRAFTS_READY.
pub async fn save_drafts(
    pool: &PgPool,
    job_id: i64,
    meeting_id: i64,
    project_id: i64,
    drafts: &[DraftCandidate],
    summary: Option<&MomSummary>,
) -> Result<Option<SavedDrafts>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let status = crate::db::query_scalar::<_, JobStatus>(
        "SELECT status FROM opentask.meeting_jobs WHERE id = $1 FOR UPDATE;",
    )
    .bind(job_id)
    .fetch_optional(&mut *tx)
    .await?;
    if status != Some(JobStatus::Extracting) {
        tx.rollback().await?;
        return Ok(None);
    }

    crate::db::query(
        "DELETE FROM opentask.tasks WHERE id IN (SELECT task_id FROM opentask.task_extraction_meta WHERE job_id = $1);",
    )
    .bind(job_id)
    .execute(&mut *tx)
    .await?;

    let mut task_ids = Vec::with_capacity(drafts.len());
    let mut draft_bucket_id = None;
    if !drafts.is_empty() {
        let bucket_id = ensure_bucket(&mut tx, project_id, "DRAFT", "AI Drafts", true).await?;
        draft_bucket_id = Some(bucket_id);
        let mut order_idx: i32 = crate::db::query_scalar(
            "SELECT COALESCE(MAX(order_idx), -1) + 1 FROM opentask.tasks WHERE bucket_id = $1;",
        )
        .bind(bucket_id)
        .fetch_one(&mut *tx)
        .await?;

        for draft in drafts {
            let task_id = next_id();
            crate::db::query(
                r#"
                INSERT INTO opentask.tasks
                    (id, project_id, bucket_id, meeting_id, title, description, type, weight, assignee_ids,
                     order_idx, last_activity_at, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}', $9, NOW(), NOW(), NOW());
                "#,
            )
            .bind(task_id)
            .bind(project_id)
            .bind(bucket_id)
            .bind(meeting_id)
            .bind(&draft.title)
            .bind(&draft.description)
            .bind(&draft.task_type)
            .bind(draft.weight.unwrap_or(3))
            .bind(order_idx)
            .execute(&mut *tx)
            .await?;

            crate::db::query(
                r#"
                INSERT INTO opentask.task_extraction_meta
                    (task_id, job_id, evidence_quote, evidence_verified, evidence_segment, evidence_start_sec,
                     confidence, assignee_hint, resolved_user_id, due_text, due_date, original, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW());
                "#,
            )
            .bind(task_id)
            .bind(job_id)
            .bind(&draft.evidence_quote)
            .bind(draft.evidence_verified)
            .bind(draft.evidence_segment)
            .bind(draft.evidence_start_sec)
            .bind(draft.confidence)
            .bind(&draft.assignee_hint)
            .bind(draft.resolved_user_id)
            .bind(&draft.due_text)
            .bind(draft.due_date)
            .bind(&draft.original)
            .execute(&mut *tx)
            .await?;

            task_ids.push(task_id);
            order_idx += 1;
        }
    }

    let status = if drafts.is_empty() { JobStatus::NoActions } else { JobStatus::DraftsReady };
    crate::db::query(
        r#"
        UPDATE opentask.meetings
        SET mom_summary = COALESCE($2, mom_summary),
            key_decisions = COALESCE($3, key_decisions),
            action_items = $4,
            status = $5,
            updated_at = NOW()
        WHERE id = $1;
        "#,
    )
    .bind(meeting_id)
    .bind(summary.map(|s| s.mom_summary.clone()))
    .bind(summary.map(|s| json!(s.key_decisions)))
    .bind(action_items(drafts))
    .bind(status.meeting_status())
    .execute(&mut *tx)
    .await?;
    crate::db::query(
        "UPDATE opentask.meeting_jobs SET status = $2, locked_until = NULL, next_attempt_at = NULL WHERE id = $1;",
    )
    .bind(job_id)
    .bind(status)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(SavedDrafts { status, task_ids, draft_bucket_id }))
}

/// After the drafts are committed, alert, web push, activity entry and realtime events.
pub async fn notify_drafts_ready(
    pool: &PgPool,
    config: &Config,
    realtime: &RealtimeHub,
    job_id: i64,
    meeting_id: i64,
    project_id: i64,
    saved: &SavedDrafts,
) {
    realtime.publish(project_id, "meeting_job", "updated", Some(job_id));
    if let Some(bucket_id) = saved.draft_bucket_id {
        realtime.publish(project_id, "bucket", "updated", Some(bucket_id));
    }
    if saved.status != JobStatus::DraftsReady {
        return;
    }

    let meeting = crate::db::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT title, created_by FROM opentask.meetings WHERE id = $1;",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let (title, created_by) = meeting.unwrap_or((None, None));
    let title = title.unwrap_or_else(|| "Meeting".to_string());
    let count = saved.task_ids.len();
    let noun = if count == 1 { "task" } else { "tasks" };

    let _ = crate::routes::activities::record_project_event(
        pool,
        project_id,
        None,
        Some("Meeting AI"),
        "extracted",
        &format!("{count} draft {noun} from {title}"),
        "MEETING_DRAFTS_READY",
        "MEETING",
        Some(meeting_id),
        Some(json!({ "job_id": job_id.to_string(), "draft_count": count })),
    )
    .await;

    let Some(user_id) = created_by.and_then(|c| c.parse::<i64>().ok()) else {
        return;
    };
    let alert_title = format!("Review {count} {noun} from {title}");
    let alert_body = format!(
        "The meeting AI drafted {count} {noun}. Approve or reject them in the project's MoM & Meetings tab."
    );
    let alert_id = next_id();
    let inserted = crate::db::query(
        r#"
        INSERT INTO opentask.alerts
            (id, user_id, context_id, project_id, title, description, type, severity, suggested_actions,
             is_resolved, created_at, updated_at)
        VALUES ($1, $2, NULL, $3, $4, $5, 'DRAFT_APPROVAL', 'info', ARRAY['Review Meeting Tasks'], FALSE, NOW(), NOW());
        "#,
    )
    .bind(alert_id)
    .bind(user_id)
    .bind(project_id)
    .bind(&alert_title)
    .bind(&alert_body)
    .execute(pool)
    .await;
    if let Err(e) = inserted {
        tracing::warn!("[Meeting Pipeline] Job {job_id}: could not create the review alert: {e}");
        return;
    }
    let _ = crate::db::query("UPDATE opentask.meeting_jobs SET alert_id = $2 WHERE id = $1;")
        .bind(job_id)
        .bind(alert_id)
        .execute(pool)
        .await;

    let url = format!("/projects/{project_id}?tab=meetings&meetingJob={job_id}");
    let tag = format!("meeting-job-{job_id}");
    if let Err(e) =
        crate::services::notifications::send_push_notification(pool, config, user_id, &alert_title, &alert_body, &url, &tag)
            .await
    {
        tracing::warn!("[Meeting Pipeline] Job {job_id}: push failed: {e}");
    }
}
