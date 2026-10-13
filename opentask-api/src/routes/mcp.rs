use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::post,
    Json, Router,
};
use futures_util::stream;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::convert::Infallible;
use std::time::Duration;

use crate::models::safe_id::SafeId;
use crate::routes::auth::AppState;
use crate::services::id_generator::next_id;

#[derive(Debug, Deserialize)]
pub struct McpQuery {
    pub key: Option<String>,
    pub token: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mcp", post(handle_mcp).get(handle_mcp_sse))
        .route("/mcp/sse", post(handle_mcp).get(handle_mcp_sse))
        .route(
            "/projects/{project_id}/mcp",
            post(handle_project_mcp).get(handle_project_mcp_sse),
        )
        .route(
            "/projects/{project_id}/mcp/sse",
            post(handle_project_mcp).get(handle_project_mcp_sse),
        )
}

async fn authenticate_project_key(
    state: &AppState,
    explicit_project_id: Option<i64>,
    headers: &HeaderMap,
    query: &McpQuery,
) -> Result<(i64, String), (StatusCode, Json<Value>)> {
    // 1. Extract raw token
    let mut raw_key = headers
        .get("x-project-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string());

    if raw_key.is_none() {
        if let Some(auth) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
            if let Some(bearer) = auth.strip_prefix("Bearer ") {
                raw_key = Some(bearer.trim().to_string());
            }
        }
    }

    if raw_key.is_none() {
        raw_key = query
            .key
            .as_ref()
            .or(query.token.as_ref())
            .or(query.api_key.as_ref())
            .map(|s| s.trim().to_string());
    }

    let token = match raw_key.filter(|k| !k.is_empty()) {
        Some(k) => k,
        None => {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "jsonrpc": "2.0",
                    "error": {
                        "code": -32000,
                        "message": "Authentication required. Provide project API key via 'Authorization: Bearer <KEY>', 'X-Project-Key: <KEY>', or '?key=<KEY>'"
                    }
                })),
            ));
        }
    };

    // 2. Validate against opentask.projects
    let rows = if let Some(pid) = explicit_project_id {
        crate::db::query("SELECT id, name, api_key FROM opentask.projects WHERE id = $1 AND api_key IS NOT NULL;")
            .bind(pid)
            .fetch_all(&state.pool)
            .await
    } else {
        crate::db::query("SELECT id, name, api_key FROM opentask.projects WHERE api_key IS NOT NULL;")
            .fetch_all(&state.pool)
            .await
    };

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "jsonrpc": "2.0",
                    "error": { "code": -32603, "message": format!("Database error: {e}") }
                })),
            ));
        }
    };

    for r in rows {
        let stored_key: Option<String> = r.try_get("api_key").ok().flatten();
        if let Some(stored) = stored_key {
            let is_valid = if stored.starts_with("$argon2") {
                crate::services::hasher::verify_hash(&token, &stored)
            } else {
                stored == token
            };

            if is_valid {
                let id: i64 = r.try_get("id").unwrap_or(0);
                let name: String = r.try_get("name").unwrap_or_default();
                return Ok((id, name));
            }
        }
    }

    Err((
        StatusCode::FORBIDDEN,
        Json(json!({
            "jsonrpc": "2.0",
            "error": { "code": -32000, "message": "Invalid project API key." }
        })),
    ))
}

fn parse_task_id(identifier: &str) -> Result<i64, String> {
    let cleaned = identifier.trim();
    if let Ok(id) = cleaned.parse::<i64>() {
        return Ok(id);
    }
    let hash_re = Regex::new(r"#(\d+)").unwrap();
    if let Some(caps) = hash_re.captures(cleaned) {
        if let Ok(id) = caps[1].parse::<i64>() {
            return Ok(id);
        }
    }
    let param_re = Regex::new(r"taskId=(\d+)").unwrap();
    if let Some(caps) = param_re.captures(cleaned) {
        if let Ok(id) = caps[1].parse::<i64>() {
            return Ok(id);
        }
    }
    let digit_re = Regex::new(r"\b(\d{15,20})\b").unwrap();
    if let Some(caps) = digit_re.captures(cleaned) {
        if let Ok(id) = caps[1].parse::<i64>() {
            return Ok(id);
        }
    }
    Err(format!("Could not parse Snowflake Task ID from '{identifier}'"))
}

pub async fn handle_project_mcp(
    State(state): State<AppState>,
    Path(project_id): Path<SafeId>,
    headers: HeaderMap,
    Query(query): Query<McpQuery>,
    Json(rpc): Json<Value>,
) -> Response {
    let (pid, pname) = match authenticate_project_key(&state, Some(project_id.0), &headers, &query).await {
        Ok(res) => res,
        Err((code, err)) => return (code, err).into_response(),
    };

    process_rpc_payload(&state, pid, &pname, rpc).await.into_response()
}

pub async fn handle_mcp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<McpQuery>,
    Json(rpc): Json<Value>,
) -> Response {
    let (pid, pname) = match authenticate_project_key(&state, None, &headers, &query).await {
        Ok(res) => res,
        Err((code, err)) => return (code, err).into_response(),
    };

    process_rpc_payload(&state, pid, &pname, rpc).await.into_response()
}

pub async fn handle_project_mcp_sse(
    Path(project_id): Path<SafeId>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let endpoint_url = format!("/api/projects/{}/mcp", project_id);
    let initial_event = Event::default().event("endpoint").data(endpoint_url);

    let stream = stream::once(async move { Ok(initial_event) });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

pub async fn handle_mcp_sse() -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let initial_event = Event::default().event("endpoint").data("/api/mcp");
    let stream = stream::once(async move { Ok(initial_event) });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn process_rpc_payload(state: &AppState, project_id: i64, project_name: &str, payload: Value) -> (StatusCode, Json<Value>) {
    if payload.is_array() {
        let mut responses = Vec::new();
        if let Some(arr) = payload.as_array() {
            for item in arr {
                if let Ok(req) = serde_json::from_value::<JsonRpcRequest>(item.clone()) {
                    let resp = dispatch_rpc(state, project_id, project_name, req).await;
                    responses.push(resp);
                }
            }
        }
        return (StatusCode::OK, Json(Value::Array(responses)));
    }

    match serde_json::from_value::<JsonRpcRequest>(payload) {
        Ok(req) => {
            let resp = dispatch_rpc(state, project_id, project_name, req).await;
            (StatusCode::OK, Json(resp))
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "jsonrpc": "2.0",
                "error": { "code": -32700, "message": format!("Parse error: {e}") }
            })),
        ),
    }
}

async fn dispatch_rpc(state: &AppState, project_id: i64, project_name: &str, req: JsonRpcRequest) -> Value {
    let id = req.id.unwrap_or(Value::Null);

    match req.method.as_str() {
        "initialize" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {
                            "listChanged": false
                        }
                    },
                    "serverInfo": {
                        "name": "opentask-mcp",
                        "version": "1.0.0"
                    }
                }
            })
        }
        "notifications/initialized" => {
            // Notification acknowledgment
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": null
            })
        }
        "ping" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {}
            })
        }
        "tools/list" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [
                        {
                            "name": "list_tasks",
                            "description": "List all tasks in the project board with their status, column, weight, and assignees.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "bucket_name": {
                                        "type": "string",
                                        "description": "Optional column name or state to filter tasks (e.g. 'TODO', 'In Progress', 'Review', 'Completed')"
                                    },
                                    "query": {
                                        "type": "string",
                                        "description": "Optional search term for filtering titles or descriptions"
                                    }
                                }
                            }
                        },
                        {
                            "name": "get_task",
                            "description": "Fetch detailed information for a specific task using its Snowflake ID or title.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "task_id": {
                                        "type": "string",
                                        "description": "Task Snowflake ID (e.g. '103441779797266432') or identifier"
                                    }
                                },
                                "required": ["task_id"]
                            }
                        },
                        {
                            "name": "create_task",
                            "description": "Create a new task in the project pipeline.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "title": { "type": "string", "description": "Concise imperative title of the task" },
                                    "description": { "type": "string", "description": "Markdown specification and requirements" },
                                    "type": { "type": "string", "description": "Task type: CODE, BUG, IMPROVEMENT, SECURITY, REQUIREMENT, DESIGN" },
                                    "weight": { "type": "integer", "description": "Story points Fibonacci: 1, 2, 3, 5, 8" },
                                    "bucket_name": { "type": "string", "description": "Destination column (e.g. 'TODO', 'In Progress')" },
                                    "branch_name": { "type": "string", "description": "Associated git branch name" }
                                },
                                "required": ["title"]
                            }
                        },
                        {
                            "name": "update_task",
                            "description": "Update an existing task's title, description, weight, or move it to another column.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "task_id": { "type": "string", "description": "Task ID to update" },
                                    "title": { "type": "string", "description": "Updated title" },
                                    "description": { "type": "string", "description": "Updated description" },
                                    "bucket_name": { "type": "string", "description": "Move task to this column/bucket" },
                                    "weight": { "type": "integer", "description": "Updated points (1, 2, 3, 5, 8)" }
                                },
                                "required": ["task_id"]
                            }
                        },
                        {
                            "name": "complete_task",
                            "description": "Mark a task as completed and move it to the Completed column.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "task_id": { "type": "string", "description": "Task ID to mark complete" }
                                },
                                "required": ["task_id"]
                            }
                        },
                        {
                            "name": "get_project_summary",
                            "description": "Fetch live markdown overview of the project, columns, active tasks count, and team members.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        }
                    ]
                }
            })
        }
        "tools/call" => {
            let params = req.params.unwrap_or(Value::Null);
            let tool_name = params["name"].as_str().unwrap_or("");
            let arguments = params["arguments"].as_object();

            let tool_res = match tool_name {
                "list_tasks" => handle_tool_list_tasks(state, project_id, arguments).await,
                "get_task" => handle_tool_get_task(state, project_id, arguments).await,
                "create_task" => handle_tool_create_task(state, project_id, arguments).await,
                "update_task" => handle_tool_update_task(state, project_id, arguments).await,
                "complete_task" => handle_tool_complete_task(state, project_id, arguments).await,
                "get_project_summary" => handle_tool_project_summary(state, project_id, project_name).await,
                _ => Err(format!("Unknown tool: '{tool_name}'")),
            };

            match tool_res {
                Ok(content_text) => {
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": content_text
                                }
                            ],
                            "isError": false
                        }
                    })
                }
                Err(err_text) => {
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": format!("Error executing tool {tool_name}: {err_text}")
                                }
                            ],
                            "isError": true
                        }
                    })
                }
            }
        }
        _ => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {}", req.method) }
            })
        }
    }
}

async fn handle_tool_list_tasks(state: &AppState, project_id: i64, args: Option<&serde_json::Map<String, Value>>) -> Result<String, String> {
    let bucket_filter = args.and_then(|a| a.get("bucket_name")).and_then(|v| v.as_str());
    let query_filter = args.and_then(|a| a.get("query")).and_then(|v| v.as_str());

    let rows = crate::db::query(
        r#"
        SELECT t.id, t.title, t.description, t.type as task_type, t.weight, t.branch_name,
               b.name as bucket_name, b.state as bucket_state,
               u.gh_username as lead_username
        FROM opentask.tasks t
        LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
        LEFT JOIN opentask.users u ON t.lead_assignee_id = u.id
        WHERE t.project_id = $1
        ORDER BY b.order_idx ASC, t.order_idx ASC;
        "#
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut output = format!("# Project Tasks (Total: {})\n\n", rows.len());

    let mut count = 0;
    for r in rows {
        let tid: i64 = r.try_get("id").unwrap_or(0);
        let title: String = r.try_get("title").unwrap_or_default();
        let bname: String = r.try_get("bucket_name").unwrap_or_else(|_| "Unknown".to_string());
        let bstate: String = r.try_get("bucket_state").unwrap_or_default();
        let ttype: String = r.try_get("task_type").unwrap_or_else(|_| "CODE".to_string());
        let weight: i32 = r.try_get("weight").unwrap_or(1);
        let branch: Option<String> = r.try_get("branch_name").ok();
        let lead: Option<String> = r.try_get("lead_username").ok();

        if let Some(bf) = bucket_filter {
            if !bname.eq_ignore_ascii_case(bf) && !bstate.eq_ignore_ascii_case(bf) {
                continue;
            }
        }

        if let Some(q) = query_filter {
            let q_lower = q.to_lowercase();
            if !title.to_lowercase().contains(&q_lower) && !tid.to_string().contains(&q_lower) {
                continue;
            }
        }

        count += 1;
        output.push_str(&format!(
            "- **[{title}](http://localhost:5173/projects/{project_id}?taskId={tid})**\n  - ID: `{tid}`\n  - Column: `{bname}` ({bstate})\n  - Type: `{ttype}` | Points: `{weight}`\n"
        ));
        if let Some(b) = branch {
            output.push_str(&format!("  - Branch: `{b}`\n"));
        }
        if let Some(u) = lead {
            output.push_str(&format!("  - Lead Assignee: `@{u}`\n"));
        }
    }

    if count == 0 {
        output.push_str("_No matching tasks found._\n");
    }

    Ok(output)
}

async fn handle_tool_get_task(state: &AppState, project_id: i64, args: Option<&serde_json::Map<String, Value>>) -> Result<String, String> {
    let raw_id = args
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'task_id'".to_string())?;

    let tid = parse_task_id(raw_id)?;

    let row = crate::db::query(
        r#"
        SELECT t.id, t.title, t.description, t.type as task_type, t.weight, t.branch_name, t.repo_url,
               b.name as bucket_name, b.state as bucket_state,
               u.gh_username as lead_username
        FROM opentask.tasks t
        LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
        LEFT JOIN opentask.users u ON t.lead_assignee_id = u.id
        WHERE t.id = $1 AND t.project_id = $2
        LIMIT 1;
        "#
    )
    .bind(tid)
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Task #{tid} not found in project #{project_id}"))?;

    let title: String = row.try_get("title").unwrap_or_default();
    let desc: Option<String> = row.try_get("description").ok();
    let bname: String = row.try_get("bucket_name").unwrap_or_default();
    let bstate: String = row.try_get("bucket_state").unwrap_or_default();
    let ttype: String = row.try_get("task_type").unwrap_or_default();
    let weight: i32 = row.try_get("weight").unwrap_or(1);
    let branch: Option<String> = row.try_get("branch_name").ok();
    let lead: Option<String> = row.try_get("lead_username").ok();

    let mut out = format!(
        "# Task #{tid}: {title}\n\n\
         - **Status / Column**: `{bname}` ({bstate})\n\
         - **Type**: `{ttype}`\n\
         - **Weight**: `{weight} pts`\n\
         - **Web Link**: http://localhost:5173/projects/{project_id}?taskId={tid}\n"
    );

    if let Some(b) = branch {
        out.push_str(&format!("- **Branch**: `{b}`\n"));
    }
    if let Some(l) = lead {
        out.push_str(&format!("- **Assignee**: `@{l}`\n"));
    }

    out.push_str("\n### Description / Requirements\n\n");
    out.push_str(&desc.unwrap_or_else(|| "_No description provided._".to_string()));
    out.push('\n');

    Ok(out)
}

async fn handle_tool_create_task(state: &AppState, project_id: i64, args: Option<&serde_json::Map<String, Value>>) -> Result<String, String> {
    let title = args
        .and_then(|a| a.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing required parameter 'title'".to_string())?;

    let description = args.and_then(|a| a.get("description")).and_then(|v| v.as_str());
    let task_type = args.and_then(|a| a.get("type")).and_then(|v| v.as_str()).unwrap_or("CODE");
    let weight = args.and_then(|a| a.get("weight")).and_then(|v| v.as_i64()).unwrap_or(3) as i32;
    let branch_name = args.and_then(|a| a.get("branch_name")).and_then(|v| v.as_str());
    let bucket_name = args.and_then(|a| a.get("bucket_name")).and_then(|v| v.as_str());

    // Resolve target bucket
    let bucket_id = if let Some(b_name) = bucket_name {
        let b = crate::db::query(
            "SELECT id FROM opentask.buckets WHERE project_id = $1 AND (upper(name) = upper($2) OR upper(state) = upper($2)) LIMIT 1;"
        )
        .bind(project_id)
        .bind(b_name)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

        b.and_then(|r| r.try_get::<i64, _>("id").ok())
    } else {
        None
    };

    let bucket_id = match bucket_id {
        Some(id) => id,
        None => {
            // Default to TODO or DRAFT
            let b = crate::db::query(
                "SELECT id FROM opentask.buckets WHERE project_id = $1 ORDER BY (upper(state) = 'TODO') DESC, order_idx ASC LIMIT 1;"
            )
            .bind(project_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
            b.try_get::<i64, _>("id").map_err(|e| e.to_string())?
        }
    };

    let task_id = next_id();

    crate::db::query(
        r#"
        INSERT INTO opentask.tasks
            (id, project_id, bucket_id, title, description, type, weight, branch_name, order_idx, last_activity_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW(), NOW(), NOW());
        "#
    )
    .bind(task_id)
    .bind(project_id)
    .bind(bucket_id)
    .bind(title)
    .bind(description)
    .bind(task_type)
    .bind(weight)
    .bind(branch_name)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    state.realtime.publish(project_id, "task", "created", Some(task_id));

    Ok(format!(
        "Successfully created task #{task_id}: '{title}'\n\
         - URL: http://localhost:5173/projects/{project_id}?taskId={task_id}\n\
         - Column: bucket #{bucket_id}\n\
         - Points: {weight}"
    ))
}

async fn handle_tool_update_task(state: &AppState, project_id: i64, args: Option<&serde_json::Map<String, Value>>) -> Result<String, String> {
    let raw_id = args
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'task_id'".to_string())?;

    let tid = parse_task_id(raw_id)?;

    let title = args.and_then(|a| a.get("title")).and_then(|v| v.as_str());
    let description = args.and_then(|a| a.get("description")).and_then(|v| v.as_str());
    let weight = args.and_then(|a| a.get("weight")).and_then(|v| v.as_i64()).map(|w| w as i32);
    let bucket_name = args.and_then(|a| a.get("bucket_name")).and_then(|v| v.as_str());

    let mut target_bucket_id = None;
    if let Some(b_name) = bucket_name {
        let b = crate::db::query(
            "SELECT id FROM opentask.buckets WHERE project_id = $1 AND (upper(name) = upper($2) OR upper(state) = upper($2)) LIMIT 1;"
        )
        .bind(project_id)
        .bind(b_name)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

        if let Some(r) = b {
            target_bucket_id = r.try_get::<i64, _>("id").ok();
        }
    }

    let updated = crate::db::query(
        r#"
        UPDATE opentask.tasks
        SET title = COALESCE($1, title),
            description = COALESCE($2, description),
            weight = COALESCE($3, weight),
            bucket_id = COALESCE($4, bucket_id),
            updated_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $5 AND project_id = $6
        RETURNING title, bucket_id;
        "#
    )
    .bind(title)
    .bind(description)
    .bind(weight)
    .bind(target_bucket_id)
    .bind(tid)
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    match updated {
        Some(row) => {
            let action = if target_bucket_id.is_some() { "moved" } else { "updated" };
            state.realtime.publish(project_id, "task", action, Some(tid));
            let new_title: String = row.try_get("title").unwrap_or_default();
            Ok(format!("Task #{tid} ('{new_title}') updated successfully."))
        }
        None => Err(format!("Task #{tid} not found in project #{project_id}")),
    }
}

async fn handle_tool_complete_task(state: &AppState, project_id: i64, args: Option<&serde_json::Map<String, Value>>) -> Result<String, String> {
    let raw_id = args
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'task_id'".to_string())?;

    let tid = parse_task_id(raw_id)?;

    // Find completed bucket
    let comp_bucket = crate::db::query(
        "SELECT id FROM opentask.buckets WHERE project_id = $1 ORDER BY (upper(state) = 'COMPLETED') DESC, (upper(name) LIKE '%COMPLETE%') DESC LIMIT 1;"
    )
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "No COMPLETED bucket found in project".to_string())?;

    let comp_id: i64 = comp_bucket.try_get("id").map_err(|e| e.to_string())?;

    let updated = crate::db::query(
        "UPDATE opentask.tasks SET bucket_id = $1, updated_at = NOW(), last_activity_at = NOW() WHERE id = $2 AND project_id = $3 RETURNING title;"
    )
    .bind(comp_id)
    .bind(tid)
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    match updated {
        Some(row) => {
            state.realtime.publish(project_id, "task", "moved", Some(tid));
            let title: String = row.try_get("title").unwrap_or_default();
            Ok(format!("Task #{tid} ('{title}') marked as COMPLETED and moved to Completed column."))
        }
        None => Err(format!("Task #{tid} not found in project #{project_id}")),
    }
}

async fn handle_tool_project_summary(state: &AppState, project_id: i64, project_name: &str) -> Result<String, String> {
    let buckets = crate::db::query(
        "SELECT id, name, state, (SELECT COUNT(*) FROM opentask.tasks WHERE bucket_id = b.id) as task_count FROM opentask.buckets b WHERE project_id = $1 ORDER BY order_idx ASC;"
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = format!("# Project Status: {project_name} (ID: {project_id})\n\n### Pipeline Stages\n");
    for b in buckets {
        let name: String = b.try_get("name").unwrap_or_default();
        let state_val: String = b.try_get("state").unwrap_or_default();
        let count: i64 = b.try_get("task_count").unwrap_or(0);
        out.push_str(&format!("- **{name}** (`{state_val}`): {count} tasks\n"));
    }

    let members = crate::db::query(
        r#"
        SELECT pm.role, COALESCE(pm.gh_username, u.gh_username, u.display_name, 'Member') as name
        FROM opentask.project_member pm
        LEFT JOIN opentask.users u ON pm.user_id = u.id
        WHERE pm.project_id = $1;
        "#
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    out.push_str("\n### Team Members\n");
    for m in members {
        let name: String = m.try_get("name").unwrap_or_default();
        let role: String = m.try_get("role").unwrap_or_default();
        out.push_str(&format!("- `@{name}` ({role})\n"));
    }

    Ok(out)
}
