use opentask_api::models::safe_id::SafeId;
use opentask_api::routes::agent::parse_task_id;
use opentask_api::services::github::verify_webhook_signature;
use opentask_api::services::id_generator::{next_id, SnowflakeGenerator};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct TaskDto {
    pub id: SafeId,
    pub title: String,
}

#[test]
fn test_safe_id_json_string_serialization() {
    let id_val = 94695191667019776i64;
    let dto = TaskDto {
        id: SafeId(id_val),
        title: "Test Task".to_string(),
    };

    let serialized = serde_json::to_string(&dto).expect("Serialization failed");

    // Must be serialized as a string in JSON ("94695191667019776") to prevent JS BigInt precision loss
    assert!(
        serialized.contains(r#""id":"94695191667019776""#),
        "SafeId did not serialize as string! Got: {serialized}"
    );

    // Deserialization from JSON string
    let parsed: TaskDto = serde_json::from_str(&serialized).expect("Deserialization failed");
    assert_eq!(parsed.id.0, id_val);

    // Deserialization from raw JSON number should also work gracefully
    let numeric_json = r#"{"id": 94695191667019776, "title": "Test Task"}"#;
    let from_num: TaskDto = serde_json::from_str(numeric_json).expect("Deserialization from num failed");
    assert_eq!(from_num.id.0, id_val);
}

#[test]
fn test_snowflake_id_uniqueness() {
    let mut generator = SnowflakeGenerator::new(1);
    let mut ids = std::collections::HashSet::new();

    for _ in 0..10_000 {
        let id = generator.generate();
        assert!(id > 0, "Snowflake ID must be a positive integer");
        assert!(ids.insert(id), "Duplicate Snowflake ID generated: {id}");
    }

    let global_id = next_id();
    assert!(global_id > 0);
}

#[test]
fn test_parse_task_id_formats() {
    let raw_id = 94695191667019776i64;

    // 1. Raw string
    assert_eq!(parse_task_id("94695191667019776").unwrap(), raw_id);

    // 2. Hash prefixed
    assert_eq!(parse_task_id("#94695191667019776").unwrap(), raw_id);

    // 3. Markdown link from UI copy
    assert_eq!(
        parse_task_id("[Refactor Auth](#94695191667019776)").unwrap(),
        raw_id
    );

    // 4. URL query param
    assert_eq!(
        parse_task_id("http://localhost:5173/board?taskId=94695191667019776").unwrap(),
        raw_id
    );

    // 5. Invalid string should fail cleanly
    assert!(parse_task_id("invalid-task-id").is_err());
}

#[test]
fn test_webhook_signature_verification() {
    let secret = "test_webhook_secret_key";
    let payload = b"{\"action\":\"opened\",\"number\":42}";

    // Compute expected signature
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(payload);
    let hex_sig = hex::encode(mac.finalize().into_bytes());

    let header_val = format!("sha256={hex_sig}");
    assert!(verify_webhook_signature(secret, payload, Some(&header_val)));

    // Tampered payload should fail
    assert!(!verify_webhook_signature(secret, b"tampered", Some(&header_val)));

    // Invalid secret should fail
    assert!(!verify_webhook_signature("wrong_secret", payload, Some(&header_val)));
}

#[tokio::test]
async fn test_router_construction() {
    use opentask_api::config::Config;
    use opentask_api::routes::auth::AppState;
    use opentask_api::routes::build_router;
    use sqlx::postgres::PgPoolOptions;

    let pool = PgPoolOptions::new().connect_lazy("postgres://dummy:dummy@localhost:5432/dummy").unwrap();
    let config = Config::load();
    let state = AppState { pool, config };
    let _app = build_router(state);
}

#[test]
fn test_timeline_data_serialization() {
    use opentask_api::models::history::{TimelineActivity, TimelineBucket, TimelineData};

    let activity = TimelineActivity {
        id: "123456789".to_string(),
        user_name: "dev-lead".to_string(),
        action: "pushed".to_string(),
        target: "feat/auth-v2".to_string(),
        created_at: "2026-09-20T12:00:00Z".to_string(),
        avatar_url: Some("https://github.com/dev-lead.png?size=64".to_string()),
    };

    let bucket = TimelineBucket {
        timestamp: "2026-09-20T00:00:00Z".to_string(),
        label: "Sep 20".to_string(),
        count: 1,
        activities: vec![activity],
    };

    let data = TimelineData {
        interval: "7d".to_string(),
        range_start: "2026-09-14T00:00:00Z".to_string(),
        range_end: "2026-09-21T00:00:00Z".to_string(),
        total_activities: 1,
        peak_count: 1,
        buckets: vec![bucket],
    };

    let json_str = serde_json::to_string(&data).expect("Serialization failed");
    assert!(json_str.contains(r#""interval":"7d""#));
    assert!(json_str.contains(r#""total_activities":1"#));
    assert!(json_str.contains(r#""peak_count":1"#));
    assert!(json_str.contains(r#""buckets":[{"#));
    assert!(json_str.contains(r#""label":"Sep 20""#));
    assert!(json_str.contains(r#""avatar_url":"https://github.com/dev-lead.png?size=64""#));
}
