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

#[test]
fn test_reorder_payload_deserialization() {
    use opentask_api::models::task::TaskReorderPayload;
    use opentask_api::models::bucket::BucketReorderPayload;

    // 1. Raw array of task ID strings (as sent by frontend JSONBig.stringify(taskIds))
    let raw_task_ids = r#"["93970560257626112", "93970560257626113"]"#;
    let parsed_tasks: TaskReorderPayload = serde_json::from_str(raw_task_ids).expect("Failed to deserialize task list");
    match parsed_tasks {
        TaskReorderPayload::List(ids) => {
            assert_eq!(ids.len(), 2);
            assert_eq!(ids[0].0, 93970560257626112i64);
            assert_eq!(ids[1].0, 93970560257626113i64);
        }
        _ => panic!("Expected TaskReorderPayload::List"),
    }

    // 2. Object format with tasks array
    let obj_tasks = r#"{"tasks": [{"id": "93970560257626112", "order_idx": 0}]}"#;
    let parsed_obj: TaskReorderPayload = serde_json::from_str(obj_tasks).expect("Failed to deserialize task obj");
    match parsed_obj {
        TaskReorderPayload::Object { tasks } => {
            assert_eq!(tasks.len(), 1);
            assert_eq!(tasks[0].id.0, 93970560257626112i64);
            assert_eq!(tasks[0].order_idx, 0);
        }
        _ => panic!("Expected TaskReorderPayload::Object"),
    }

    // 3. Raw array of bucket ID strings
    let raw_bucket_ids = r#"["1001", "1002"]"#;
    let parsed_buckets: BucketReorderPayload = serde_json::from_str(raw_bucket_ids).expect("Failed to deserialize bucket list");
    match parsed_buckets {
        BucketReorderPayload::List(ids) => {
            assert_eq!(ids.len(), 2);
            assert_eq!(ids[0].0, 1001);
            assert_eq!(ids[1].0, 1002);
        }
        _ => panic!("Expected BucketReorderPayload::List"),
    }
}

#[test]
fn test_vapid_key_and_message_building() {
    use base64ct::{Base64UrlUnpadded, Encoding as _};
    use web_push_native::{
        jwt_simple::algorithms::ES256KeyPair, p256::PublicKey, Auth, WebPushBuilder,
    };

    let vapid_private_raw = "u9WEYzZFke7f46Kkv5q98geTM08rAYQP8evwPxBp6G4";
    let priv_bytes = Base64UrlUnpadded::decode_vec(vapid_private_raw.trim_end_matches('='))
        .expect("Failed to decode VAPID private key");
    assert_eq!(priv_bytes.len(), 32);

    let key_pair = ES256KeyPair::from_bytes(&priv_bytes)
        .expect("Failed to create ES256KeyPair from private bytes");

    let p256dh_raw = "BLn9b-VR0ca83knDNZ32dCHGyjJp-1riX9ZTN40MqV8K_LpQmLqxC_DoHvqvFXO_nGdAB4W9dogZb_sM-uV4JbY";
    let p256dh_bytes = Base64UrlUnpadded::decode_vec(p256dh_raw.trim_end_matches('='))
        .expect("Failed to decode p256dh");
    let pub_key = PublicKey::from_sec1_bytes(&p256dh_bytes)
        .expect("Failed to parse PublicKey from SEC1");

    let auth_raw = "_ordMnz7uTCmrpBTeUV4Bw";
    let auth_bytes = Base64UrlUnpadded::decode_vec(auth_raw.trim_end_matches('='))
        .expect("Failed to decode auth");
    let mut auth_arr = [0u8; 16];
    auth_arr.copy_from_slice(&auth_bytes);
    let auth = Auth::from(auth_arr);

    let endpoint: axum::http::Uri = "https://fcm.googleapis.com/fcm/send/fake-endpoint".parse().unwrap();

    let builder = WebPushBuilder::new(endpoint, pub_key, auth)
        .with_vapid(&key_pair, "mailto:evangelionxyz10@gmail.com");

    let http_req = builder.build(r#"{"title":"Test","body":"Hello World"}"#)
        .expect("Failed to build HTTP push request");

    assert_eq!(http_req.method(), axum::http::Method::POST);
    assert!(http_req.headers().contains_key("authorization"));
    assert!(http_req.headers().contains_key("content-encoding"));
}

#[test]
fn test_task_update_payload_deserialization() {
    use opentask_api::models::task::TaskUpdatePayload;

    // 1. Missing lead_assignee_id field -> None (do not update)
    let json_missing = r#"{"title": "Updated title"}"#;
    let payload_missing: TaskUpdatePayload = serde_json::from_str(json_missing).unwrap();
    assert_eq!(payload_missing.lead_assignee_id, None);
    assert_eq!(payload_missing.suggested_assignee_id, None);

    // 2. Explicit null -> Some(None) (unassign / set to NULL)
    let json_null = r#"{"lead_assignee_id": null, "suggested_assignee_id": null}"#;
    let payload_null: TaskUpdatePayload = serde_json::from_str(json_null).unwrap();
    assert_eq!(payload_null.lead_assignee_id, Some(None));
    assert_eq!(payload_null.suggested_assignee_id, Some(None));

    // 3. Explicit empty string -> Some(None) (unassign / set to NULL)
    let json_empty = r#"{"lead_assignee_id": "", "suggested_assignee_id": "   "}"#;
    let payload_empty: TaskUpdatePayload = serde_json::from_str(json_empty).unwrap();
    assert_eq!(payload_empty.lead_assignee_id, Some(None));
    assert_eq!(payload_empty.suggested_assignee_id, Some(None));

    // 4. String ID -> Some(Some(SafeId))
    let json_str_id = r#"{"lead_assignee_id": "94695191667019776"}"#;
    let payload_str_id: TaskUpdatePayload = serde_json::from_str(json_str_id).unwrap();
    assert_eq!(
        payload_str_id.lead_assignee_id,
        Some(Some(SafeId(94695191667019776)))
    );

    // 5. Numeric ID -> Some(Some(SafeId))
    let json_num_id = r#"{"lead_assignee_id": 94695191667019776}"#;
    let payload_num_id: TaskUpdatePayload = serde_json::from_str(json_num_id).unwrap();
    assert_eq!(
        payload_num_id.lead_assignee_id,
        Some(Some(SafeId(94695191667019776)))
    );
}
