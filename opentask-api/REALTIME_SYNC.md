# Project Realtime Synchronization

The Rust API exposes a project-scoped WebSocket endpoint authenticated via a short-lived one-time ticket (to prevent leaking access tokens in query parameters and reverse proxy access logs):

```text
POST /projects/{project_id}/events/ticket
Authorization: Bearer {github_access_token}

-> Response: { "ticket": "wst_...", "expires_in": 60 }
```

Then upgrade the WebSocket connection using the one-time ticket:

```text
GET /projects/{project_id}/events?ticket={ticket}
```

(The endpoint also maintains backward-compatible support for `?token={github_access_token}` as a fallback).
The server verifies the ticket (or token) and checks that the user is a member of the project before upgrading the connection. Each ticket is strictly single-use and consumed immediately upon upgrade.

Mutation events use this JSON envelope:

```json
{
  "version": 1,
  "project_id": "101418347630956544",
  "entity": "task",
  "action": "updated",
  "entity_id": "101418559460085760"
}
```

Snowflake IDs are strings to prevent JavaScript precision loss.

The current hub is process-local and supports the deployed single Rust API
process without polling. If the API is scaled to multiple Rust processes,
replace the `RealtimeHub` sender with Redis Pub/Sub fan-out so every process
publishes to and consumes from the same project event channels. The frontend
reconnects with exponential backoff and performs a silent board/member/project
refresh after each relevant event; the existing periodic refresh remains a
safety net for missed events.
