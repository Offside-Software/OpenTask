use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use sqlx::{PgPool, Row};

use crate::error::AppError;
use crate::models::history::{
    DatabaseActivity, DatabaseProjectHistory, ProjectHistoryResponse, TimelineActivity,
    TimelineBucket, TimelineData,
};
use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct TimelineQuery {
    pub interval: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/activities", post(create_activity))
        .route(
            "/projects/{project_id}/activities",
            get(list_project_activities),
        )
        .route(
            "/projects/{project_id}/activities/timeline",
            get(get_project_activities_timeline),
        )
        .route("/projects/{project_id}/history", get(list_project_history))
}

pub async fn record_project_event(
    pool: &PgPool,
    project_id: i64,
    user_id: Option<i64>,
    user_name: Option<&str>,
    action: &str,
    target: &str,
    event_type: &str,
    entity_type: &str,
    entity_id: Option<i64>,
    metadata: Option<serde_json::Value>,
) -> Result<(), sqlx::Error> {
    let clean_user_name = user_name.unwrap_or("Team Member");
    let description = format!("{clean_user_name} {action} {target}").trim().to_string();
    let hist_id = next_id();
    let act_id = next_id();
    let meta_val = metadata.unwrap_or_else(|| serde_json::json!({}));

    let _ = sqlx::query(
        r#"
        INSERT INTO opentask.project_history
            (id, project_id, user_id, user_name, event_type, entity_type, entity_id, description, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW());
        "#
    )
    .bind(hist_id)
    .bind(project_id)
    .bind(user_id)
    .bind(clean_user_name)
    .bind(event_type)
    .bind(entity_type)
    .bind(entity_id)
    .bind(&description)
    .bind(meta_val)
    .execute(pool)
    .await;

    let _ = sqlx::query(
        r#"
        INSERT INTO opentask.activities
            (id, project_id, user_name, action, target, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW());
        "#
    )
    .bind(act_id)
    .bind(project_id)
    .bind(clean_user_name)
    .bind(action)
    .bind(target)
    .execute(pool)
    .await;

    Ok(())
}

pub async fn create_activity(
    State(state): State<AppState>,
    Json(payload): Json<DatabaseActivity>,
) -> Result<Json<DatabaseActivity>, AppError> {
    let act_id = next_id();
    let un = payload.user_name.as_deref().unwrap_or("System");
    let avatar_url = if !un.is_empty() && !un.starts_with("User #") {
        Some(format!("https://github.com/{un}.png?size=64"))
    } else {
        None
    };

    let mut row = sqlx::query_as::<_, DatabaseActivity>(
        r#"
        INSERT INTO opentask.activities (id, project_id, user_name, action, target, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, project_id, user_name, action, target, created_at, NULL::TEXT as avatar_url;
        "#
    )
    .bind(act_id)
    .bind(payload.project_id.0)
    .bind(payload.user_name.as_deref())
    .bind(&payload.action)
    .bind(payload.target.as_deref())
    .fetch_one(&state.pool)
    .await?;

    row.avatar_url = avatar_url;

    let _ = record_project_event(
        &state.pool,
        payload.project_id.0,
        None,
        payload.user_name.as_deref(),
        &payload.action,
        payload.target.as_deref().unwrap_or(""),
        "ACTIVITY_LOGGED",
        "ACTIVITY",
        row.id.as_ref().map(|id| id.0),
        None,
    )
    .await;

    Ok(Json(row))
}

pub async fn list_project_activities(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
) -> Result<Json<Vec<DatabaseActivity>>, AppError> {
    let mut rows = sqlx::query_as::<_, DatabaseActivity>(
        r#"
        SELECT id, project_id, user_name, action, target, created_at, NULL::TEXT as avatar_url
        FROM opentask.activities
        WHERE project_id = $1
        ORDER BY created_at DESC
        LIMIT 50;
        "#
    )
    .bind(project_id.0)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    for r in &mut rows {
        if let Some(ref un) = r.user_name {
            if !un.is_empty() && !un.starts_with("User #") {
                r.avatar_url = Some(format!("https://github.com/{un}.png?size=64"));
            }
        }
    }

    Ok(Json(rows))
}

pub async fn list_project_history(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<ProjectHistoryResponse>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let items = sqlx::query_as::<_, DatabaseProjectHistory>(
        r#"
        SELECT id, project_id, user_id, user_name,
               event_type, entity_type, entity_id, description, metadata, created_at
        FROM opentask.project_history
        WHERE project_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3;
        "#
    )
    .bind(project_id.0)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let total_row = sqlx::query("SELECT COUNT(*) as count FROM opentask.project_history WHERE project_id = $1;")
        .bind(project_id.0)
        .fetch_one(&state.pool)
        .await
        .ok();

    let total: i64 = total_row
        .and_then(|r| r.try_get::<i64, _>("count").ok())
        .unwrap_or(items.len() as i64);

    Ok(Json(ProjectHistoryResponse {
        total,
        limit,
        offset,
        items,
    }))
}

pub async fn get_project_activities_timeline(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    Query(query): Query<TimelineQuery>,
) -> Result<Json<TimelineData>, AppError> {
    let now = Utc::now();
    let clean_interval = query.interval.as_deref().unwrap_or("7d").to_lowercase();

    let (time_span, num_buckets, bucket_delta, date_format) = match clean_interval.as_str() {
        "1d" => (Duration::days(1), 24, Duration::hours(1), "%H:00"),
        "3d" => (Duration::days(3), 12, Duration::hours(6), "%b %d %H:00"),
        "7d" => (Duration::days(7), 7, Duration::days(1), "%b %d"),
        "1m" | "30d" => (Duration::days(30), 30, Duration::days(1), "%b %d"),
        "3m" | "90d" => (Duration::days(90), 13, Duration::days(7), "%b %d"),
        "6m" | "180d" => (Duration::days(180), 12, Duration::days(15), "%b %d"),
        "12m" | "1y" | "365d" | "356d" => (Duration::days(365), 12, Duration::days(30), "%b %Y"),
        "5y" | "5yr" => (Duration::days(365 * 5), 20, Duration::days(91), "%b %Y"),
        _ => (Duration::days(7), 7, Duration::days(1), "%b %d"),
    };

    let default_start = now - time_span;

    let parse_iso = |s: &str| -> Option<DateTime<Utc>> {
        let trimmed = s.trim();
        if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
            return Some(dt.with_timezone(&Utc));
        }
        let with_z = format!("{trimmed}Z");
        if let Ok(dt) = DateTime::parse_from_rfc3339(&with_z) {
            return Some(dt.with_timezone(&Utc));
        }
        None
    };

    let range_start = query.start_date
        .as_deref()
        .and_then(parse_iso)
        .unwrap_or(default_start);

    let range_end = query.end_date
        .as_deref()
        .and_then(parse_iso)
        .unwrap_or(now);

    // Internal bucket structure
    struct BucketSlot {
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        label: String,
        count: i64,
        activities: Vec<TimelineActivity>,
    }

    let mut buckets: Vec<BucketSlot> = Vec::with_capacity(num_buckets);
    let mut curr_time = range_start;

    for i in 0..num_buckets {
        let mut next_time = curr_time + bucket_delta;
        if i == num_buckets - 1 && next_time < range_end {
            next_time = range_end;
        }

        let label = curr_time.format(date_format).to_string();
        buckets.push(BucketSlot {
            start: curr_time,
            end: next_time,
            label,
            count: 0,
            activities: Vec::new(),
        });
        curr_time = next_time;
    }

    // 1. Fetch from opentask.activities
    let mut raw_acts = sqlx::query_as::<_, DatabaseActivity>(
        r#"
        SELECT id, project_id, user_name, action, target, created_at, NULL::TEXT as avatar_url
        FROM opentask.activities
        WHERE project_id = $1 AND created_at >= $2 AND created_at <= $3
        ORDER BY created_at ASC;
        "#
    )
    .bind(project_id.0)
    .bind(range_start)
    .bind(range_end)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // 2. Fallback: if opentask.activities is empty, query opentask.project_history
    if raw_acts.is_empty() {
        let hist_rows = sqlx::query_as::<_, DatabaseProjectHistory>(
            r#"
            SELECT id, project_id, user_id, user_name, event_type, entity_type, entity_id, description, metadata, created_at
            FROM opentask.project_history
            WHERE project_id = $1 AND created_at >= $2 AND created_at <= $3
            ORDER BY created_at ASC;
            "#
        )
        .bind(project_id.0)
        .bind(range_start)
        .bind(range_end)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();

        for h in hist_rows {
            raw_acts.push(DatabaseActivity {
                id: h.id,
                project_id: h.project_id,
                user_name: h.user_name,
                action: h.event_type.to_lowercase().replace("task_", ""),
                target: Some(h.description),
                created_at: h.created_at,
                avatar_url: None,
            });
        }
    }

    // 3. Distribute activities into buckets
    for act in raw_acts {
        let act_time = act.created_at.unwrap_or(now);
        let user_name = act.user_name.filter(|u| !u.trim().is_empty()).unwrap_or_else(|| "System".to_string());
        let avatar_url = if !user_name.is_empty() && !user_name.starts_with("User #") {
            Some(format!("https://github.com/{user_name}.png?size=64"))
        } else {
            None
        };

        let formatted = TimelineActivity {
            id: act.id.map(|s| s.0.to_string()).unwrap_or_else(|| "0".to_string()),
            user_name,
            action: act.action,
            target: act.target.unwrap_or_default(),
            created_at: act_time.to_rfc3339(),
            avatar_url,
        };

        let mut placed = false;
        for b in &mut buckets {
            if b.start <= act_time && act_time < b.end {
                b.count += 1;
                b.activities.push(formatted.clone());
                placed = true;
                break;
            }
        }

        if !placed && !buckets.is_empty() {
            if let Some(last) = buckets.last_mut() {
                last.count += 1;
                last.activities.push(formatted);
            }
        }
    }

    let result_buckets: Vec<TimelineBucket> = buckets
        .into_iter()
        .map(|b| TimelineBucket {
            timestamp: b.start.to_rfc3339(),
            label: b.label,
            count: b.count,
            activities: b.activities,
        })
        .collect();

    let total_activities: i64 = result_buckets.iter().map(|b| b.count).sum();
    let peak_count: i64 = result_buckets.iter().map(|b| b.count).max().unwrap_or(0);

    Ok(Json(TimelineData {
        interval: clean_interval,
        range_start: range_start.to_rfc3339(),
        range_end: range_end.to_rfc3339(),
        total_activities,
        peak_count,
        buckets: result_buckets,
    }))
}
