//! Meeting pipeline database tests (task breakdown 1.1, 1.4, 1.5).
//!
//! Needs a disposable Postgres that already has the base schema, for example:
//!   docker compose up -d postgres
//!   TEST_DATABASE_URL=postgres://opentask:opentask@localhost:5433/opentask cargo test --test meeting_pipeline_db
//! Skipped when TEST_DATABASE_URL is unset. Refuses any host other than localhost, because it
//! deletes every meeting job it finds.
//!
//! One test runs the scenarios in order on a single connection, so it also works against
//! single-connection servers such as PGlite.

use std::str::FromStr;

use opentask_api::error::AppError;
use opentask_api::models::meeting::{DatabaseMeeting, JobStatus, MeetingStatus, SourceType, MEETING_COLUMNS};
use opentask_api::models::user::GitHubUserResponse;
use opentask_api::routes::meetings::{delete_meeting_and_drafts, require_project_member};
use opentask_api::services::id_generator::next_id;
use opentask_api::services::meeting_pipeline::jobs::{claim_next_job, release_until, renew_lease, set_status};
use opentask_api::services::realtime::RealtimeHub;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;

const LEASE_MINUTES: i32 = 10;

async fn test_pool() -> Option<PgPool> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;
    let options = PgConnectOptions::from_str(&url)
        .expect("TEST_DATABASE_URL is not a valid Postgres URL")
        .statement_cache_capacity(0);
    assert!(
        matches!(options.get_host(), "localhost" | "127.0.0.1" | "::1"),
        "TEST_DATABASE_URL must point at a local, disposable database"
    );
    Some(
        PgPoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("could not connect to TEST_DATABASE_URL"),
    )
}

fn github_user(id: i64, login: &str) -> GitHubUserResponse {
    GitHubUserResponse {
        id,
        login: login.to_string(),
        name: None,
        email: None,
        avatar_url: None,
        html_url: None,
        public_repos: None,
        followers: None,
    }
}

struct Fixture {
    user_id: i64,
    gh_id: i64,
    login: String,
    project_id: i64,
    draft_bucket: i64,
    todo_bucket: i64,
}

async fn seed(pool: &PgPool) -> Fixture {
    let user_id = next_id();
    let gh_id = user_id % 1_000_000_000;
    let login = format!("tester{user_id}");
    let project_id = next_id();
    let draft_bucket = next_id();
    let todo_bucket = next_id();

    sqlx::query("INSERT INTO opentask.users (id, gh_id, gh_username, display_name) VALUES ($1, $2, $3, 'Tester');")
        .bind(user_id)
        .bind(gh_id.to_string())
        .bind(&login)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO opentask.projects (id, name) VALUES ($1, 'Pipeline test');")
        .bind(project_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO opentask.project_member (id, project_id, user_id, role) VALUES ($1, $2, $3, 'MANAGER');",
    )
    .bind(next_id())
    .bind(project_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO opentask.buckets (id, project_id, name, state, is_system_locked, order_idx) VALUES
            ($1, $3, 'AI Drafts', 'DRAFT', TRUE, 0),
            ($2, $3, 'Todo', 'TODO', FALSE, 1);
        "#,
    )
    .bind(draft_bucket)
    .bind(todo_bucket)
    .bind(project_id)
    .execute(pool)
    .await
    .unwrap();

    Fixture { user_id, gh_id, login, project_id, draft_bucket, todo_bucket }
}

async fn insert_meeting(pool: &PgPool, project_id: i64, created_by: i64) -> i64 {
    let id = next_id();
    sqlx::query(
        r#"
        INSERT INTO opentask.meetings (id, project_id, created_by, title, source_type, status)
        VALUES ($1, $2, $3, 'Weekly sync', 'RECALL_BOT', 'PROCESSING');
        "#,
    )
    .bind(id)
    .bind(project_id)
    .bind(created_by.to_string())
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_job(pool: &PgPool, meeting_id: i64, status: JobStatus) -> i64 {
    let id = next_id();
    sqlx::query(
        r#"
        INSERT INTO opentask.meeting_jobs (id, meeting_id, source_type, status, meeting_date)
        VALUES ($1, $2, $3, $4, NOW());
        "#,
    )
    .bind(id)
    .bind(meeting_id)
    .bind(SourceType::RecallBot)
    .bind(status)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_task(pool: &PgPool, f: &Fixture, bucket_id: i64, meeting_id: Option<i64>, job_id: Option<i64>) -> i64 {
    let id = next_id();
    sqlx::query("INSERT INTO opentask.tasks (id, project_id, bucket_id, meeting_id, title) VALUES ($1, $2, $3, $4, 'task');")
        .bind(id)
        .bind(f.project_id)
        .bind(bucket_id)
        .bind(meeting_id)
        .execute(pool)
        .await
        .unwrap();
    if let Some(job_id) = job_id {
        sqlx::query(
            r#"
            INSERT INTO opentask.task_extraction_meta (task_id, job_id, evidence_quote, confidence, original)
            VALUES ($1, $2, 'Budi akan kirim laporan Jumat', 'high', '{}'::jsonb);
            "#,
        )
        .bind(id)
        .bind(job_id)
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

async fn count(pool: &PgPool, sql: &str, id: i64) -> i64 {
    sqlx::query_scalar::<_, i64>(sql).bind(id).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn meeting_pipeline_against_postgres() {
    let Some(pool) = test_pool().await else {
        eprintln!("skipped: set TEST_DATABASE_URL to a local Postgres with the base schema");
        return;
    };

    schema_applies_and_is_idempotent(&pool).await;
    let f = seed(&pool).await;
    membership_is_checked(&pool, &f).await;
    rows_decode_into_models(&pool, &f).await;
    claim_lease_and_transitions(&pool, &f).await;
    delete_rules(&pool, &f).await;

    pool.close().await;
}

async fn schema_applies_and_is_idempotent(pool: &PgPool) {
    opentask_api::db::init_database(pool).await.unwrap();
    opentask_api::db::init_database(pool).await.unwrap();

    for table in ["meeting_jobs", "meeting_transcripts", "task_extraction_meta"] {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'opentask' AND table_name = $1);",
        )
        .bind(table)
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(exists, "{table} was not created");
    }
    let meeting_columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'opentask' AND table_name = 'meetings';",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    for column in ["created_by", "status", "recall_bot_id", "updated_at"] {
        assert!(meeting_columns.iter().any(|c| c == column), "meetings.{column} missing");
    }
    assert!(!meeting_columns.iter().any(|c| c == "user_uuid"), "user_uuid not renamed");
    let fk: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'opentask.tasks'::regclass AND conname = 'tasks_meeting_id_fkey');",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(fk, "tasks.meeting_id foreign key missing");
}

async fn membership_is_checked(pool: &PgPool, f: &Fixture) {
    let member = github_user(f.gh_id, &f.login);
    assert_eq!(require_project_member(pool, &member, f.project_id).await.unwrap(), f.user_id);

    let by_login_only = github_user(-1, &f.login);
    assert_eq!(require_project_member(pool, &by_login_only, f.project_id).await.unwrap(), f.user_id);

    let stranger = github_user(-2, "someone-else");
    assert!(matches!(
        require_project_member(pool, &stranger, f.project_id).await,
        Err(AppError::Forbidden(_))
    ));
    assert!(matches!(
        require_project_member(pool, &member, next_id()).await,
        Err(AppError::Forbidden(_))
    ));
}

async fn rows_decode_into_models(pool: &PgPool, f: &Fixture) {
    let meeting_id = insert_meeting(pool, f.project_id, f.user_id).await;
    let sql = format!("SELECT {MEETING_COLUMNS} FROM opentask.meetings WHERE id = $1;");
    let meeting: DatabaseMeeting = sqlx::query_as(&sql).bind(meeting_id).fetch_one(pool).await.unwrap();
    assert_eq!(meeting.source_type, Some(SourceType::RecallBot));
    assert_eq!(meeting.status, MeetingStatus::Processing);
    assert_eq!(meeting.created_by.as_deref(), Some(f.user_id.to_string().as_str()));

    let json = serde_json::to_value(&meeting).unwrap();
    assert_eq!(json["id"], meeting_id.to_string());
    assert_eq!(json["project_id"], f.project_id.to_string());

    // A manual meeting created without a status gets the column default.
    let manual_id = next_id();
    sqlx::query("INSERT INTO opentask.meetings (id, project_id, source_type) VALUES ($1, $2, 'MANUAL');")
        .bind(manual_id)
        .bind(f.project_id)
        .execute(pool)
        .await
        .unwrap();
    let manual: DatabaseMeeting = sqlx::query_as(&sql).bind(manual_id).fetch_one(pool).await.unwrap();
    assert_eq!(manual.status, MeetingStatus::Completed);
}

async fn claim_lease_and_transitions(pool: &PgPool, f: &Fixture) {
    sqlx::query("DELETE FROM opentask.meeting_jobs;").execute(pool).await.unwrap();
    let realtime = RealtimeHub::new();
    let mut events = realtime.subscribe();

    let meeting_id = insert_meeting(pool, f.project_id, f.user_id).await;
    let job_id = insert_job(pool, meeting_id, JobStatus::Queued).await;
    let meeting_status = |id| async move {
        sqlx::query_scalar::<_, MeetingStatus>("SELECT status FROM opentask.meetings WHERE id = $1;")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    };

    let claimed = claim_next_job(pool, LEASE_MINUTES).await.unwrap().expect("queued job not claimed");
    assert_eq!(claimed.job.id.0, job_id);
    assert_eq!(claimed.job.attempts, 1);
    assert_eq!(claimed.project_id.map(|p| p.0), Some(f.project_id));
    assert!(claimed.job.locked_until.is_some());
    assert!(claim_next_job(pool, LEASE_MINUTES).await.unwrap().is_none(), "a leased job was claimed twice");

    assert!(set_status(pool, &realtime, &claimed, JobStatus::Extracting, None).await.unwrap());
    assert_eq!(meeting_status(meeting_id).await, MeetingStatus::Processing);
    let event = events.try_recv().expect("no realtime event");
    assert_eq!((event.entity.as_str(), event.action.as_str()), ("meeting_job", "updated"));
    assert_eq!(event.entity_id, Some(job_id.to_string()));
    assert_eq!(event.project_id, f.project_id.to_string());
    assert!(renew_lease(pool, job_id, LEASE_MINUTES).await.unwrap());

    // A lease that ran out (crashed worker) is claimed again, as the next attempt.
    sqlx::query("UPDATE opentask.meeting_jobs SET locked_until = NOW() - INTERVAL '1 minute' WHERE id = $1;")
        .bind(job_id)
        .execute(pool)
        .await
        .unwrap();
    let reclaimed = claim_next_job(pool, LEASE_MINUTES).await.unwrap().expect("expired lease not reclaimed");
    assert_eq!((reclaimed.job.status, reclaimed.job.attempts), (JobStatus::Extracting, 2));

    // Rate limits defer without using up an attempt.
    let later = chrono::Utc::now() + chrono::Duration::minutes(5);
    release_until(pool, job_id, later, "429 from provider", false).await.unwrap();
    assert!(claim_next_job(pool, LEASE_MINUTES).await.unwrap().is_none(), "deferred job claimed early");
    sqlx::query("UPDATE opentask.meeting_jobs SET next_attempt_at = NOW() - INTERVAL '1 second' WHERE id = $1;")
        .bind(job_id)
        .execute(pool)
        .await
        .unwrap();
    let resumed = claim_next_job(pool, LEASE_MINUTES).await.unwrap().expect("deferred job not resumed");
    assert_eq!(resumed.job.attempts, 2);

    // Finishing releases the lease and completes the meeting; nothing is left to claim.
    assert!(set_status(pool, &realtime, &resumed, JobStatus::DraftsReady, None).await.unwrap());
    assert_eq!(meeting_status(meeting_id).await, MeetingStatus::Completed);
    let locked: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT locked_until FROM opentask.meeting_jobs WHERE id = $1;")
            .bind(job_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(locked.is_none());
    assert!(claim_next_job(pool, LEASE_MINUTES).await.unwrap().is_none());

    // FAILED mirrors to the meeting and keeps the error for operators.
    assert!(set_status(pool, &realtime, &resumed, JobStatus::Failed, Some("step not implemented")).await.unwrap());
    assert_eq!(meeting_status(meeting_id).await, MeetingStatus::Failed);

    // A job whose meeting was deleted reports false instead of erroring.
    sqlx::query("DELETE FROM opentask.meetings WHERE id = $1;").bind(meeting_id).execute(pool).await.unwrap();
    assert!(!set_status(pool, &realtime, &resumed, JobStatus::Extracting, None).await.unwrap());
    assert!(!renew_lease(pool, job_id, LEASE_MINUTES).await.unwrap());
}

async fn delete_rules(pool: &PgPool, f: &Fixture) {
    // Refused while a job is running.
    let running_meeting = insert_meeting(pool, f.project_id, f.user_id).await;
    let running_job = insert_job(pool, running_meeting, JobStatus::Extracting).await;
    assert!(matches!(
        delete_meeting_and_drafts(pool, running_meeting).await,
        Err(AppError::Conflict(_))
    ));

    // Refused while a job is leased, even if its status says QUEUED.
    sqlx::query("UPDATE opentask.meeting_jobs SET status = 'QUEUED', locked_until = NOW() + INTERVAL '5 minutes' WHERE id = $1;")
        .bind(running_job)
        .execute(pool)
        .await
        .unwrap();
    assert!(matches!(
        delete_meeting_and_drafts(pool, running_meeting).await,
        Err(AppError::Conflict(_))
    ));

    // Allowed once the job is done: drafts go, reviewed tasks stay without a meeting.
    sqlx::query("UPDATE opentask.meeting_jobs SET status = 'DRAFTS_READY', locked_until = NULL WHERE id = $1;")
        .bind(running_job)
        .execute(pool)
        .await
        .unwrap();
    let draft = insert_task(pool, f, f.draft_bucket, Some(running_meeting), Some(running_job)).await;
    let approved = insert_task(pool, f, f.todo_bucket, Some(running_meeting), Some(running_job)).await;
    let unrelated_draft = insert_task(pool, f, f.draft_bucket, None, None).await;

    let deleted = delete_meeting_and_drafts(pool, running_meeting).await.unwrap();
    assert_eq!(deleted, vec![draft]);

    assert_eq!(count(pool, "SELECT COUNT(*) FROM opentask.tasks WHERE id = $1;", draft).await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM opentask.tasks WHERE id = $1 AND meeting_id IS NULL;", approved).await, 1);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM opentask.tasks WHERE id = $1;", unrelated_draft).await, 1);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM opentask.meetings WHERE id = $1;", running_meeting).await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM opentask.meeting_jobs WHERE id = $1;", running_job).await, 0);
    assert_eq!(count(pool, "SELECT COUNT(*) FROM opentask.task_extraction_meta WHERE job_id = $1;", running_job).await, 0);

    assert!(matches!(
        delete_meeting_and_drafts(pool, running_meeting).await,
        Err(AppError::NotFound(_))
    ));
}
