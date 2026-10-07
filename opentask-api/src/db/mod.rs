use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::str::FromStr;
use std::time::Duration;

pub fn get_connect_options(database_url: &str) -> Result<PgConnectOptions, sqlx::Error> {
    let options = PgConnectOptions::from_str(database_url)?
        .statement_cache_capacity(0); // Essential for Supabase / PgBouncer / Supavisor poolers

    Ok(options)
}

/// Helper to construct queries with `.persistent(false)` for PgBouncer / Supavisor compatibility.
/// Prevents named prepared statement collisions (`sqlx_s_... already exists`) in transaction pooling mode.
pub fn query<'q>(
    sql: &'q str,
) -> sqlx::query::Query<'q, sqlx::Postgres, <sqlx::Postgres as sqlx::Database>::Arguments<'q>> {
    sqlx::query(sql).persistent(false)
}

/// Helper to construct query_as with `.persistent(false)` for PgBouncer / Supavisor compatibility.
pub fn query_as<'q, DB, O>(
    sql: &'q str,
) -> sqlx::query::QueryAs<'q, DB, O, <DB as sqlx::Database>::Arguments<'q>>
where
    DB: sqlx::Database + sqlx::database::HasStatementCache,
    O: for<'r> sqlx::FromRow<'r, DB::Row>,
{
    sqlx::query_as(sql).persistent(false)
}

/// Helper to construct query_scalar with `.persistent(false)` for PgBouncer / Supavisor compatibility.
pub fn query_scalar<'q, DB, O>(
    sql: &'q str,
) -> sqlx::query::QueryScalar<'q, DB, O, <DB as sqlx::Database>::Arguments<'q>>
where
    DB: sqlx::Database + sqlx::database::HasStatementCache,
    (O,): for<'r> sqlx::FromRow<'r, DB::Row>,
{
    sqlx::query_scalar(sql).persistent(false)
}

pub fn get_pool_options() -> PgPoolOptions {
    PgPoolOptions::new()
        // Supabase Session Pooler has a global per-project session limit (15
        // by default). The API runs as a single long-lived container, so a
        // small pool is enough and stays well under that limit.
        .max_connections(8)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(60))
        .max_lifetime(Duration::from_secs(10 * 60))
}

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let options = get_connect_options(database_url)?;

    let pool = get_pool_options()
        .connect_with(options)
        .await?;

    init_database(&pool).await?;

    Ok(pool)
}

pub async fn init_database(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Ensure opentask schema
    let _ = sqlx::raw_sql("CREATE SCHEMA IF NOT EXISTS opentask;")
        .execute(pool)
        .await;

    // Ensure bucket description column
    let _ = sqlx::raw_sql("ALTER TABLE opentask.buckets ADD COLUMN IF NOT EXISTS description TEXT;")
        .execute(pool)
        .await;

    // Ensure project history table
    let _ = sqlx::raw_sql(
        r#"
        CREATE TABLE IF NOT EXISTS opentask.project_history (
            id BIGINT PRIMARY KEY,
            project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
            user_id BIGINT,
            user_name TEXT,
            event_type TEXT NOT NULL,
            entity_type TEXT NOT NULL DEFAULT 'TASK',
            entity_id BIGINT,
            description TEXT NOT NULL,
            metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE opentask.project_history DROP CONSTRAINT IF EXISTS project_history_user_id_fkey;
        CREATE INDEX IF NOT EXISTS idx_project_history_project_id ON opentask.project_history(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_history_created_at ON opentask.project_history(created_at);
        CREATE INDEX IF NOT EXISTS idx_project_history_proj_created ON opentask.project_history(project_id, created_at DESC);
        "#,
    )
    .execute(pool)
    .await;

    // Ensure push subscriptions table
    let _ = sqlx::raw_sql(
        r#"
        CREATE TABLE IF NOT EXISTS opentask.push_subscriptions (
            id BIGINT PRIMARY KEY,
            user_id BIGINT,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE opentask.push_subscriptions ALTER COLUMN user_id DROP NOT NULL;
        ALTER TABLE opentask.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey;
        CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON opentask.push_subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS opentask.alerts (
            id BIGINT PRIMARY KEY,
            user_id BIGINT,
            context_id BIGINT,
            project_id BIGINT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            suggested_actions TEXT[] DEFAULT '{}',
            is_resolved BOOLEAN DEFAULT FALSE,
            pr_url TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON opentask.alerts(user_id);
        "#,
    )
    .execute(pool)
    .await;

    // Ensure github installations table
    let _ = sqlx::raw_sql(
        r#"
        CREATE TABLE IF NOT EXISTS opentask.github_installations (
            id BIGINT PRIMARY KEY,
            installation_id BIGINT NOT NULL,
            account_login TEXT NOT NULL,
            account_type TEXT NOT NULL,
            project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(installation_id, project_id)
        );
        "#,
    )
    .execute(pool)
    .await;

    let _ = sqlx::raw_sql("DEALLOCATE ALL;").execute(pool).await;

    tracing::info!("Database schema and tables initialized successfully.");
    Ok(())
}
