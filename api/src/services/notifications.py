import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import psycopg2
import psycopg2.extras
from pywebpush import webpush, WebPushException

from config import settings
from services.database.database import _get_conn, _put_conn
from services.database.id_generator import _generator

logger = logging.getLogger("uvicorn.error")


def init_push_notifications_table():
    """Ensure opentask.push_subscriptions table and indexes exist."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS opentask.push_subscriptions (
                id BIGINT PRIMARY KEY,
                user_id BIGINT REFERENCES opentask.users(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_push_sub_user_id ON opentask.push_subscriptions(user_id);
            """
        )
        conn.commit()
        logger.info("[NOTIFICATIONS] opentask.push_subscriptions initialized.")
    except Exception as e:
        conn.rollback()
        logger.warning(f"[NOTIFICATIONS] Error initializing push_subscriptions table: {e}")
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


def save_push_subscription(
    user_id: Optional[int | str],
    endpoint: str,
    p256dh: str,
    auth: str,
) -> Dict[str, Any]:
    """Store or update browser Web Push subscription."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        sub_id = _generator.generate()
        parsed_user_id = int(user_id) if user_id else None

        query = """
            INSERT INTO opentask.push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (endpoint) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth,
                updated_at = NOW()
            RETURNING id, user_id, endpoint, created_at;
        """
        cur.execute(query, (sub_id, parsed_user_id, endpoint, p256dh, auth))
        row = cur.fetchone()
        conn.commit()
        return dict(row) if row else {}
    except Exception as e:
        conn.rollback()
        logger.error(f"[NOTIFICATIONS] Error saving push subscription: {e}")
        raise
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


def delete_push_subscription(endpoint: str):
    """Remove expired or unsubscribed endpoint."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM opentask.push_subscriptions WHERE endpoint = %s;", (endpoint,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.warning(f"[NOTIFICATIONS] Failed to delete push subscription: {e}")
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


def send_push_notification(
    user_id: int | str,
    title: str,
    body: str,
    url: str = "/",
    tag: str = "alert",
    icon: str = "/logo.svg",
) -> tuple[int, int]:
    """
    Send Web Push notification to all active browser subscriptions of a specific user.
    Returns a tuple of (delivered_count, total_subscriptions).
    """
    conn = _get_conn()
    cur = None
    subscriptions: List[Dict[str, Any]] = []
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, endpoint, p256dh, auth FROM opentask.push_subscriptions WHERE user_id = %s;",
            (int(user_id),),
        )
        subscriptions = cur.fetchall()
    except Exception as e:
        conn.rollback()
        logger.error(f"[NOTIFICATIONS] Error fetching push subscriptions for user {user_id}: {e}")
        return 0, 0
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)

    if not subscriptions:
        logger.info(f"[NOTIFICATIONS] No active push subscriptions for user {user_id}.")
        return 0, 0

    payload = json.dumps({
        "title": title,
        "body": body,
        "url": url,
        "tag": tag,
        "icon": icon,
    })

    sent_count = 0

    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub["endpoint"],
            "keys": {
                "p256dh": sub["p256dh"],
                "auth": sub["auth"],
            },
        }

        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_claim_email},
                ttl=3600,
            )
            sent_count += 1
            logger.info(f"[NOTIFICATIONS] Push sent successfully to endpoint {sub['endpoint'][:30]}...")
        except WebPushException as ex:
            logger.warning(f"[NOTIFICATIONS] WebPushException ({ex}): {ex.response.status_code if ex.response else ''}")
            # If endpoint is 404 Not Found or 410 Gone, user unsubscribed or registration expired
            if ex.response is not None and ex.response.status_code in (404, 410):
                logger.info(f"[NOTIFICATIONS] Pruning expired subscription: {sub['endpoint'][:30]}...")
                delete_push_subscription(sub["endpoint"])
        except Exception as err:
            logger.error(f"[NOTIFICATIONS] Unexpected error sending push: {err}")

    return sent_count, len(subscriptions)


def notify_task_assigned(
    task_title: str,
    assignee_id: int | str,
    project_id: int | str,
    project_name: Optional[str] = None,
    task_id: Optional[int | str] = None,
):
    """
    Trigger both a persistent DB Alert in opentask.alerts AND a Web Push notification
    when a task is assigned to a user.
    """
    conn = _get_conn()
    cur = None
    resolved_project_name = project_name
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if not resolved_project_name:
            cur.execute("SELECT name FROM opentask.projects WHERE id = %s LIMIT 1;", (int(project_id),))
            p_row = cur.fetchone()
            if p_row:
                resolved_project_name = p_row.get("name")

        proj_text = f" in {resolved_project_name}" if resolved_project_name else ""
        alert_title = f"Task Assigned: {task_title}"
        alert_body = f'You were assigned to "{task_title}"{proj_text}.'

        alert_id = _generator.generate()
        cur.execute(
            """
            INSERT INTO opentask.alerts (
                id, user_id, context_id, project_id, title, description,
                type, severity, suggested_actions, is_resolved, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, FALSE, NOW(), NOW()
            );
            """,
            (
                alert_id,
                int(assignee_id),
                int(task_id) if task_id else int(project_id),
                int(project_id),
                alert_title,
                alert_body,
                "TASK_ASSIGNED",
                "info",
                ["View Task", "Go to Project"],
            ),
        )
        conn.commit()
        logger.info(f"[NOTIFICATIONS] Persistent alert {alert_id} created for assignee {assignee_id}.")
    except Exception as db_err:
        if conn:
            conn.rollback()
        logger.warning(f"[NOTIFICATIONS] Failed to record task assigned alert in DB: {db_err}")
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)

    # Dispatch Web Push
    proj_text = f" in {resolved_project_name}" if resolved_project_name else ""
    title = "🔔 Task Assigned"
    body = f'You were assigned to "{task_title}"{proj_text}.'
    url = f"/projects/{project_id}"
    try:
        send_push_notification(
            user_id=assignee_id,
            title=title,
            body=body,
            url=url,
            tag=f"task-assigned-{project_id}",
        )
    except Exception as e:
        logger.warning(f"[NOTIFICATIONS] Failed to trigger task assigned push: {e}")
