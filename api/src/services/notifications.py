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
    assigned_by_name: Optional[str] = None,
):
    """
    Trigger both a persistent DB Alert in opentask.alerts AND a Web Push notification
    when a task is assigned to a user, displaying who assigned the user.
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
        by_text = f" by {assigned_by_name}" if assigned_by_name else ""
        alert_title = f"Task Assigned: {task_title}"
        alert_body = f'You were assigned to "{task_title}"{by_text}{proj_text}.'

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

    # Dispatch Web Push with direct task link
    proj_text = f" in {resolved_project_name}" if resolved_project_name else ""
    by_text = f" by {assigned_by_name}" if assigned_by_name else ""
    title = "🔔 Task Assigned"
    body = f'You were assigned to "{task_title}"{by_text}{proj_text}.'
    url = f"/projects/{project_id}?taskId={task_id}" if task_id else f"/projects/{project_id}"
    try:
        send_push_notification(
            user_id=assignee_id,
            title=title,
            body=body,
            url=url,
            tag=f"task-assigned-{task_id or project_id}",
        )
    except Exception as e:
        logger.warning(f"[NOTIFICATIONS] Failed to trigger task assigned push: {e}")


def notify_task_unassigned(
    task_title: str,
    unassigned_user_id: int | str,
    project_id: int | str,
    project_name: Optional[str] = None,
    task_id: Optional[int | str] = None,
    unassigned_by_name: Optional[str] = None,
):
    """
    Trigger both a persistent DB Alert AND a Web Push notification
    when a user is unassigned from a task, displaying who unassigned them.
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
        by_text = f" by {unassigned_by_name}" if unassigned_by_name else ""
        alert_title = f"Task Unassigned: {task_title}"
        alert_body = f'You were unassigned from "{task_title}"{by_text}{proj_text}.'

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
                int(unassigned_user_id),
                int(task_id) if task_id else int(project_id),
                int(project_id),
                alert_title,
                alert_body,
                "TASK_UNASSIGNED",
                "info",
                ["View Task", "Go to Project"],
            ),
        )
        conn.commit()
        logger.info(f"[NOTIFICATIONS] Persistent unassigned alert {alert_id} created for user {unassigned_user_id}.")
    except Exception as db_err:
        if conn:
            conn.rollback()
        logger.warning(f"[NOTIFICATIONS] Failed to record task unassigned alert in DB: {db_err}")
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)

    # Dispatch Web Push with direct task link
    proj_text = f" in {resolved_project_name}" if resolved_project_name else ""
    by_text = f" by {unassigned_by_name}" if unassigned_by_name else ""
    title = "ℹ️ Task Unassigned"
    body = f'You were unassigned from "{task_title}"{by_text}{proj_text}.'
    url = f"/projects/{project_id}?taskId={task_id}" if task_id else f"/projects/{project_id}"
    try:
        send_push_notification(
            user_id=unassigned_user_id,
            title=title,
            body=body,
            url=url,
            tag=f"task-unassigned-{task_id or project_id}",
        )
    except Exception as e:
        logger.warning(f"[NOTIFICATIONS] Failed to trigger task unassigned push: {e}")


def notify_task_completed(
    task_title: str,
    project_id: int | str,
    actor_name: Optional[str] = None,
    task_id: Optional[int | str] = None,
    assignee_id: Optional[int | str] = None,
    extra_user_ids: Optional[List[int | str]] = None,
):
    """
    Trigger alert and push notification when a task is marked as COMPLETED.
    """
    target_users = set()
    if assignee_id:
        target_users.add(int(assignee_id))
    if extra_user_ids:
        for u in extra_user_ids:
            if u:
                target_users.add(int(u))

    title = "✅ Task Completed"
    by_text = f" by {actor_name}" if actor_name else ""
    body = f'"{task_title}" has been marked as COMPLETED{by_text}.'
    url = f"/projects/{project_id}?taskId={task_id}" if task_id else f"/projects/{project_id}"

    for uid in target_users:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor()
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
                    uid,
                    int(task_id) if task_id else int(project_id),
                    int(project_id),
                    f"Task Completed: {task_title}",
                    body,
                    "TASK_COMPLETED",
                    "info",
                    ["View Task", "Go to Project"],
                )
            )
            conn.commit()
        except Exception as err:
            if conn:
                conn.rollback()
            logger.warning(f"[NOTIFICATIONS] Failed to save task completed alert: {err}")
        finally:
            if cur:
                cur.close()
            _put_conn(conn)

        try:
            send_push_notification(
                user_id=uid,
                title=title,
                body=body,
                url=url,
                tag=f"task-completed-{task_id or project_id}",
            )
        except Exception as e:
            logger.warning(f"[NOTIFICATIONS] Failed to send task completed push: {e}")


def notify_task_reopened(
    task_title: str,
    project_id: int | str,
    actor_name: Optional[str] = None,
    task_id: Optional[int | str] = None,
    assignee_id: Optional[int | str] = None,
    extra_user_ids: Optional[List[int | str]] = None,
):
    """
    Trigger alert and push notification when a task's completed status is reverted.
    """
    target_users = set()
    if assignee_id:
        target_users.add(int(assignee_id))
    if extra_user_ids:
        for u in extra_user_ids:
            if u:
                target_users.add(int(u))

    title = "🔄 Task Reopened"
    by_text = f" by {actor_name}" if actor_name else ""
    body = f'"{task_title}" completed status was reverted{by_text}.'
    url = f"/projects/{project_id}?taskId={task_id}" if task_id else f"/projects/{project_id}"

    for uid in target_users:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor()
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
                    uid,
                    int(task_id) if task_id else int(project_id),
                    int(project_id),
                    f"Task Reopened: {task_title}",
                    body,
                    "TASK_REOPENED",
                    "info",
                    ["View Task", "Go to Project"],
                )
            )
            conn.commit()
        except Exception as err:
            if conn:
                conn.rollback()
            logger.warning(f"[NOTIFICATIONS] Failed to save task reopened alert: {err}")
        finally:
            if cur:
                cur.close()
            _put_conn(conn)

        try:
            send_push_notification(
                user_id=uid,
                title=title,
                body=body,
                url=url,
                tag=f"task-reopened-{task_id or project_id}",
            )
        except Exception as e:
            logger.warning(f"[NOTIFICATIONS] Failed to send task reopened push: {e}")


def notify_pr_reviewed(
    task_title: str,
    assignee_id: Optional[int | str],
    verdict: str,
    pr_url: str,
    pr_number: int,
    project_id: Optional[int | str] = None,
    extra_user_ids: Optional[List[int | str]] = None,
    task_id: Optional[int | str] = None,
):
    """
    Trigger a Web Push notification when an AI PR review verdict is ready.
    The notification click redirects the user to the task or PR on GitHub.
    Sends to assignee and any extra_user_ids (e.g. PR author, PMs).
    """
    verdict_icon = "✅" if verdict == "PASS" else "❌"
    verdict_label = "PASSED" if verdict == "PASS" else "FAILED"

    title = f"{verdict_icon} PR Review: {verdict_label}"
    body = f'AI review for "{task_title}" — PR #{pr_number} {verdict_label}. Tap to view.'
    direct_url = f"/projects/{project_id}?taskId={task_id}" if (project_id and task_id) else pr_url

    all_users = set()
    if assignee_id:
        all_users.add(int(assignee_id))
    if extra_user_ids:
        for u in extra_user_ids:
            if u:
                all_users.add(int(u))

    for uid in all_users:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor()
            alert_id = _generator.generate()
            cur.execute(
                """
                INSERT INTO opentask.alerts
                    (id, user_id, context_id, project_id, title, description, type, severity, suggested_actions, is_resolved, pr_url)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s);
                """,
                (
                    alert_id,
                    uid,
                    int(task_id) if task_id else (int(project_id) if project_id else uid),
                    int(project_id) if project_id else None,
                    title,
                    body,
                    "PR_REVIEWED",
                    "info" if verdict == "PASS" else "warning",
                    ["View Task", "View PR on GitHub"],
                    pr_url,
                )
            )
            conn.commit()
            logger.info(f"[NOTIFICATIONS] PR review alert {alert_id} created for user {uid}.")
        except Exception as db_err:
            if conn:
                conn.rollback()
            logger.warning(f"[NOTIFICATIONS] Failed to record PR review alert for {uid}: {db_err}")
        finally:
            if cur is not None:
                cur.close()
            _put_conn(conn)

        try:
            send_push_notification(
                user_id=uid,
                title=title,
                body=body,
                url=direct_url,
                tag=f"pr-review-{pr_number}",
            )
        except Exception as e:
            logger.warning(f"[NOTIFICATIONS] Failed to trigger PR review push to {uid}: {e}")


def notify_pr_opened(
    pr_number: int,
    pr_title: str,
    pr_url: str,
    author_gh: str,
    repo_full_name: str,
    target_user_ids: List[int | str],
    project_id: Optional[int | str] = None,
    matched_task_title: Optional[str] = None,
):
    """
    Notify related users (project managers, assignees) that a new PR was opened.
    Dispatches Web Push (clicking redirects to the GitHub PR) and records persistent alerts.
    """
    task_info = f' for "{matched_task_title}"' if matched_task_title else ""
    title = f"📢 New PR #{pr_number}: {pr_title[:40]}"
    body = f"@{author_gh} opened a PR in {repo_full_name}{task_info}. Tap to review."

    unique_user_ids = list({int(uid) for uid in target_user_ids if uid})
    for uid in unique_user_ids:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor()
            alert_id = _generator.generate()
            cur.execute(
                """
                INSERT INTO opentask.alerts
                    (id, user_id, context_id, project_id, title, description, type, severity, suggested_actions, is_resolved)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE);
                """,
                (
                    alert_id,
                    uid,
                    int(project_id) if project_id else uid,
                    int(project_id) if project_id else None,
                    title,
                    body,
                    "PR_OPENED",
                    "info",
                    ["View PR on GitHub"],
                )
            )
            conn.commit()
        except Exception as err:
            if conn:
                conn.rollback()
            logger.warning(f"[NOTIFICATIONS] Failed to create PR_OPENED alert: {err}")
        finally:
            if cur is not None:
                cur.close()
            _put_conn(conn)

        try:
            send_push_notification(
                user_id=uid,
                title=title,
                body=body,
                url=pr_url,
                tag=f"pr-opened-{pr_number}",
            )
        except Exception as e:
            logger.warning(f"[NOTIFICATIONS] Failed to trigger PR opened push to {uid}: {e}")


def notify_pr_comment(
    pr_number: int,
    pr_title: str,
    pr_url: str,
    commenter_gh: str,
    comment_body: str,
    target_user_ids: List[int | str],
    project_id: Optional[int | str] = None,
):
    """
    Notify related users when a comment is posted on a PR.
    """
    clean_body = (comment_body or "").strip()
    preview = clean_body[:120] + ("..." if len(clean_body) > 120 else "")
    title = f"💬 Comment on PR #{pr_number}"
    body = f"@{commenter_gh}: {preview}"

    unique_user_ids = list({int(uid) for uid in target_user_ids if uid})
    for uid in unique_user_ids:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor()
            alert_id = _generator.generate()
            cur.execute(
                """
                INSERT INTO opentask.alerts
                    (id, user_id, context_id, project_id, title, description, type, severity, suggested_actions, is_resolved)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE);
                """,
                (
                    alert_id,
                    uid,
                    int(project_id) if project_id else uid,
                    int(project_id) if project_id else None,
                    title,
                    body,
                    "PR_COMMENT",
                    "info",
                    ["View Comment on GitHub"],
                )
            )
            conn.commit()
        except Exception as err:
            if conn:
                conn.rollback()
            logger.warning(f"[NOTIFICATIONS] Failed to create PR_COMMENT alert: {err}")
        finally:
            if cur is not None:
                cur.close()
            _put_conn(conn)

        try:
            send_push_notification(
                user_id=uid,
                title=title,
                body=body,
                url=pr_url,
                tag=f"pr-comment-{pr_number}",
            )
        except Exception as e:
            logger.warning(f"[NOTIFICATIONS] Failed to trigger PR comment push to {uid}: {e}")


