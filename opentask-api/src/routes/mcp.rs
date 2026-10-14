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
use futures_util::{stream, StreamExt};
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

#[derive(Debug, Clone)]
pub struct AccessibleProject {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone)]
pub struct McpAuthContext {
    pub user_id: Option<i64>,
    pub user_login: Option<String>,
    pub accessible_projects: Vec<AccessibleProject>,
    pub active_project_id: i64,
    pub active_project_name: String,
}

impl McpAuthContext {
    pub fn has_project_access(&self, project_id: i64) -> bool {
        self.accessible_projects.iter().any(|p| p.id == project_id)
    }

    pub fn get_project(&self, project_id: i64) -> Option<&AccessibleProject> {
        self.accessible_projects.iter().find(|p| p.id == project_id)
    }

    pub fn resolve_project_id(&self, requested: Option<&str>) -> Result<i64, String> {
        if let Some(req) = requested.filter(|s| !s.trim().is_empty()) {
            let req_trimmed = req.trim();
            if let Ok(id) = req_trimmed.parse::<i64>() {
                if self.has_project_access(id) {
                    return Ok(id);
                }
                return Err(format!("Access denied to project ID #{id} or project does not exist."));
            }
            let matches: Vec<&AccessibleProject> = self
                .accessible_projects
                .iter()
                .filter(|p| p.name.eq_ignore_ascii_case(req_trimmed))
                .collect();
            if matches.len() == 1 {
                return Ok(matches[0].id);
            } else if matches.len() > 1 {
                return Err(format!(
                    "Ambiguous project name '{req_trimmed}'. Multiple projects match. Please specify numeric project_id."
                ));
            }
            return Err(format!("Project '{req_trimmed}' not found in accessible projects."));
        }

        Ok(self.active_project_id)
    }
}

async fn authenticate_mcp_context(
    state: &AppState,
    explicit_project_id: Option<i64>,
    headers: &HeaderMap,
    query: &McpQuery,
) -> Result<McpAuthContext, (StatusCode, Json<Value>)> {
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
                        "message": "Authentication required. Provide project API key or GitHub token via 'Authorization: Bearer <KEY>', 'X-Project-Key: <KEY>', or '?key=<KEY>'"
                    }
                })),
            ));
        }
    };

    // 2. First check: Does token match a project API key?
    let project_rows = crate::db::query(
        "SELECT id, name, description, api_key FROM opentask.projects WHERE api_key IS NOT NULL;"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "jsonrpc": "2.0",
                "error": { "code": -32603, "message": format!("Database error: {e}") }
            })),
        )
    })?;

    for r in &project_rows {
        let stored_key: Option<String> = r.try_get("api_key").ok().flatten();
        if let Some(stored) = stored_key {
            let is_valid = if stored.starts_with("$argon2") {
                crate::services::hasher::verify_hash(&token, &stored)
            } else {
                stored == token
            };

            if is_valid {
                let pid: i64 = r.try_get("id").unwrap_or(0);
                let pname: String = r.try_get("name").unwrap_or_default();
                let pdesc: Option<String> = r.try_get("description").ok();

                if let Some(req_pid) = explicit_project_id {
                    if req_pid != pid {
                        return Err((
                            StatusCode::FORBIDDEN,
                            Json(json!({
                                "jsonrpc": "2.0",
                                "error": { "code": -32000, "message": format!("API key is for project #{pid}, not requested project #{req_pid}.") }
                            })),
                        ));
                    }
                }

                let accessible_projects = vec![AccessibleProject {
                    id: pid,
                    name: pname.clone(),
                    description: pdesc,
                    role: Some("Project API Key".to_string()),
                }];

                return Ok(McpAuthContext {
                    user_id: None,
                    user_login: None,
                    accessible_projects,
                    active_project_id: pid,
                    active_project_name: pname,
                });
            }
        }
    }

    // 3. Second check: Is token a User Access Token (GitHub OAuth token / user session)?
    // First try database lookup by gh_access_token
    let user_db = crate::db::query(
        "SELECT id, gh_id::TEXT as gh_id, gh_username FROM opentask.users WHERE gh_access_token = $1 LIMIT 1;"
    )
    .bind(&token)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let (user_db_id, gh_id, gh_username) = if let Some(u) = user_db {
        let uid: Option<i64> = u.try_get("id").ok();
        let gid: String = u.try_get("gh_id").unwrap_or_default();
        let gun: String = u.try_get("gh_username").unwrap_or_default();
        (uid, gid, gun)
    } else {
        // Fallback to GitHub API verification
        match crate::extractors::auth::resolve_github_user(&token).await {
            Ok(gh_user) => (None, gh_user.id.to_string(), gh_user.login),
            Err(_) => {
                return Err((
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "jsonrpc": "2.0",
                        "error": { "code": -32000, "message": "Invalid project API key or user access token." }
                    })),
                ));
            }
        }
    };

    // Query all projects accessible to this user
    let user_projects = crate::db::query(
        r#"
        SELECT DISTINCT p.id, p.name, p.description, pm.role
        FROM opentask.projects p
        JOIN opentask.project_member pm ON pm.project_id = p.id
        JOIN opentask.users u ON u.id = pm.user_id
        WHERE u.gh_id = $1 OR u.gh_username = $2
        ORDER BY p.name ASC;
        "#
    )
    .bind(&gh_id)
    .bind(&gh_username)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "jsonrpc": "2.0",
                "error": { "code": -32603, "message": format!("Database error fetching user projects: {e}") }
            })),
        )
    })?;

    if user_projects.is_empty() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "jsonrpc": "2.0",
                "error": { "code": -32000, "message": "Authenticated user is not a member of any OpenTask projects." }
            })),
        ));
    }

    let accessible: Vec<AccessibleProject> = user_projects
        .into_iter()
        .map(|row| AccessibleProject {
            id: row.try_get("id").unwrap_or(0),
            name: row.try_get("name").unwrap_or_default(),
            description: row.try_get("description").ok(),
            role: row.try_get("role").ok(),
        })
        .collect();

    let (active_id, active_name) = if let Some(req_pid) = explicit_project_id {
        if let Some(target) = accessible.iter().find(|p| p.id == req_pid) {
            (target.id, target.name.clone())
        } else {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({
                    "jsonrpc": "2.0",
                    "error": { "code": -32000, "message": format!("User does not have access to requested project #{req_pid}.") }
                })),
            ));
        }
    } else {
        (accessible[0].id, accessible[0].name.clone())
    };

    Ok(McpAuthContext {
        user_id: user_db_id,
        user_login: Some(gh_username),
        accessible_projects: accessible,
        active_project_id: active_id,
        active_project_name: active_name,
    })
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
    let auth_ctx = match authenticate_mcp_context(&state, Some(project_id.0), &headers, &query).await {
        Ok(res) => res,
        Err((code, err)) => return (code, err).into_response(),
    };

    process_rpc_payload(&state, &auth_ctx, rpc).await.into_response()
}

pub async fn handle_mcp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<McpQuery>,
    Json(rpc): Json<Value>,
) -> Response {
    let auth_ctx = match authenticate_mcp_context(&state, None, &headers, &query).await {
        Ok(res) => res,
        Err((code, err)) => return (code, err).into_response(),
    };

    process_rpc_payload(&state, &auth_ctx, rpc).await.into_response()
}

pub async fn handle_project_mcp_sse(
    Path(project_id): Path<SafeId>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let endpoint_url = format!("/api/projects/{}/mcp", project_id);
    let initial_event = Event::default().event("endpoint").data(endpoint_url);

    let stream = stream::once(async move { Ok(initial_event) }).chain(stream::pending());
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

pub async fn handle_mcp_sse() -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let initial_event = Event::default().event("endpoint").data("/api/mcp");
    let stream = stream::once(async move { Ok(initial_event) }).chain(stream::pending());
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn process_rpc_payload(state: &AppState, auth_ctx: &McpAuthContext, payload: Value) -> (StatusCode, Json<Value>) {
    if payload.is_array() {
        let mut responses = Vec::new();
        if let Some(arr) = payload.as_array() {
            for item in arr {
                if let Ok(req) = serde_json::from_value::<JsonRpcRequest>(item.clone()) {
                    let resp = dispatch_rpc(state, auth_ctx, req).await;
                    responses.push(resp);
                }
            }
        }
        return (StatusCode::OK, Json(Value::Array(responses)));
    }

    match serde_json::from_value::<JsonRpcRequest>(payload) {
        Ok(req) => {
            let resp = dispatch_rpc(state, auth_ctx, req).await;
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

async fn dispatch_rpc(state: &AppState, auth_ctx: &McpAuthContext, req: JsonRpcRequest) -> Value {
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
                        "version": "1.1.0"
                    }
                }
            })
        }
        "notifications/initialized" => {
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
                            "name": "list_projects",
                            "description": "List all OpenTask projects accessible in this session with their Snowflake IDs, names, descriptions, roles, and task counts.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": {
                                        "type": "string",
                                        "description": "Optional search filter for project name, ID, or description"
                                    }
                                }
                            }
                        },
                        {
                            "name": "list_tasks",
                            "description": "List tasks in the project board with their status, column, weight, and assignees. Can target any accessible project.",
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
                                    },
                                    "project_id": {
                                        "type": "string",
                                        "description": "Optional project Snowflake ID or name. If omitted, uses the active project."
                                    }
                                }
                            }
                        },
                        {
                            "name": "get_task",
                            "description": "Fetch detailed requirements and specs for a specific task using its Snowflake ID or title across all accessible projects.",
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
                            "description": "Create a new task in the project pipeline. Can target any accessible project.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "title": { "type": "string", "description": "Concise imperative title of the task" },
                                    "description": { "type": "string", "description": "Markdown specification and requirements" },
                                    "type": { "type": "string", "description": "Task type: CODE, BUG, IMPROVEMENT, SECURITY, REQUIREMENT, DESIGN" },
                                    "weight": { "type": "integer", "description": "Story points Fibonacci: 1, 2, 3, 5, 8" },
                                    "bucket_name": { "type": "string", "description": "Destination column (e.g. 'TODO', 'In Progress')" },
                                    "branch_name": { "type": "string", "description": "Associated git branch name" },
                                    "project_id": { "type": "string", "description": "Optional target project Snowflake ID or name. If omitted, uses the active project." }
                                },
                                "required": ["title"]
                            }
                        },
                        {
                            "name": "update_task",
                            "description": "Update an existing task's title, description, weight, or move it to another column across any accessible project.",
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
                            "description": "Mark a task as completed and move it to the Completed column across any accessible project.",
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
                            "description": "Fetch live markdown overview of pipeline stages, tasks count per column, and team members. Can inspect any accessible project.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "project_id": {
                                        "type": "string",
                                        "description": "Optional project Snowflake ID or name to summarize. Defaults to active project."
                                    }
                                }
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
                "list_projects" => handle_tool_list_projects(state, auth_ctx, arguments).await,
                "list_tasks" => handle_tool_list_tasks(state, auth_ctx, arguments).await,
                "get_task" => handle_tool_get_task(state, auth_ctx, arguments).await,
                "create_task" => handle_tool_create_task(state, auth_ctx, arguments).await,
                "update_task" => handle_tool_update_task(state, auth_ctx, arguments).await,
                "complete_task" => handle_tool_complete_task(state, auth_ctx, arguments).await,
                "get_project_summary" => handle_tool_project_summary(state, auth_ctx, arguments).await,
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

async fn handle_tool_list_projects(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let query_filter = args.and_then(|a| a.get("query")).and_then(|v| v.as_str());

    let mut out = format!(
        "# Accessible Projects ({})\n\n",
        auth_ctx.accessible_projects.len()
    );

    let mut count = 0;
    for proj in &auth_ctx.accessible_projects {
        if let Some(q) = query_filter {
            let q_lower = q.to_lowercase();
            let matches_name = proj.name.to_lowercase().contains(&q_lower);
            let matches_desc = proj.description.as_deref().unwrap_or("").to_lowercase().contains(&q_lower);
            let matches_id = proj.id.to_string().contains(&q_lower);
            if !matches_name && !matches_desc && !matches_id {
                continue;
            }
        }

        // Fetch task count & member count
        let stats = crate::db::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM opentask.tasks WHERE project_id = $1) as task_count,
                (SELECT COUNT(*) FROM opentask.project_member WHERE project_id = $1) as member_count
            "#
        )
        .bind(proj.id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

        let task_count: i64 = stats.as_ref().and_then(|r| r.try_get("task_count").ok()).unwrap_or(0);
        let member_count: i64 = stats.as_ref().and_then(|r| r.try_get("member_count").ok()).unwrap_or(0);

        let active_badge = if proj.id == auth_ctx.active_project_id {
            " **[ACTIVE]**"
        } else {
            ""
        };

        count += 1;
        out.push_str(&format!(
            "### {}. [{}]({}/projects/{}){}\n- **Project ID**: `{}`\n- **Tasks**: {} | **Members**: {}\n",
            count,
            proj.name,
            "http://localhost:5173",
            proj.id,
            active_badge,
            proj.id,
            task_count,
            member_count,
        ));

        if let Some(r) = &proj.role {
            out.push_str(&format!("- **Your Role**: `{r}`\n"));
        }

        if let Some(d) = &proj.description {
            if !d.trim().is_empty() {
                out.push_str(&format!("- **Description**: {d}\n"));
            }
        }
        out.push('\n');
    }

    if count == 0 {
        out.push_str("_No projects matched the search filter._\n");
    } else {
        out.push_str(
            "_Tip: To work with a specific project, pass `project_id: \"<ID>\"` in tool calls (`list_tasks`, `create_task`, `get_project_summary`)._\n"
        );
    }

    Ok(out)
}

async fn handle_tool_list_tasks(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let requested_project = args
        .and_then(|a| a.get("project_id"))
        .and_then(|v| v.as_str());

    let target_project_id = auth_ctx.resolve_project_id(requested_project)?;
    let target_project_name = auth_ctx
        .get_project(target_project_id)
        .map(|p| p.name.as_str())
        .unwrap_or("Project");

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
    .bind(target_project_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut output = format!(
        "# Project: {target_project_name} (ID: {target_project_id})\n**Tasks Count: {}**\n\n",
        rows.len()
    );

    if auth_ctx.accessible_projects.len() > 1 && requested_project.is_none() {
        output.push_str(&format!(
            "_Note: Showing active project. You have access to {} projects. Pass `project_id: \"<ID>\"` or use `list_projects` to switch._\n\n",
            auth_ctx.accessible_projects.len()
        ));
    }

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
            "- **[{title}](http://localhost:5173/projects/{target_project_id}?taskId={tid})**\n  - ID: `{tid}`\n  - Column: `{bname}` ({bstate})\n  - Type: `{ttype}` | Points: `{weight}`\n"
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

async fn handle_tool_get_task(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let raw_id = args
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'task_id'".to_string())?;

    let tid = parse_task_id(raw_id)?;

    let row = crate::db::query(
        r#"
        SELECT t.id, t.project_id, t.title, t.description, t.type as task_type, t.weight, t.branch_name, t.repo_url,
               b.name as bucket_name, b.state as bucket_state,
               u.gh_username as lead_username,
               p.name as project_name
        FROM opentask.tasks t
        JOIN opentask.projects p ON t.project_id = p.id
        LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
        LEFT JOIN opentask.users u ON t.lead_assignee_id = u.id
        WHERE t.id = $1
        LIMIT 1;
        "#
    )
    .bind(tid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Task #{tid} not found."))?;

    let task_project_id: i64 = row.try_get("project_id").unwrap_or(0);
    if !auth_ctx.has_project_access(task_project_id) {
        return Err(format!(
            "Access denied: Task #{tid} belongs to project #{task_project_id}, which is not among your accessible projects."
        ));
    }

    let project_name: String = row.try_get("project_name").unwrap_or_default();
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
         - **Project**: [{project_name}](http://localhost:5173/projects/{task_project_id}) (ID: `{task_project_id}`)\n\
         - **Status / Column**: `{bname}` ({bstate})\n\
         - **Type**: `{ttype}`\n\
         - **Weight**: `{weight} pts`\n\
         - **Web Link**: http://localhost:5173/projects/{task_project_id}?taskId={tid}\n"
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

async fn handle_tool_create_task(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let requested_project = args
        .and_then(|a| a.get("project_id"))
        .and_then(|v| v.as_str());

    let target_project_id = auth_ctx.resolve_project_id(requested_project)?;
    let target_project_name = auth_ctx
        .get_project(target_project_id)
        .map(|p| p.name.as_str())
        .unwrap_or("Project");

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

    // Resolve target bucket in the target project
    let bucket_id = if let Some(b_name) = bucket_name {
        let b = crate::db::query(
            "SELECT id FROM opentask.buckets WHERE project_id = $1 AND (upper(name) = upper($2) OR upper(state) = upper($2)) LIMIT 1;"
        )
        .bind(target_project_id)
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
            .bind(target_project_id)
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
    .bind(target_project_id)
    .bind(bucket_id)
    .bind(title)
    .bind(description)
    .bind(task_type)
    .bind(weight)
    .bind(branch_name)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    state.realtime.publish(target_project_id, "task", "created", Some(task_id));

    Ok(format!(
        "Successfully created task #{task_id}: '{title}' in project '{target_project_name}'\n\
         - URL: http://localhost:5173/projects/{target_project_id}?taskId={task_id}\n\
         - Column: bucket #{bucket_id}\n\
         - Points: {weight}"
    ))
}

async fn handle_tool_update_task(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let raw_id = args
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'task_id'".to_string())?;

    let tid = parse_task_id(raw_id)?;

    // Check project of task and verify access
    let task_meta = crate::db::query("SELECT project_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
        .bind(tid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Task #{tid} not found."))?;

    let task_project_id: i64 = task_meta.try_get("project_id").unwrap_or(0);
    if !auth_ctx.has_project_access(task_project_id) {
        return Err(format!(
            "Access denied: Task #{tid} belongs to project #{task_project_id}, which is not in your accessible projects."
        ));
    }

    let title = args.and_then(|a| a.get("title")).and_then(|v| v.as_str());
    let description = args.and_then(|a| a.get("description")).and_then(|v| v.as_str());
    let weight = args.and_then(|a| a.get("weight")).and_then(|v| v.as_i64()).map(|w| w as i32);
    let bucket_name = args.and_then(|a| a.get("bucket_name")).and_then(|v| v.as_str());

    let mut target_bucket_id = None;
    if let Some(b_name) = bucket_name {
        let b = crate::db::query(
            "SELECT id FROM opentask.buckets WHERE project_id = $1 AND (upper(name) = upper($2) OR upper(state) = upper($2)) LIMIT 1;"
        )
        .bind(task_project_id)
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
    .bind(task_project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    match updated {
        Some(row) => {
            let action = if target_bucket_id.is_some() { "moved" } else { "updated" };
            state.realtime.publish(task_project_id, "task", action, Some(tid));
            let new_title: String = row.try_get("title").unwrap_or_default();
            Ok(format!("Task #{tid} ('{new_title}') updated successfully."))
        }
        None => Err(format!("Task #{tid} not found in project #{task_project_id}")),
    }
}

async fn handle_tool_complete_task(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let raw_id = args
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter 'task_id'".to_string())?;

    let tid = parse_task_id(raw_id)?;

    // Check project of task and verify access
    let task_meta = crate::db::query("SELECT project_id FROM opentask.tasks WHERE id = $1 LIMIT 1;")
        .bind(tid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Task #{tid} not found."))?;

    let task_project_id: i64 = task_meta.try_get("project_id").unwrap_or(0);
    if !auth_ctx.has_project_access(task_project_id) {
        return Err(format!(
            "Access denied: Task #{tid} belongs to project #{task_project_id}, which is not in your accessible projects."
        ));
    }

    // Find completed bucket in the task's project
    let comp_bucket = crate::db::query(
        "SELECT id FROM opentask.buckets WHERE project_id = $1 ORDER BY (upper(state) = 'COMPLETED') DESC, (upper(name) LIKE '%COMPLETE%') DESC LIMIT 1;"
    )
    .bind(task_project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("No COMPLETED bucket found in project #{task_project_id}"))?;

    let comp_id: i64 = comp_bucket.try_get("id").map_err(|e| e.to_string())?;

    let updated = crate::db::query(
        "UPDATE opentask.tasks SET bucket_id = $1, updated_at = NOW(), last_activity_at = NOW() WHERE id = $2 AND project_id = $3 RETURNING title;"
    )
    .bind(comp_id)
    .bind(tid)
    .bind(task_project_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    match updated {
        Some(row) => {
            state.realtime.publish(task_project_id, "task", "moved", Some(tid));
            let title: String = row.try_get("title").unwrap_or_default();
            Ok(format!("Task #{tid} ('{title}') marked as COMPLETED and moved to Completed column in project #{task_project_id}."))
        }
        None => Err(format!("Task #{tid} not found in project #{task_project_id}")),
    }
}

async fn handle_tool_project_summary(
    state: &AppState,
    auth_ctx: &McpAuthContext,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<String, String> {
    let requested_project = args
        .and_then(|a| a.get("project_id"))
        .and_then(|v| v.as_str());

    let target_project_id = auth_ctx.resolve_project_id(requested_project)?;
    let target_project_name = auth_ctx
        .get_project(target_project_id)
        .map(|p| p.name.as_str())
        .unwrap_or("Project");

    let buckets = crate::db::query(
        "SELECT id, name, state, (SELECT COUNT(*) FROM opentask.tasks WHERE bucket_id = b.id) as task_count FROM opentask.buckets b WHERE project_id = $1 ORDER BY order_idx ASC;"
    )
    .bind(target_project_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = format!("# Project Status: {target_project_name} (ID: {target_project_id})\n\n### Pipeline Stages\n");
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
    .bind(target_project_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    out.push_str("\n### Team Members\n");
    for m in members {
        let name: String = m.try_get("name").unwrap_or_default();
        let role: String = m.try_get("role").unwrap_or_default();
        out.push_str(&format!("- `@{name}` ({role})\n"));
    }

    if auth_ctx.accessible_projects.len() > 1 {
        out.push_str("\n### Other Accessible Projects\n");
        for p in &auth_ctx.accessible_projects {
            if p.id != target_project_id {
                out.push_str(&format!("- **{}** (ID: `{}`)\n", p.name, p.id));
            }
        }
        out.push_str("\n_Tip: Pass `project_id: \"<ID>\"` to view details of another project._\n");
    }

    Ok(out)
}
