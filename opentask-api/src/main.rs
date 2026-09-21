pub mod config;
pub mod db;
pub mod error;
pub mod extractors;
pub mod models;
pub mod routes;
pub mod services;

use axum::Extension;
use std::net::SocketAddr;
use std::time::Duration;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::routes::auth::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "opentask_api=debug,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // 2. Load Configuration
    let config = Config::load();
    tracing::info!("Configuration loaded. Database target configured.");

    // 3. Initialize Database Connection Pool
    let pool = match db::create_pool(&config.database_url).await {
        Ok(p) => {
            tracing::info!("Connected to PostgreSQL database pool successfully.");
            p
        }
        Err(e) => {
            tracing::warn!("Could not connect to PostgreSQL on startup: {e}");
            tracing::info!("Falling back to offline/lazy pool initialization. Please check POSTGRESQL_DATABASE_URL.");
            let options = db::get_connect_options(&config.database_url)?;
            sqlx::postgres::PgPoolOptions::new()
                .connect_lazy_with(options)
        }
    };

    // 4. Background Stagnation Radar loop (replaces Celery & Celery Beat)
    let stagnation_pool = pool.clone();
    let stagnation_config = config.clone();
    tokio::spawn(async move {
        // Run once after 10 seconds startup delay, then hourly
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(e) = services::stagnation::run_stagnation_radar(&stagnation_pool, &stagnation_config).await {
                tracing::error!("Stagnation radar task error: {:?}", e);
            }
        }
    });

    // 5. Setup CORS
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::mirror_request())
        .allow_credentials(true)
        .allow_methods(tower_http::cors::AllowMethods::mirror_request())
        .allow_headers(tower_http::cors::AllowHeaders::mirror_request());

    // 6. Build Axum Router with HTTP Request/Response Logging
    let app_state = AppState {
        pool: pool.clone(),
        config: config.clone(),
    };

    let trace_layer = tower_http::trace::TraceLayer::new_for_http()
        .make_span_with(tower_http::trace::DefaultMakeSpan::new().level(tracing::Level::INFO))
        .on_request(tower_http::trace::DefaultOnRequest::new().level(tracing::Level::INFO))
        .on_response(tower_http::trace::DefaultOnResponse::new().level(tracing::Level::INFO))
        .on_failure(tower_http::trace::DefaultOnFailure::new().level(tracing::Level::ERROR));

    let app = routes::build_router(app_state)
        .layer(trace_layer)
        .layer(cors)
        .layer(Extension(pool));

    // 7. Bind and Serve
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("OpenTask Rust Tokio server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
