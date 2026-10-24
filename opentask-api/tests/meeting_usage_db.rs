//! The usage limiter wired into the Groq client, against Postgres and a mock Groq.
//! Its own test binary: the limiter is process-wide. Needs TEST_DATABASE_URL like meeting_flow_db.

use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use opentask_api::services::id_generator::next_id;
use opentask_api::services::meeting_pipeline::config::{GroqTier, PipelineConfig};

use opentask_api::services::meeting_pipeline::llm::{ChatRequest, LlmClient, LlmError, ResponseFormat};
use opentask_api::services::meeting_pipeline::usage;

async fn chat(State(calls): State<Arc<AtomicU32>>, Json(_): Json<Value>) -> Json<Value> {
    calls.fetch_add(1, Ordering::SeqCst);
    Json(json!({
        "choices": [{ "message": { "role": "assistant", "content": "{}" } }],
        "usage": { "prompt_tokens": 100, "completion_tokens": 20 }
    }))
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

#[tokio::test]
async fn usage_is_recorded_and_limits_stop_calls_before_they_are_sent() {
    let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
        eprintln!("skipped: TEST_DATABASE_URL is not set");
        return;
    };
    let options = PgConnectOptions::from_str(&url).unwrap().statement_cache_capacity(0);
    assert!(matches!(options.get_host(), "localhost" | "127.0.0.1" | "::1"), "TEST_DATABASE_URL must be local");
    let pool = PgPoolOptions::new().max_connections(3).connect_with(options).await.unwrap();
    opentask_api::db::init_database(&pool).await.unwrap();

    let calls = Arc::new(AtomicU32::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new().route("/chat/completions", post(chat)).with_state(calls.clone());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

    // Models of their own, so earlier runs on the same day do not count.
    let run = next_id();
    let chat_model = leak(format!("usage-test-chat-{run}"));
    let audio_model = leak(format!("usage-test-audio-{run}"));
    let mut cfg = PipelineConfig::from_env();
    cfg.groq_tier = GroqTier::Free;
    cfg.extract_model = chat_model;
    cfg.gate_model = chat_model;
    cfg.gate_fallback_model = chat_model;
    cfg.summary_model = chat_model;
    cfg.extract_tpd = 1_000;
    cfg.asr_model = audio_model;
    cfg.asr_audio_sec_per_day = 100;

    // Usage from before a restart is picked up again.
    sqlx::query(
        "INSERT INTO opentask.ai_usage_daily (day, project_id, model, requests, audio_seconds) VALUES ((NOW() AT TIME ZONE 'UTC')::date, 0, $1, 1, 90);",
    )
    .bind(audio_model)
    .execute(&pool)
    .await
    .unwrap();
    usage::init(pool.clone(), &cfg).await;
    let limiter = usage::global().expect("limiter started");
    assert!(limiter.wait_for(None, audio_model, 0, 20).is_some(), "90 + 20 s is over today's 100 s");
    assert!(limiter.wait_for(None, audio_model, 0, 5).is_none());

    let project_id = next_id();
    let llm = LlmClient::new(&base, "test-key").for_project(project_id);
    let request = |max_completion_tokens| ChatRequest {
        model: chat_model,
        messages: vec![("user", "hello")],
        max_completion_tokens,
        format: ResponseFormat::JsonObject,
        reasoning_effort: None,
    };

    llm.chat(&request(100)).await.expect("fits the budget");
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // 120 tokens used; a call that may use 900 more is held back until tomorrow without being sent.
    let Err(LlmError::RateLimited { retry_after: Some(wait) }) = llm.chat(&request(900)).await else {
        panic!("the daily token budget should stop the call");
    };
    assert!(wait > Duration::from_secs(60), "waits for the next UTC day, not a minute");
    assert_eq!(calls.load(Ordering::SeqCst), 1, "the provider was not called");

    // The used tokens are booked to the project for today.
    let mut row = None;
    for _ in 0..20 {
        row = sqlx::query_as::<_, (i32, i64)>(
            "SELECT requests, tokens FROM opentask.ai_usage_daily WHERE day = (NOW() AT TIME ZONE 'UTC')::date AND project_id = $1 AND model = $2;",
        )
        .bind(project_id)
        .bind(chat_model)
        .fetch_optional(&pool)
        .await
        .unwrap();
        if row.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(row, Some((1, 120)));

    // The project's own free-tier key has a budget of its own, booked separately.
    let own = LlmClient::new(&base, "project-key").for_project(project_id).with_own_key(GroqTier::Free);
    own.chat(&request(800)).await.expect("the shared budget does not limit the project's own key");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let mut own_row = None;
    for _ in 0..20 {
        own_row = sqlx::query_scalar::<_, i64>(
            "SELECT tokens FROM opentask.ai_usage_daily WHERE day = (NOW() AT TIME ZONE 'UTC')::date AND project_id = $1 AND model = $2 AND own_key;",
        )
        .bind(project_id)
        .bind(chat_model)
        .fetch_optional(&pool)
        .await
        .unwrap();
        if own_row.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(own_row, Some(120));
    let shared_today = usage::usage_today(&pool, None).await.unwrap();
    assert_eq!(shared_today.iter().find(|u| u.model == chat_model).map(|u| u.tokens), Some(120), "own-key use is not shared use");

    sqlx::query("DELETE FROM opentask.ai_usage_daily WHERE model = ANY($1);")
        .bind(vec![chat_model, audio_model])
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}
