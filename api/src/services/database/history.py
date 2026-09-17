from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, Depends
import psycopg2
import psycopg2.extras

from services.database.database import _get_conn, _put_conn, router as db_router, SafeId
from services.database.id_generator import _generator
from routers.auth import get_current_user_optional

history_router = APIRouter(tags=["history"])


class DatabaseProjectHistory(BaseModel):
    id: Optional[SafeId] = None
    project_id: SafeId
    user_id: Optional[SafeId] = None
    user_name: Optional[str] = None
    event_type: str  # 'TASK_CREATED', 'TASK_COMPLETED', 'TASK_MOVED', 'TASK_UPDATED', 'TASK_DELETED', 'MEMBER_ADDED', 'MEMBER_REMOVED'
    entity_type: str  # 'TASK', 'BUCKET', 'MEMBER', 'PROJECT'
    entity_id: Optional[SafeId] = None
    description: str
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None


def init_project_history_table():
    """Ensure opentask.project_history table and indexes exist without blocking FK constraint on user_id."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS opentask.project_history (
                id BIGINT PRIMARY KEY,
                project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
                user_id BIGINT,
                user_name TEXT,
                event_type TEXT NOT NULL,
                entity_type TEXT NOT NULL DEFAULT 'TASK',
                entity_id BIGINT,
                description TEXT NOT NULL,
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            ALTER TABLE opentask.project_history DROP CONSTRAINT IF EXISTS project_history_user_id_fkey;
            CREATE INDEX IF NOT EXISTS idx_project_history_project_id ON opentask.project_history(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_history_created_at ON opentask.project_history(created_at);
            CREATE INDEX IF NOT EXISTS idx_project_history_proj_created ON opentask.project_history(project_id, created_at DESC);
            """
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[WARN] Error initializing project_history table: {e}")
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


def resolve_user_info(
    cur,
    current_user: Optional[dict] = None,
    fallback_user_id: Optional[int | str] = None,
) -> tuple[Optional[int], str]:
    """
    Resolve (db_user_id, clean_user_name) given a FastAPI current_user dict (from GitHub OAuth)
    or a fallback user ID (e.g. task assignee).
    """
    user_id = None
    user_name = None

    if current_user and isinstance(current_user, dict):
        gh_login = current_user.get("login") or current_user.get("gh_username")
        gh_id = str(current_user.get("id")) if current_user.get("id") is not None else None
        gh_name = current_user.get("name") or current_user.get("display_name")

        # Try to find corresponding user record in opentask.users
        try:
            if gh_id or gh_login:
                cur.execute(
                    "SELECT id, gh_username, display_name FROM opentask.users WHERE gh_id = %s OR gh_username = %s LIMIT 1;",
                    (gh_id, gh_login),
                )
                u = cur.fetchone()
                if u:
                    user_id = u["id"]
                    user_name = u.get("gh_username") or u.get("display_name")
        except Exception:
            pass

        if not user_name:
            user_name = gh_login or gh_name

    if not user_name and fallback_user_id:
        try:
            cur.execute(
                "SELECT id, gh_username, display_name FROM opentask.users WHERE id = %s LIMIT 1;",
                (fallback_user_id,),
            )
            u = cur.fetchone()
            if u:
                user_id = u["id"]
                user_name = u.get("gh_username") or u.get("display_name")
        except Exception:
            pass

    return user_id, user_name or "Team Member"


def record_project_event(
    project_id: int | str,
    user_name: Optional[str],
    action: str,
    target: str,
    event_type: str,
    entity_type: str = "TASK",
    entity_id: Optional[int | str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    user_id: Optional[int | str] = None,
    created_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Log an event into both opentask.project_history and opentask.activities.
    """
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        clean_user_name = user_name or "Team Member"
        description = f"{clean_user_name} {action} {target}".strip()
        hist_id = _generator.generate()
        act_id = _generator.generate()
        now_ts = created_at or datetime.now(timezone.utc)
        meta_json = psycopg2.extras.Json(metadata or {})

        # 1. Insert into opentask.project_history
        cur.execute(
            """
            INSERT INTO opentask.project_history 
                (id, project_id, user_id, user_name, event_type, entity_type, entity_id, description, metadata, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, project_id, user_id, user_name, event_type, entity_type, entity_id, description, metadata, created_at;
            """,
            (
                hist_id,
                int(project_id),
                int(user_id) if user_id else None,
                clean_user_name,
                event_type,
                entity_type,
                int(entity_id) if entity_id else None,
                description,
                meta_json,
                now_ts,
            ),
        )
        hist_row = cur.fetchone()

        # 2. Insert into opentask.activities for feed compatibility
        cur.execute(
            """
            INSERT INTO opentask.activities (id, project_id, user_name, action, target, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, project_id, user_name, action, target, created_at;
            """,
            (act_id, int(project_id), clean_user_name, action, target, now_ts),
        )
        act_row = cur.fetchone()

        conn.commit()
        return hist_row or act_row
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Failed to record project event: {e}")
        return {}
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.get("/projects/{project_id}/activities/timeline")
def get_project_activities_timeline(
    project_id: SafeId,
    interval: str = Query("7d", description="Interval: 1d, 3d, 7d, 1m, 3m, 6m, 12m, 5y, custom"),
    start_date: Optional[str] = Query(None, description="ISO timestamp for start range"),
    end_date: Optional[str] = Query(None, description="ISO timestamp for end range"),
):
    """
    Returns time-bucketed activity counts and activities for interactive Line Chart visualization.
    X-axis: time buckets, Y-axis: activity count.
    """
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        now = datetime.now(timezone.utc)
        clean_interval = interval.lower().strip()

        # Determine start time and bucket duration based on interval
        if clean_interval == "1d":
            time_span = timedelta(days=1)
            num_buckets = 24  # 1 hour each
            bucket_delta = timedelta(hours=1)
            date_format = "%H:00"
            default_start = now - time_span
        elif clean_interval == "3d":
            time_span = timedelta(days=3)
            num_buckets = 12  # 6 hours each
            bucket_delta = timedelta(hours=6)
            date_format = "%b %d %H:00"
            default_start = now - time_span
        elif clean_interval == "7d":
            time_span = timedelta(days=7)
            num_buckets = 7  # 1 day each
            bucket_delta = timedelta(days=1)
            date_format = "%b %d"
            default_start = now - time_span
        elif clean_interval in ("1m", "30d"):
            time_span = timedelta(days=30)
            num_buckets = 30  # 1 day each
            bucket_delta = timedelta(days=1)
            date_format = "%b %d"
            default_start = now - time_span
        elif clean_interval in ("3m", "90d"):
            time_span = timedelta(days=90)
            num_buckets = 13  # 1 week each
            bucket_delta = timedelta(days=7)
            date_format = "%b %d"
            default_start = now - time_span
        elif clean_interval in ("6m", "180d"):
            time_span = timedelta(days=180)
            num_buckets = 12  # ~15 days each
            bucket_delta = timedelta(days=15)
            date_format = "%b %d"
            default_start = now - time_span
        elif clean_interval in ("12m", "1y", "365d"):
            time_span = timedelta(days=365)
            num_buckets = 12  # 1 month each
            bucket_delta = timedelta(days=30)
            date_format = "%b %Y"
            default_start = now - time_span
        elif clean_interval in ("5y", "5yr"):
            time_span = timedelta(days=365 * 5)
            num_buckets = 20  # quarterly each (91 days)
            bucket_delta = timedelta(days=91)
            date_format = "%b %Y"
            default_start = now - time_span
        else:
            time_span = timedelta(days=7)
            num_buckets = 7
            bucket_delta = timedelta(days=1)
            date_format = "%b %d"
            default_start = now - time_span

        range_start = (
            datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            if (start_date and isinstance(start_date, str))
            else default_start
        )
        range_end = (
            datetime.fromisoformat(end_date.replace("Z", "+00:00"))
            if (end_date and isinstance(end_date, str))
            else now
        )

        # Fetch activities within range
        cur.execute(
            """
            SELECT id, user_name, action, target, created_at 
            FROM opentask.activities 
            WHERE project_id = %s AND created_at >= %s AND created_at <= %s
            ORDER BY created_at ASC;
            """,
            (int(project_id), range_start, range_end),
        )
        activities = cur.fetchall()

        # Build uniform time buckets
        buckets = []
        curr_time = range_start
        for i in range(num_buckets):
            next_time = curr_time + bucket_delta
            if i == num_buckets - 1:
                next_time = max(next_time, range_end)

            label = curr_time.strftime(date_format)
            buckets.append({
                "timestamp": curr_time.isoformat(),
                "end_timestamp": next_time.isoformat(),
                "label": label,
                "count": 0,
                "activities": [],
            })
            curr_time = next_time

        # Distribute activities into appropriate buckets
        for act in activities:
            act_time = act["created_at"]
            if act_time.tzinfo is None:
                act_time = act_time.replace(tzinfo=timezone.utc)

            user_name = act.get("user_name") or "System"
            formatted_act = {
                "id": str(act["id"]),
                "user_name": user_name,
                "action": act.get("action") or "updated",
                "target": act.get("target") or "",
                "created_at": act["created_at"].isoformat(),
                "avatar_url": f"https://github.com/{user_name}.png?size=64" if user_name and not user_name.startswith("User #") else None,
            }

            placed = False
            for b in buckets:
                b_start = datetime.fromisoformat(b["timestamp"])
                b_end = datetime.fromisoformat(b["end_timestamp"])
                if b_start <= act_time < b_end:
                    b["count"] += 1
                    b["activities"].append(formatted_act)
                    placed = True
                    break

            if not placed and buckets:
                # If right on border or end, add to last bucket
                buckets[-1]["count"] += 1
                buckets[-1]["activities"].append(formatted_act)

        # Cleanup internal end_timestamp from output
        for b in buckets:
            b.pop("end_timestamp", None)

        total_activities = sum(b["count"] for b in buckets)
        peak_count = max((b["count"] for b in buckets), default=0)

        return {
            "interval": clean_interval,
            "range_start": range_start.isoformat(),
            "range_end": range_end.isoformat(),
            "total_activities": total_activities,
            "peak_count": peak_count,
            "buckets": buckets,
        }
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.get("/projects/{project_id}/history")
def get_project_history(
    project_id: SafeId,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Returns audit history events for a project with metadata and user details.
    """
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        actual_limit = int(limit) if isinstance(limit, (int, str)) and str(limit).isdigit() else 50
        actual_offset = int(offset) if isinstance(offset, (int, str)) and str(offset).isdigit() else 0

        cur.execute(
            """
            SELECT id, project_id, user_id, user_name, event_type, entity_type, entity_id, description, metadata, created_at
            FROM opentask.project_history
            WHERE project_id = %s
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s;
            """,
            (int(project_id), actual_limit, actual_offset),
        )
        history = cur.fetchall()

        cur.execute(
            "SELECT COUNT(*) AS total FROM opentask.project_history WHERE project_id = %s;",
            (int(project_id),),
        )
        total = cur.fetchone()["total"]

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": history,
        }
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)
