pub mod activities;
pub mod agent;
pub mod ai_keys;
pub mod alerts;
pub mod auth;
pub mod buckets;
pub mod github;
pub mod meetings;
pub mod notifications;
pub mod pr_reviews;
pub mod projects;
pub mod tasks;
pub mod telegram;
pub mod users;

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use crate::routes::auth::AppState;

pub fn build_router(state: AppState) -> Router {
    let api_routes = Router::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(projects::router())
        .merge(buckets::router())
        .merge(tasks::router())
        .merge(alerts::router())
        .merge(activities::router())
        .merge(ai_keys::router())
        .merge(github::router())
        .merge(meetings::router())
        .merge(telegram::router())
        .merge(notifications::router())
        .merge(pr_reviews::router())
        .nest("/agent", agent::router());

    // Support both direct routes (e.g. /tasks, /auth) and prefixed routes (e.g. /api/tasks, /api/auth)
    // to guarantee 100% parity with FastAPI's StripApiPrefixMiddleware
    Router::new()
        .route("/", get(root_handler))
        .route("/health", get(health_handler))
        .merge(api_routes.clone())
        .nest("/api", api_routes)
        .with_state(state)
}

async fn root_handler() -> Json<Value> {
    Json(json!({ "Message": "OpenTask Rust Tokio API is running!" }))
}

async fn health_handler() -> Json<Value> {
    Json(json!({ "status": "healthy", "service": "opentask-api" }))
}
