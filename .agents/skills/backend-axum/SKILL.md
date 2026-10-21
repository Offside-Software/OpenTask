---
name: backend-axum
description: >-
  Use this skill when developing, testing, building, or modifying backend code in opentask-api.
  Enforces Cargo commands, Axum 0.8 patterns, SQLx pooler rules, and SafeId Snowflake handling.
---

# OpenTask Backend Development Skill (Axum & Rust 2024)

This skill provides mandatory guidelines, architectural patterns, and procedures for working with the OpenTask backend in `opentask-api`.

---

## 1. Toolchain Execution Procedures

Always use **Cargo** for all backend workflows. The backend is written in **Rust (2024 edition)** with **Axum 0.8** and **Tokio**.

> [!IMPORTANT]
> The Python FastAPI backend (`legacy-api/`) is deprecated. Never execute Python, `uv`, or `pip` for OpenTask backend development. Always operate within `opentask-api/`.

### Check Compilation (Fast)
```bash
cd opentask-api
cargo check
```

### Build Binary
```bash
cd opentask-api
cargo build
```

### Run API Server Locally
```bash
cd opentask-api
cargo run
```
*Listens on `http://0.0.0.0:8000` (or `PORT` configured in `.env`).*

### Run Tests
```bash
cd opentask-api
cargo test
```

---

## 2. Axum 0.8 Architecture & Routing Standards

### 2.1 Route Path Parameter Syntax
Axum 0.8 uses curly braces for path parameters (`{param_name}`), **not** the older `:param_name` colon syntax:
```rust
// CORRECT (Axum 0.8)
Router::new()
    .route("/tasks/{task_id}", get(get_task).put(update_task).delete(delete_task))
    .route("/projects/{project_id}/buckets/{bucket_id}/tasks", get(get_bucket_tasks));

// INCORRECT (will fail or misroute in Axum 0.8)
Router::new().route("/tasks/:task_id", get(get_task));
```

### 2.2 AppState & Extractors
All routes share `AppState` defined in `crate::routes::auth::AppState`:
```rust
#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub config: Config,
    pub realtime: RealtimeHub,
}
```

Standard handler signature:
```rust
pub async fn get_task(
    State(state): State<AppState>,
    Path(task_id): Path<SafeId>,
) -> Result<Json<DatabaseTask>, AppError> {
    let task = db::query_as::<_, DatabaseTask>(
        "SELECT * FROM opentask.tasks WHERE id = $1"
    )
    .bind(task_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".to_string()))?;

    Ok(Json(task))
}
```

### 2.3 Error Handling with `AppError`
Always return `Result<T, AppError>`. Never return raw 500 strings or unhandled unwraps in request paths:
- Variants in `src/error.rs`:
  - `AppError::BadRequest(String)` -> `400 Bad Request`
  - `AppError::Unauthorized(String)` -> `401 Unauthorized`
  - `AppError::Forbidden(String)` -> `403 Forbidden`
  - `AppError::NotFound(String)` -> `404 Not Found`
  - `AppError::Conflict(String)` -> `409 Conflict`
  - `AppError::Internal(String)` -> `500 Internal Server Error`
- Automatic conversions implemented:
  - `sqlx::Error::RowNotFound` maps to `AppError::NotFound`
  - Other `sqlx::Error` maps to `AppError::Internal`
  - `anyhow::Error` and `reqwest::Error` map to `AppError::Internal`

---

## 3. Snowflake SafeId (BigInt Handling)

All entity IDs (tasks, projects, buckets, alerts, meetings, users, feedbacks) are 64-bit Twitter Snowflake BigInts.

### 3.1 Strict Serialization Rule
JavaScript numbers lose precision above `Number.MAX_SAFE_INTEGER` ($2^{53}-1 \approx 9.007 \times 10^{15}$). Snowflake IDs exceed this limit.
- **Rule**: `SafeId` in `src/models/safe_id.rs` wraps `i64` and **always serializes to JSON as a string** (e.g. `"94695191667019776"`).
- `SafeId` implements `Deserialize` from both numeric strings and raw integers for backward compatibility.
- In database queries, `SafeId` transparently binds to PostgreSQL `BIGINT`.

### 3.2 Generating Snowflake IDs
Generate unique Snowflake IDs using `crate::services::id_generator::next_id()`:
```rust
use crate::models::safe_id::SafeId;
use crate::services::id_generator::next_id;

let new_id: SafeId = next_id().into();
```

---

## 4. Database & SQLx Connection Pooling (PgBouncer Compatibility)

OpenTask uses Supabase / PgBouncer / Supavisor connection poolers in transaction pooling mode.

### 4.1 Non-Persistent Query Requirement
Transaction poolers reuse connections across transactions. Prepared statements named by SQLx will collide across connections (`prepared statement "sqlx_s_..." already exists`).

**Mandatory Rule**:
Always use the helper functions from `crate::db` instead of raw `sqlx::query*`:
```rust
use crate::db::{query, query_as, query_scalar};

// 1. For record fetching
let task = query_as::<_, DatabaseTask>("SELECT * FROM opentask.tasks WHERE id = $1")
    .bind(task_id)
    .fetch_optional(&state.pool)
    .await?;

// 2. For execution
query("UPDATE opentask.tasks SET title = $1 WHERE id = $2")
    .bind(&payload.title)
    .bind(task_id)
    .execute(&state.pool)
    .await?;

// 3. For scalar counts / values
let count: i64 = query_scalar("SELECT COUNT(*) FROM opentask.tasks WHERE project_id = $1")
    .bind(project_id)
    .fetch_one(&state.pool)
    .await?;
```
*These helpers automatically set `.persistent(false)` on every statement to guarantee PgBouncer safety.*

### 4.2 Pool Capacity
The pool in `src/db/mod.rs` is tuned with `max_connections(3)` and `statement_cache_capacity(0)` to prevent hitting pooler session exhaustion limits (`EMAXCONNSESSION`).

---

## 5. Background Async Workers (Tokio Tasks)

OpenTask uses Tokio's native async runtime instead of external Celery workers:
- **Stagnation Radar**: Periodic task identifying stagnant projects and generating alerts.
- **Telegram Worker**: Long-polling bot worker and alert notification dispatcher.
- **Realtime Hub**: WebSocket event broadcaster for task updates and live reviews.
- **Meeting Pipeline**: Asynchronous meeting-to-task audio/transcript processing worker.

When adding background jobs, spawn them inside `src/main.rs` via `tokio::spawn(async move { ... })` and pass clones of `pool` and `config`.

---

## 6. Verification Workflow

Before completing any backend task:
1. Run `cargo check` inside `opentask-api` and confirm 0 errors.
2. Run `cargo test` inside `opentask-api` to ensure no regression in models or business logic.
3. Verify all entity IDs returned in JSON schemas use `SafeId` or are serialized as strings.
