import re
from typing import Optional
from fastapi import APIRouter, Header, Query, HTTPException, Depends
from pydantic import BaseModel, Field
import psycopg2.extras
import logging

from services.database.database import _get_conn, _put_conn, SafeId
from services.database.id_generator import _generator

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/agent", tags=["AI Native Agent API"])


# ----------------------------------------------------------------------
# Copied Task ID Parser
# ----------------------------------------------------------------------
def parse_task_id(identifier: str | int) -> int:
    """
    Extracts 64-bit integer Snowflake ID from multiple formats:
    - Raw integer: 94695191667019776
    - Numeric string: "94695191667019776"
    - Markdown copy from UI: "[Create Feature](#94695191667019776)"
    - Hash prefixed: "#94695191667019776"
    - URL query parameter: "http://.../?taskId=94695191667019776"
    """
    if isinstance(identifier, int):
        return identifier

    cleaned = str(identifier).strip()
    if cleaned.isdigit():
        return int(cleaned)

    # Check for markdown link [Title](#123456) or hash prefix #123456
    hash_match = re.search(r"#(\d+)", cleaned)
    if hash_match:
        return int(hash_match.group(1))

    # Check for taskId= query string
    param_match = re.search(r"taskId=(\d+)", cleaned)
    if param_match:
        return int(param_match.group(1))

    # Check for any contiguous digits of snowflake length (15-20 digits)
    digit_match = re.search(r"\b(\d{15,20})\b", cleaned)
    if digit_match:
        return int(digit_match.group(1))

    raise HTTPException(
        status_code=400,
        detail=f"Could not extract a valid Snowflake Task ID from '{identifier}'. Supported formats: raw ID ('9469...'), '#9469...', or markdown link '[Title](#9469...)'."
    )


# ----------------------------------------------------------------------
# Authentication Dependency via Project API Key
# ----------------------------------------------------------------------
def get_project_by_api_key(
    x_project_key: Optional[str] = Header(None, alias="X-Project-Key"),
    authorization: Optional[str] = Header(None),
    api_key: Optional[str] = Query(None)
) -> dict:
    """
    Authenticates requests using the project's API key.
    Accepts key from 'X-Project-Key' header, 'Authorization: Bearer <key>', or query '?api_key=<key>'.
    """
    token = x_project_key
    if not token and authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:].strip()
        else:
            token = authorization.strip()
    if not token and api_key:
        token = api_key.strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Provide via 'X-Project-Key' header, 'Authorization: Bearer <key>', or '?api_key='."
        )

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, name, gh_repo_url, description, created_at, updated_at "
            "FROM opentask.projects WHERE api_key = %s LIMIT 1;",
            (token,)
        )
        project = cur.fetchone()
        if not project:
            raise HTTPException(
                status_code=401,
                detail="Invalid Project API key. Check Project Settings > AI Agent Access in OpenTask."
            )
        return project
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


# ----------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------
class TaskLookupRequest(BaseModel):
    task_identifier: str = Field(..., description="Copied task string, hash ID, or raw ID")

class AgentTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    weight: Optional[int] = None
    branch_name: Optional[str] = None
    repo_url: Optional[str] = None
    bucket_id: Optional[SafeId] = None
    state: Optional[str] = Field(None, description="Target state: TODO, ONGOING, COMPLETED, etc.")
    bucket_name: Optional[str] = Field(None, description="Target bucket name: 'TODO', 'In Progress', 'Done'")

class AgentTaskMove(BaseModel):
    bucket_id: Optional[SafeId] = None
    state: Optional[str] = None
    bucket_name: Optional[str] = None

class AgentTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    type: Optional[str] = "CODE"
    weight: Optional[int] = 3
    branch_name: Optional[str] = None
    repo_url: Optional[str] = None
    bucket_name: Optional[str] = None
    state: Optional[str] = "TODO"


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------

@router.get("/tasks/{task_identifier}")
def agent_get_task(task_identifier: str, project: dict = Depends(get_project_by_api_key)):
    """
    Get detailed task information by raw ID, hash '#ID', or copied markdown '[Title](#ID)'.
    """
    task_id = parse_task_id(task_identifier)
    project_id = project["id"]

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT 
                t.id, t.project_id, t.bucket_id, t.title, t.description, t.type, t.weight,
                t.branch_name, t.repo_url, t.order_idx, t.last_activity_at, t.created_at,
                b.name AS bucket_name, b.state AS bucket_state,
                u.display_name AS assignee_name, u.gh_username AS assignee_gh_username
            FROM opentask.tasks t
            LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
            LEFT JOIN opentask.users u ON t.lead_assignee_id = u.id
            WHERE t.id = %s AND t.project_id = %s
            LIMIT 1;
            """,
            (task_id, project_id)
        )
        task = cur.fetchone()
        if not task:
            raise HTTPException(
                status_code=404,
                detail=f"Task #{task_id} not found in project '{project['name']}'."
            )

        # Get any linked PR reviews
        cur.execute(
            """
            SELECT id, pr_number, pr_title, pr_url, verdict, feedback, completeness_score, reviewed_at
            FROM opentask.pr_reviews
            WHERE task_id = %s
            ORDER BY reviewed_at DESC LIMIT 5;
            """,
            (task_id,)
        )
        reviews = cur.fetchall()

        # Format SafeIds
        task["id"] = str(task["id"])
        task["project_id"] = str(task["project_id"])
        task["bucket_id"] = str(task["bucket_id"]) if task["bucket_id"] else None
        task["reviews"] = reviews
        return task
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.post("/tasks/lookup")
def agent_lookup_task(req: TaskLookupRequest, project: dict = Depends(get_project_by_api_key)):
    """
    POST equivalent for looking up tasks using a JSON payload containing copied text.
    """
    return agent_get_task(req.task_identifier, project)


@router.get("/tasks")
def agent_list_tasks(
    state: Optional[str] = Query(None, description="Filter by bucket state: TODO, ONGOING, COMPLETED"),
    bucket_id: Optional[int] = Query(None, description="Filter by specific bucket ID"),
    q: Optional[str] = Query(None, description="Search query in title or description"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    project: dict = Depends(get_project_by_api_key)
):
    """
    List tasks in the project with optional state/bucket/keyword filtering.
    """
    project_id = project["id"]
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        where_clauses = ["t.project_id = %s"]
        params = [project_id]

        if bucket_id:
            where_clauses.append("t.bucket_id = %s")
            params.append(bucket_id)

        if state:
            where_clauses.append("UPPER(b.state) = UPPER(%s)")
            params.append(state)

        if q:
            where_clauses.append("(t.title ILIKE %s OR t.description ILIKE %s)")
            params.append(f"%{q}%")
            params.append(f"%{q}%")

        where_sql = " AND ".join(where_clauses)
        params.extend([limit, offset])

        query = f"""
            SELECT 
                t.id, t.project_id, t.bucket_id, t.title, t.type, t.weight,
                t.branch_name, t.repo_url, t.order_idx, t.last_activity_at, t.created_at,
                b.name AS bucket_name, b.state AS bucket_state,
                u.display_name AS assignee_name, u.gh_username AS assignee_gh_username
            FROM opentask.tasks t
            LEFT JOIN opentask.buckets b ON t.bucket_id = b.id
            LEFT JOIN opentask.users u ON t.lead_assignee_id = u.id
            WHERE {where_sql}
            ORDER BY t.order_idx ASC, t.last_activity_at DESC
            LIMIT %s OFFSET %s;
        """
        cur.execute(query, params)
        rows = cur.fetchall()

        for r in rows:
            r["id"] = str(r["id"])
            r["project_id"] = str(r["project_id"])
            r["bucket_id"] = str(r["bucket_id"]) if r["bucket_id"] else None

        return {"tasks": rows, "count": len(rows), "offset": offset, "limit": limit}
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.post("/tasks")
def agent_create_task(req: AgentTaskCreate, project: dict = Depends(get_project_by_api_key)):
    """
    Create a new task directly in the project.
    """
    project_id = project["id"]
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Resolve target bucket
        target_bucket_id = None
        if req.bucket_name:
            cur.execute(
                "SELECT id FROM opentask.buckets WHERE project_id = %s AND UPPER(name) = UPPER(%s) LIMIT 1;",
                (project_id, req.bucket_name)
            )
            b = cur.fetchone()
            if b:
                target_bucket_id = b["id"]

        if not target_bucket_id and req.state:
            cur.execute(
                "SELECT id FROM opentask.buckets WHERE project_id = %s AND UPPER(state) = UPPER(%s) ORDER BY order_idx ASC LIMIT 1;",
                (project_id, req.state)
            )
            b = cur.fetchone()
            if b:
                target_bucket_id = b["id"]

        if not target_bucket_id:
            # Fallback to first non-completed bucket or any bucket
            cur.execute(
                "SELECT id FROM opentask.buckets WHERE project_id = %s AND state != 'COMPLETED' ORDER BY order_idx ASC LIMIT 1;",
                (project_id,)
            )
            b = cur.fetchone()
            if b:
                target_bucket_id = b["id"]
            else:
                cur.execute("SELECT id FROM opentask.buckets WHERE project_id = %s ORDER BY order_idx ASC LIMIT 1;", (project_id,))
                b = cur.fetchone()
                target_bucket_id = b["id"] if b else None

        new_task_id = _generator.generate()
        cur.execute(
            """
            INSERT INTO opentask.tasks (
                id, project_id, bucket_id, title, description, type, weight, branch_name, repo_url, order_idx
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0)
            RETURNING id, project_id, bucket_id, title, description, type, weight, branch_name, repo_url, created_at;
            """,
            (new_task_id, project_id, target_bucket_id, req.title.strip(), req.description, req.type, req.weight or 3, req.branch_name, req.repo_url)
        )
        task = cur.fetchone()
        conn.commit()

        task["id"] = str(task["id"])
        task["project_id"] = str(task["project_id"])
        task["bucket_id"] = str(task["bucket_id"]) if task["bucket_id"] else None
        return task
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.post("/tasks/{task_identifier}/complete")
def agent_mark_task_complete(task_identifier: str, project: dict = Depends(get_project_by_api_key)):
    """
    Mark a task as complete by automatically moving it to the project's COMPLETED bucket.
    """
    task_id = parse_task_id(task_identifier)
    project_id = project["id"]

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 1. Find the project's COMPLETED bucket
        cur.execute(
            "SELECT id, name, state FROM opentask.buckets WHERE project_id = %s AND state = 'COMPLETED' LIMIT 1;",
            (project_id,)
        )
        comp_bucket = cur.fetchone()
        if not comp_bucket:
            # Create a COMPLETED bucket if none exists
            comp_bucket_id = _generator.generate()
            cur.execute(
                """
                INSERT INTO opentask.buckets (id, project_id, name, state, order_idx)
                VALUES (%s, %s, 'Done', 'COMPLETED', 99)
                RETURNING id, name, state;
                """,
                (comp_bucket_id, project_id)
            )
            comp_bucket = cur.fetchone()

        target_bucket_id = comp_bucket["id"]

        # 2. Update task
        cur.execute(
            """
            UPDATE opentask.tasks
            SET bucket_id = %s, last_activity_at = NOW()
            WHERE id = %s AND project_id = %s
            RETURNING id, project_id, bucket_id, title, description, type, weight, branch_name, repo_url;
            """,
            (target_bucket_id, task_id, project_id)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Task #{task_id} not found in this project")

        conn.commit()

        row["id"] = str(row["id"])
        row["project_id"] = str(row["project_id"])
        row["bucket_id"] = str(row["bucket_id"])
        row["status"] = "COMPLETED"
        row["bucket_name"] = comp_bucket["name"]
        return {
            "message": f"Task #{task_id} ('{row['title']}') marked as COMPLETED.",
            "task": row
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.post("/tasks/{task_identifier}/move")
def agent_move_task(task_identifier: str, move_req: AgentTaskMove, project: dict = Depends(get_project_by_api_key)):
    """
    Move task to a target bucket specified by bucket_id, bucket_name, or state (TODO, ONGOING, COMPLETED).
    """
    task_id = parse_task_id(task_identifier)
    project_id = project["id"]

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        target_bucket = None
        if move_req.bucket_id:
            cur.execute(
                "SELECT id, name, state FROM opentask.buckets WHERE id = %s AND project_id = %s LIMIT 1;",
                (int(move_req.bucket_id), project_id)
            )
            target_bucket = cur.fetchone()

        if not target_bucket and move_req.state:
            cur.execute(
                "SELECT id, name, state FROM opentask.buckets WHERE project_id = %s AND UPPER(state) = UPPER(%s) LIMIT 1;",
                (project_id, move_req.state)
            )
            target_bucket = cur.fetchone()

        if not target_bucket and move_req.bucket_name:
            cur.execute(
                "SELECT id, name, state FROM opentask.buckets WHERE project_id = %s AND UPPER(name) = UPPER(%s) LIMIT 1;",
                (project_id, move_req.bucket_name)
            )
            target_bucket = cur.fetchone()

        if not target_bucket:
            raise HTTPException(
                status_code=400,
                detail="Could not resolve target bucket. Provide valid bucket_id, bucket_name, or state."
            )

        cur.execute(
            """
            UPDATE opentask.tasks
            SET bucket_id = %s, last_activity_at = NOW()
            WHERE id = %s AND project_id = %s
            RETURNING id, project_id, bucket_id, title;
            """,
            (target_bucket["id"], task_id, project_id)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found in this project")

        conn.commit()
        return {
            "message": f"Task #{task_id} moved to '{target_bucket['name']}' ({target_bucket['state']}).",
            "task_id": str(task_id),
            "new_bucket_id": str(target_bucket["id"]),
            "new_bucket_name": target_bucket["name"],
            "new_bucket_state": target_bucket["state"]
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.patch("/tasks/{task_identifier}")
def agent_update_task(task_identifier: str, update_req: AgentTaskUpdate, project: dict = Depends(get_project_by_api_key)):
    """
    Update task details (title, description, weight, branch_name, repo_url, or bucket).
    """
    task_id = parse_task_id(task_identifier)
    project_id = project["id"]

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        updates = []
        params = []

        if update_req.title is not None:
            updates.append("title = %s")
            params.append(update_req.title.strip())

        if update_req.description is not None:
            updates.append("description = %s")
            params.append(update_req.description.strip())

        if update_req.weight is not None:
            updates.append("weight = %s")
            params.append(update_req.weight)

        if update_req.branch_name is not None:
            updates.append("branch_name = %s")
            params.append(update_req.branch_name.strip())

        if update_req.repo_url is not None:
            updates.append("repo_url = %s")
            params.append(update_req.repo_url.strip())

        # Target bucket resolution
        target_bucket_id = None
        if update_req.bucket_id:
            target_bucket_id = int(update_req.bucket_id)
        elif update_req.state:
            cur.execute(
                "SELECT id FROM opentask.buckets WHERE project_id = %s AND UPPER(state) = UPPER(%s) LIMIT 1;",
                (project_id, update_req.state)
            )
            b = cur.fetchone()
            if b:
                target_bucket_id = b["id"]
        elif update_req.bucket_name:
            cur.execute(
                "SELECT id FROM opentask.buckets WHERE project_id = %s AND UPPER(name) = UPPER(%s) LIMIT 1;",
                (project_id, update_req.bucket_name)
            )
            b = cur.fetchone()
            if b:
                target_bucket_id = b["id"]

        if target_bucket_id is not None:
            updates.append("bucket_id = %s")
            params.append(target_bucket_id)

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update provided")

        updates.append("last_activity_at = NOW()")
        set_sql = ", ".join(updates)
        params.extend([task_id, project_id])

        cur.execute(
            f"""
            UPDATE opentask.tasks
            SET {set_sql}
            WHERE id = %s AND project_id = %s
            RETURNING id, project_id, bucket_id, title, description, type, weight, branch_name, repo_url, last_activity_at;
            """,
            params
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found in this project")

        conn.commit()

        row["id"] = str(row["id"])
        row["project_id"] = str(row["project_id"])
        row["bucket_id"] = str(row["bucket_id"]) if row["bucket_id"] else None
        return row
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.get("/summary")
def agent_get_project_summary(project: dict = Depends(get_project_by_api_key)):
    """
    Generate an AI-native project summary with metrics, bucket counts, active tasks,
    recent PR reviews, and a ready-to-inject Markdown summary for Code Agents.
    """
    project_id = project["id"]
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 1. Bucket distribution & counts
        cur.execute(
            """
            SELECT b.id, b.name, b.state, b.order_idx, COUNT(t.id) AS task_count
            FROM opentask.buckets b
            LEFT JOIN opentask.tasks t ON b.id = t.bucket_id
            WHERE b.project_id = %s
            GROUP BY b.id, b.name, b.state, b.order_idx
            ORDER BY b.order_idx ASC;
            """,
            (project_id,)
        )
        buckets = cur.fetchall()

        total_tasks = sum(b["task_count"] for b in buckets)
        completed_tasks = sum(b["task_count"] for b in buckets if b["state"] == "COMPLETED")
        ongoing_tasks = sum(b["task_count"] for b in buckets if b["state"] == "ONGOING")
        todo_tasks = sum(b["task_count"] for b in buckets if b["state"] in ("TODO", "PENDING", "DRAFT"))

        progress_pct = round((completed_tasks / max(total_tasks, 1)) * 100)

        # 2. Key / High Weight / Ongoing Tasks
        cur.execute(
            """
            SELECT t.id, t.title, t.type, t.weight, t.branch_name, b.name AS bucket_name, b.state AS bucket_state
            FROM opentask.tasks t
            JOIN opentask.buckets b ON t.bucket_id = b.id
            WHERE t.project_id = %s AND b.state != 'COMPLETED'
            ORDER BY t.weight DESC, t.order_idx ASC
            LIMIT 15;
            """,
            (project_id,)
        )
        active_tasks = cur.fetchall()

        # 3. Recent PR Reviews
        cur.execute(
            """
            SELECT pr_number, pr_title, pr_url, verdict, completeness_score, reviewed_at
            FROM opentask.pr_reviews
            WHERE project_id = %s
            ORDER BY reviewed_at DESC LIMIT 5;
            """,
            (project_id,)
        )
        pr_reviews = cur.fetchall()

        # 4. Generate formatted Markdown summary for Code Agents
        lines = [
            f"# Project Summary: {project['name']}",
            f"**Description**: {project.get('description') or 'No description'}",
            f"**Connected Repositories**: {', '.join(project.get('gh_repo_url') or ['None'])}",
            "",
            f"## Pipeline Status ({progress_pct}% Complete)",
            f"- **Total Tasks**: {total_tasks}",
            f"- **Completed**: {completed_tasks}",
            f"- **In Progress (Ongoing)**: {ongoing_tasks}",
            f"- **Backlog / To-Do**: {todo_tasks}",
            "",
            "### Column Breakdown:"
        ]
        for b in buckets:
            lines.append(f"- **{b['name']}** (`{b['state']}`): {b['task_count']} tasks")

        lines.extend(["", "### Top Active Tasks:"])
        if active_tasks:
            for t in active_tasks:
                lines.append(f"- `#{t['id']}` **{t['title']}** [{t['type']} | Weight: {t['weight']}] in *{t['bucket_name']}*")
        else:
            lines.append("- *No active tasks remaining in pipeline!*")

        if pr_reviews:
            lines.extend(["", "### Recent PR Reviews:"])
            for pr in pr_reviews:
                lines.append(f"- PR #{pr['pr_number']}: [{pr['verdict']}] {pr.get('pr_title') or ''} ({pr.get('completeness_score', 0)}% score)")

        markdown_summary = "\n".join(lines)

        return {
            "project_id": str(project_id),
            "project_name": project["name"],
            "progress_percentage": progress_pct,
            "metrics": {
                "total": total_tasks,
                "completed": completed_tasks,
                "ongoing": ongoing_tasks,
                "todo": todo_tasks
            },
            "buckets": [
                {
                    "id": str(b["id"]),
                    "name": b["name"],
                    "state": b["state"],
                    "task_count": b["task_count"]
                }
                for b in buckets
            ],
            "active_tasks": [
                {
                    "id": str(t["id"]),
                    "title": t["title"],
                    "type": t["type"],
                    "weight": t["weight"],
                    "branch_name": t.get("branch_name"),
                    "bucket_name": t["bucket_name"],
                    "bucket_state": t["bucket_state"]
                }
                for t in active_tasks
            ],
            "recent_reviews": pr_reviews,
            "markdown_summary": markdown_summary
        }
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)
