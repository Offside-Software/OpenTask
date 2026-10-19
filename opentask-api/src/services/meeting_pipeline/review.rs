use chrono::NaiveDate;
use sqlx::PgPool;

use super::drafts::ensure_bucket;
use crate::error::AppError;
use crate::models::meeting::{
    ApproveDraftItem, DatabaseMeeting, DraftTaskView, JobStatus, MeetingJob, MeetingJobDetail, MeetingJobResponse,
    MeetingJobSummary, Segment, MEETING_COLUMNS, MEETING_JOB_COLUMNS,
};
use crate::models::safe_id::SafeId;

pub const MAX_REVIEW_ITEMS: usize = 100;

#[derive(Debug, sqlx::FromRow)]
struct JobSummaryRow {
    #[sqlx(flatten)]
    job: MeetingJob,
    meeting_title: Option<String>,
    meeting_created_at: Option<chrono::DateTime<chrono::Utc>>,
    pending_drafts: i64,
    total_drafts: i64,
}

/// The project a job belongs to. 
pub async fn job_project(pool: &PgPool, job_id: i64) -> Result<i64, AppError> {
    crate::db::query_scalar::<_, Option<i64>>(
        "SELECT m.project_id FROM opentask.meeting_jobs j JOIN opentask.meetings m ON m.id = j.meeting_id WHERE j.id = $1;",
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await?
    .flatten()
    .ok_or_else(|| AppError::NotFound(format!("Meeting job {job_id} not found")))
}

pub async fn list_jobs(pool: &PgPool, project_id: i64) -> Result<Vec<MeetingJobSummary>, sqlx::Error> {
    let columns = MEETING_JOB_COLUMNS
        .split(',')
        .map(|c| format!("j.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        r#"
        SELECT {columns}, m.title AS meeting_title, m.created_at AS meeting_created_at,
            (SELECT COUNT(*) FROM opentask.task_extraction_meta x
                JOIN opentask.tasks t ON t.id = x.task_id
                JOIN opentask.buckets b ON b.id = t.bucket_id
             WHERE x.job_id = j.id AND b.state = 'DRAFT') AS pending_drafts,
            (SELECT COUNT(*) FROM opentask.task_extraction_meta x WHERE x.job_id = j.id) AS total_drafts
        FROM opentask.meeting_jobs j
        JOIN opentask.meetings m ON m.id = j.meeting_id
        WHERE m.project_id = $1
        ORDER BY j.id DESC
        LIMIT 50;
        "#
    );
    let rows = crate::db::query_as::<_, JobSummaryRow>(&sql)
        .bind(project_id)
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| MeetingJobSummary {
            job: MeetingJobResponse::from(r.job),
            meeting_title: r.meeting_title,
            created_at: r.meeting_created_at,
            pending_drafts: r.pending_drafts,
            total_drafts: r.total_drafts,
        })
        .collect())
}

async fn fetch_job(pool: &PgPool, job_id: i64) -> Result<MeetingJob, AppError> {
    crate::db::query_as::<_, MeetingJob>(&format!(
        "SELECT {MEETING_JOB_COLUMNS} FROM opentask.meeting_jobs WHERE id = $1;"
    ))
    .bind(job_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Meeting job {job_id} not found")))
}

pub async fn job_detail(pool: &PgPool, job_id: i64) -> Result<MeetingJobDetail, AppError> {
    let job = fetch_job(pool, job_id).await?;
    let meeting = crate::db::query_as::<_, DatabaseMeeting>(&format!(
        "SELECT {MEETING_COLUMNS} FROM opentask.meetings WHERE id = $1;"
    ))
    .bind(job.meeting_id.0)
    .fetch_one(pool)
    .await?;
    let drafts = crate::db::query_as::<_, DraftTaskView>(
        r#"
        SELECT t.id AS task_id, t.bucket_id, b.state AS bucket_state, t.title, t.description, t.type AS task_type,
               t.weight, t.lead_assignee_id, COALESCE(t.assignee_ids, '{}'::BIGINT[]) AS assignee_ids,
               x.evidence_quote, x.evidence_verified, x.evidence_segment, x.evidence_start_sec, x.confidence,
               x.assignee_hint, x.resolved_user_id, x.due_text, x.due_date, x.original->>'priority' AS priority
        FROM opentask.task_extraction_meta x
        JOIN opentask.tasks t ON t.id = x.task_id
        LEFT JOIN opentask.buckets b ON b.id = t.bucket_id
        WHERE x.job_id = $1
        ORDER BY x.evidence_verified DESC, x.evidence_segment NULLS LAST, t.id;
        "#,
    )
    .bind(job_id)
    .fetch_all(pool)
    .await?;
    Ok(MeetingJobDetail { job: MeetingJobResponse::from(job), meeting, drafts })
}

pub async fn transcript(pool: &PgPool, job_id: i64) -> Result<(Option<String>, Vec<Segment>), AppError> {
    let row = crate::db::query_as::<_, (Option<String>, sqlx::types::Json<Vec<Segment>>)>(
        "SELECT language, segments FROM opentask.meeting_transcripts WHERE job_id = $1;",
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("This job has no transcript".to_string()))?;
    Ok((row.0, row.1 .0))
}

/// `Due date` and `Priority` lines appended to the description.
pub fn compose_description(
    description: Option<&str>,
    due_date: Option<NaiveDate>,
    due_text: Option<&str>,
    priority: Option<&str>,
) -> Option<String> {
    let mut lines = Vec::new();
    match (due_date, due_text.filter(|t| !t.trim().is_empty())) {
        (Some(date), Some(text)) => lines.push(format!("Due: {date} (\u{201c}{}\u{201d})", text.trim())),
        (Some(date), None) => lines.push(format!("Due: {date}")),
        (None, Some(text)) => lines.push(format!("Due: \u{201c}{}\u{201d}", text.trim())),
        (None, None) => {}
    }
    if let Some(p) = priority.map(str::trim).filter(|p| !p.is_empty()) {
        lines.push(format!("Priority: {p}"));
    }
    let base = description.map(str::trim).filter(|d| !d.is_empty());
    match (base, lines.is_empty()) {
        (None, true) => None,
        (Some(d), true) => Some(d.to_string()),
        (None, false) => Some(lines.join("\n")),
        (Some(d), false) => Some(format!("{d}\n\n{}", lines.join("\n"))),
    }
}

#[derive(Debug, sqlx::FromRow)]
struct DraftRow {
    title: String,
    description: Option<String>,
    task_type: Option<String>,
    weight: Option<i32>,
    bucket_state: Option<String>,
    due_date: Option<NaiveDate>,
    due_text: Option<String>,
    priority: Option<String>,
}

pub struct ReviewOutcome {
    pub job: MeetingJobResponse,
    pub meeting_id: i64,
    /// (task id, lead assignee, title)
    pub moved: Vec<(i64, Option<i64>, String)>,
    pub pending_drafts: i64,
    pub archived_bucket_id: Option<i64>,
}

async fn lock_reviewable_job(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, job_id: i64) -> Result<Option<i64>, AppError> {
    let row = crate::db::query_as::<_, (JobStatus, Option<i64>)>(
        "SELECT status, alert_id FROM opentask.meeting_jobs WHERE id = $1 FOR UPDATE;",
    )
    .bind(job_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Meeting job {job_id} not found")))?;
    if row.0 != JobStatus::DraftsReady {
        return Err(AppError::Conflict(format!("This job is {}, not waiting for review", row.0)));
    }
    Ok(row.1)
}

async fn lock_draft(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    job_id: i64,
    task_id: i64,
) -> Result<DraftRow, AppError> {
    let draft = crate::db::query_as::<_, DraftRow>(
        r#"
        SELECT t.title, t.description, t.type AS task_type, t.weight, b.state AS bucket_state,
               x.due_date, x.due_text, x.original->>'priority' AS priority
        FROM opentask.tasks t
        JOIN opentask.task_extraction_meta x ON x.task_id = t.id
        LEFT JOIN opentask.buckets b ON b.id = t.bucket_id
        WHERE t.id = $1 AND x.job_id = $2
        FOR UPDATE OF t;
        "#,
    )
    .bind(task_id)
    .bind(job_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Task {task_id} is not a draft of this job")))?;
    if draft.bucket_state.as_deref() != Some("DRAFT") {
        return Err(AppError::Conflict(format!("Task {task_id} was already reviewed")));
    }
    Ok(draft)
}

async fn next_order(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, bucket_id: i64) -> Result<i32, sqlx::Error> {
    crate::db::query_scalar("SELECT COALESCE(MAX(order_idx), -1) + 1 FROM opentask.tasks WHERE bucket_id = $1;")
        .bind(bucket_id)
        .fetch_one(&mut **tx)
        .await
}

/// Ends the review when no draft of the job is left in AI Drafts (job REVIEWED, alert resolved).
async fn finish_if_done(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    job_id: i64,
    alert_id: Option<i64>,
) -> Result<i64, sqlx::Error> {
    let pending: i64 = crate::db::query_scalar(
        r#"
        SELECT COUNT(*) FROM opentask.task_extraction_meta x
        JOIN opentask.tasks t ON t.id = x.task_id
        JOIN opentask.buckets b ON b.id = t.bucket_id
        WHERE x.job_id = $1 AND b.state = 'DRAFT';
        "#,
    )
    .bind(job_id)
    .fetch_one(&mut **tx)
    .await?;
    if pending == 0 {
        crate::db::query("UPDATE opentask.meeting_jobs SET status = 'REVIEWED' WHERE id = $1;")
            .bind(job_id)
            .execute(&mut **tx)
            .await?;
        if let Some(alert_id) = alert_id {
            crate::db::query("UPDATE opentask.alerts SET is_resolved = TRUE, updated_at = NOW() WHERE id = $1;")
                .bind(alert_id)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(pending)
}

fn parse_override_date(value: &str) -> Result<Option<NaiveDate>, AppError> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map(Some)
        .map_err(|_| AppError::BadRequest(format!("due_date {value} is not YYYY-MM-DD")))
}

pub async fn approve(
    pool: &PgPool,
    job_id: i64,
    project_id: i64,
    items: &[ApproveDraftItem],
) -> Result<ReviewOutcome, AppError> {
    if items.is_empty() || items.len() > MAX_REVIEW_ITEMS {
        return Err(AppError::BadRequest(format!("Send between 1 and {MAX_REVIEW_ITEMS} items")));
    }
    let mut tx = pool.begin().await?;
    let alert_id = lock_reviewable_job(&mut tx, job_id).await?;

    let default_bucket: Option<i64> = crate::db::query_scalar(
        "SELECT id FROM opentask.buckets WHERE project_id = $1 AND state = 'TODO' ORDER BY order_idx, id LIMIT 1;",
    )
    .bind(project_id)
    .fetch_optional(&mut *tx)
    .await?;
    let members: Vec<i64> =
        crate::db::query_scalar("SELECT user_id FROM opentask.project_member WHERE project_id = $1;")
            .bind(project_id)
            .fetch_all(&mut *tx)
            .await?;

    let mut moved = Vec::with_capacity(items.len());
    for item in items {
        let task_id = item.task_id.0;
        let draft = lock_draft(&mut tx, job_id, task_id).await?;

        let bucket_id = match item.bucket_id {
            Some(id) => {
                let state: Option<String> = crate::db::query_scalar(
                    "SELECT state FROM opentask.buckets WHERE id = $1 AND project_id = $2;",
                )
                .bind(id.0)
                .bind(project_id)
                .fetch_optional(&mut *tx)
                .await?;
                match state.as_deref() {
                    Some("TODO") | Some("PENDING") => id.0,
                    _ => return Err(AppError::BadRequest("Approved tasks go to a Todo or Pending column".to_string())),
                }
            }
            None => default_bucket
                .ok_or_else(|| AppError::BadRequest("The project has no Todo column; pick one".to_string()))?,
        };

        let assignees: Vec<i64> = item.assignee_ids.iter().map(|a| a.0).collect();
        if let Some(stranger) = assignees.iter().find(|a| !members.contains(a)) {
            return Err(AppError::BadRequest(format!("User {stranger} is not a member of this project")));
        }
        let due_date = match item.due_date.as_deref() {
            Some(value) => parse_override_date(value)?,
            None => draft.due_date,
        };
        let priority = match item.priority.as_deref() {
            Some(value) => Some(value.trim().to_ascii_lowercase()).filter(|p| !p.is_empty()),
            None => draft.priority.clone(),
        };
        let title = item
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .unwrap_or(&draft.title)
            .to_string();
        let description = compose_description(
            item.description.as_deref().or(draft.description.as_deref()),
            due_date,
            draft.due_text.as_deref(),
            priority.as_deref(),
        );
        let task_type = item
            .task_type
            .as_deref()
            .map(|t| t.trim().to_ascii_uppercase())
            .filter(|t| !t.is_empty())
            .or(draft.task_type)
            .unwrap_or_else(|| "OTHER".to_string());
        let weight = item.weight.or(draft.weight).map(|w| w.clamp(1, 8));
        let lead = assignees.first().copied();
        let order_idx = next_order(&mut tx, bucket_id).await?;

        crate::db::query(
            r#"
            UPDATE opentask.tasks
            SET bucket_id = $2, title = $3, description = $4, type = $5, weight = $6,
                lead_assignee_id = $7, assignee_ids = $8, order_idx = $9,
                updated_at = NOW(), last_activity_at = NOW()
            WHERE id = $1;
            "#,
        )
        .bind(task_id)
        .bind(bucket_id)
        .bind(&title)
        .bind(&description)
        .bind(&task_type)
        .bind(weight)
        .bind(lead)
        .bind(&assignees)
        .bind(order_idx)
        .execute(&mut *tx)
        .await?;
        moved.push((task_id, lead, title));
    }

    let pending_drafts = finish_if_done(&mut tx, job_id, alert_id).await?;
    tx.commit().await?;
    let job = fetch_job(pool, job_id).await?;
    Ok(ReviewOutcome {
        meeting_id: job.meeting_id.0,
        job: MeetingJobResponse::from(job),
        moved,
        pending_drafts,
        archived_bucket_id: None,
    })
}

pub async fn reject(pool: &PgPool, job_id: i64, project_id: i64, task_ids: &[SafeId]) -> Result<ReviewOutcome, AppError> {
    if task_ids.is_empty() || task_ids.len() > MAX_REVIEW_ITEMS {
        return Err(AppError::BadRequest(format!("Send between 1 and {MAX_REVIEW_ITEMS} task ids")));
    }
    let mut tx = pool.begin().await?;
    let alert_id = lock_reviewable_job(&mut tx, job_id).await?;
    let archived = ensure_bucket(&mut tx, project_id, "ARCHIVED", "Archived", false).await?;

    let mut moved = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        let draft = lock_draft(&mut tx, job_id, task_id.0).await?;
        let order_idx = next_order(&mut tx, archived).await?;
        crate::db::query(
            "UPDATE opentask.tasks SET bucket_id = $2, order_idx = $3, updated_at = NOW() WHERE id = $1;",
        )
        .bind(task_id.0)
        .bind(archived)
        .bind(order_idx)
        .execute(&mut *tx)
        .await?;
        moved.push((task_id.0, None, draft.title));
    }

    let pending_drafts = finish_if_done(&mut tx, job_id, alert_id).await?;
    tx.commit().await?;
    let job = fetch_job(pool, job_id).await?;
    Ok(ReviewOutcome {
        meeting_id: job.meeting_id.0,
        job: MeetingJobResponse::from(job),
        moved,
        pending_drafts,
        archived_bucket_id: Some(archived),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description_gets_due_and_priority_lines() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 24);
        assert_eq!(
            compose_description(Some("Send the report"), date, Some("Jumat"), Some("high")).as_deref(),
            Some("Send the report\n\nDue: 2026-10-24 (\u{201c}Jumat\u{201d})\nPriority: high")
        );
        assert_eq!(compose_description(None, date, None, None).as_deref(), Some("Due: 2026-10-24"));
        assert_eq!(
            compose_description(Some("x"), None, Some("next sprint"), None).as_deref(),
            Some("x\n\nDue: \u{201c}next sprint\u{201d}")
        );
        assert_eq!(compose_description(Some("  "), None, None, None), None);
    }
}
