# OpenTask Model Context Protocol (MCP) Documentation

The **OpenTask MCP Server** exposes the Model Context Protocol (JSON-RPC 2.0 / SSE) to AI coding assistants (such as Google Antigravity, Cursor, Claude Desktop, Windsurf, Cline/Roo Code, and Zed). It gives AI agents real-time awareness of project backlogs, kanban pipelines, task requirements, and the ability to autonomously update boards and report progress.

---

## Table of Contents
- [Architecture & Endpoints](#architecture--endpoints)
- [Authentication](#authentication)
- [Client Configuration](#client-configuration)
  - [Google Antigravity](#google-antigravity)
  - [Cursor IDE](#cursor-ide)
  - [Claude Desktop](#claude-desktop)
  - [Cline / Roo Code](#cline--roo-code)
  - [Zed Editor](#zed-editor)
- [Available MCP Tools Reference](#available-mcp-tools-reference)
  - [1. `list_projects`](#1-list_projects)
  - [2. `list_tasks`](#2-list_tasks)
  - [3. `get_task`](#3-get_task)
  - [4. `create_task`](#4-create_task)
  - [5. `update_task`](#5-update_task)
  - [6. `complete_task`](#6-complete_task)
  - [7. `get_project_summary`](#7-get_project_summary)
- [Architectural Notes & Best Practices](#architectural-notes--best-practices)

---

## Architecture & Endpoints

OpenTask implements both HTTP POST (Stateless JSON-RPC) and Server-Sent Events (SSE Streaming) transports compliant with the Model Context Protocol specification (`2024-11-05`).

### Endpoint URLs

| Type | Endpoint | Description |
| :--- | :--- | :--- |
| **Project-Scoped HTTP** | `POST /api/projects/:projectId/mcp` | Direct JSON-RPC execution scoped to a specific project. |
| **Project-Scoped SSE** | `GET /api/projects/:projectId/mcp/sse` | Streaming SSE endpoint for Cursor, Claude Desktop, and Zed. |
| **Global HTTP** | `POST /api/mcp` | Multi-project JSON-RPC endpoint (accesses all projects authorized for the token). |
| **Global SSE** | `GET /api/mcp/sse` | Multi-project SSE endpoint. |

> [!NOTE]
> In production, requests to `/api/*` are routed directly to the Rust backend (e.g. `https://env-opentask.user.cloudjkt02.com/api/...` or your custom domain).

---

## Authentication

OpenTask supports three standard authentication methods for MCP requests:

1. **Bearer Token (GitHub OAuth / Personal Access Token)**:
   ```http
   Authorization: Bearer <GITHUB_TOKEN>
   ```
2. **Project API Key Header**:
   ```http
   X-Project-Key: <PROJECT_API_KEY>
   ```
3. **Query Parameter (Useful for SSE endpoints in IDEs)**:
   ```http
   GET /api/projects/:projectId/mcp/sse?key=<PROJECT_API_KEY>
   # or
   GET /api/projects/:projectId/mcp/sse?token=<GITHUB_TOKEN>
   ```

---

## Client Configuration

### Google Antigravity
Add to your project or global `mcp_config.json`:

```json
{
  "mcpServers": {
    "opentask": {
      "serverUrl": "https://<YOUR_OPENTASK_DOMAIN>/api/projects/<PROJECT_ID>/mcp/sse?key=<PROJECT_API_KEY>"
    }
  }
}
```

### Cursor IDE
Place in `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (workspace):

```json
{
  "mcpServers": {
    "opentask": {
      "url": "https://<YOUR_OPENTASK_DOMAIN>/api/projects/<PROJECT_ID>/mcp/sse?key=<PROJECT_API_KEY>"
    }
  }
}
```

### Claude Desktop
Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opentask": {
      "url": "https://<YOUR_OPENTASK_DOMAIN>/api/projects/<PROJECT_ID>/mcp/sse?key=<PROJECT_API_KEY>"
    }
  }
}
```

### Cline / Roo Code
Add to `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "opentask": {
      "url": "https://<YOUR_OPENTASK_DOMAIN>/api/projects/<PROJECT_ID>/mcp/sse?key=<PROJECT_API_KEY>"
    }
  }
}
```

### Zed Editor
Add under `context_servers` in your Zed `settings.json`:

```json
{
  "context_servers": {
    "opentask": {
      "endpoint": "https://<YOUR_OPENTASK_DOMAIN>/api/projects/<PROJECT_ID>/mcp/sse?key=<PROJECT_API_KEY>"
    }
  }
}
```

---

## Available MCP Tools Reference

OpenTask provides **7 core MCP tools** for complete project and task lifecycle management:

```
┌────────────────────────────────────────────────────────┐
│                   OpenTask MCP Tools                   │
├─────────────────────┬──────────────────────────────────┤
│ Discovery & Query   │ list_projects, list_tasks,       │
│                     │ get_task, get_project_summary    │
├─────────────────────┼──────────────────────────────────┤
│ Modification        │ create_task, update_task,        │
│                     │ complete_task                    │
└─────────────────────┴──────────────────────────────────┘
```

---

### 1. `list_projects`

List all OpenTask projects accessible in the active session with Snowflake IDs, names, descriptions, user roles, task counts, and member counts.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | No | Optional search filter for project name, ID, or description. |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "list_projects",
    "arguments": {
      "query": "mobile"
    }
  }
}
```

#### Output
Markdown-formatted list of matching projects with direct web links, Snowflake IDs, assigned role, and task count metrics.

---

### 2. `list_tasks`

List tasks in a project board with their status, column, Fibonacci weight, branch name, and assignees. Can target the active project or any accessible project.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `project_id` | `string` | No | Target project Snowflake ID or name. If omitted, uses the active project. |
| `bucket_name` | `string` | No | Filter by column or state (e.g. `'TODO'`, `'In Progress'`, `'Review'`, `'Completed'`). Case-insensitive. |
| `query` | `string` | No | Optional search term for filtering task titles or descriptions. |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "list_tasks",
    "arguments": {
      "bucket_name": "In Progress"
    }
  }
}
```

#### Output
Markdown list of tasks grouped with links, column status, task types (`CODE`, `BUG`, `IMPROVEMENT`), story points, and assignee `@handles`.

---

### 3. `get_task`

Fetch full specification, markdown description, branch, and metadata for a specific task using its Snowflake ID or identifier string.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `task_id` | `string` | **Yes** | Task Snowflake ID (e.g. `'103441779797266432'`), `#<ID>`, or URL containing `taskId=<ID>`. |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_task",
    "arguments": {
      "task_id": "103441779797266432"
    }
  }
}
```

#### Output
Comprehensive Markdown view of the task, containing title, parent project, column status, story points, branch, and complete specification description.

---

### 4. `create_task`

Create a new task, bug report, or feature in any accessible project pipeline. Real-time updates are immediately dispatched to connected clients.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `title` | `string` | **Yes** | Concise imperative title of the task. |
| `description` | `string` | No | Full Markdown specification and acceptance criteria. |
| `type` | `string` | No | Task type: `CODE` (default), `BUG`, `IMPROVEMENT`, `SECURITY`, `REQUIREMENT`, `DESIGN`. |
| `weight` | `integer` | No | Fibonacci story points: `1`, `2`, `3` (default), `5`, `8`. |
| `bucket_name` | `string` | No | Destination column/bucket (e.g. `'TODO'`, `'In Progress'`). Defaults to first `TODO` or `DRAFT` column. |
| `branch_name` | `string` | No | Associated git branch name (e.g. `feat/auth-refresh`). |
| `project_id` | `string` | No | Target project Snowflake ID or name. If omitted, uses active project. |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "create_task",
    "arguments": {
      "title": "Fix OAuth token refresh race condition",
      "type": "BUG",
      "weight": 3,
      "bucket_name": "TODO",
      "description": "Resolve concurrent token refresh requests that cause 401 unauthenticated errors."
    }
  }
}
```

#### Output
Success message confirming the new Snowflake Task ID, parent project name, column ID, and direct web link.

---

### 5. `update_task`

Update an existing task's title, description, weight, or move it to another column across any accessible project.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `task_id` | `string` | **Yes** | Task Snowflake ID to update. |
| `title` | `string` | No | Updated title. |
| `description` | `string` | No | Updated Markdown specification. |
| `bucket_name` | `string` | No | Target column name to move the task to (e.g. `'In Progress'`, `'Review'`). |
| `weight` | `integer` | No | Updated Fibonacci points (`1`, `2`, `3`, `5`, `8`). |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "update_task",
    "arguments": {
      "task_id": "103441779797266432",
      "bucket_name": "In Progress"
    }
  }
}
```

#### Output
Confirmation message indicating that the task was successfully updated/moved, triggering a live board broadcast.

---

### 6. `complete_task`

Convenience tool to mark a task completed and archive it into the project's `COMPLETED` column.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `task_id` | `string` | **Yes** | Task Snowflake ID to mark complete. |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "complete_task",
    "arguments": {
      "task_id": "103441779797266432"
    }
  }
}
```

#### Output
Confirmation that the task was marked as completed and moved to the designated `COMPLETED` column.

---

### 7. `get_project_summary`

Fetch a live markdown overview of a project: pipeline stages with task counts per column, team members and roles, and other accessible projects.

#### Parameters
| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `project_id` | `string` | No | Target project Snowflake ID or name. If omitted, uses active project. |

#### Example Invocation
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "get_project_summary",
    "arguments": {}
  }
}
```

#### Output
Structured Markdown report showing:
- Active project name and ID
- Pipeline stages (e.g. `Backlog (TODO): 4 tasks`, `In Development (IN_PROGRESS): 2 tasks`, `Done (COMPLETED): 12 tasks`)
- Team roster with GitHub usernames and roles
- List of other accessible projects

---

## Architectural Notes & Best Practices

1. **Snowflake SafeId Convention**:
   - All IDs (`project_id`, `task_id`, `bucket_id`) are 64-bit BigInts.
   - Always pass IDs as **strings** (e.g. `"103441779797266432"`) to avoid JavaScript floating-point truncation.
2. **Real-time Event Broadcasting**:
   - Mutations made via MCP (`create_task`, `update_task`, `complete_task`) immediately emit realtime SSE/WebSocket events to the web app (`opentask-app`), so other developers see card movement instantly.
3. **Cross-Project Navigation**:
   - Tools accept `project_id` (Snowflake ID or project name). If omitted, calls default to the active project context defined by the MCP endpoint or the user's primary project.
