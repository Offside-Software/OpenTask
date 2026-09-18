from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from config import settings
from routers.auth import get_current_user_optional, get_current_user
from services.notifications import (
    save_push_subscription,
    send_push_notification,
)
from services.database.database import _get_conn, _put_conn
import psycopg2.extras

router = APIRouter(prefix="/notifications", tags=["notifications"])


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionPayload(BaseModel):
    endpoint: str
    keys: SubscriptionKeys
    user_id: Optional[str | int] = None


class TestNotificationPayload(BaseModel):
    title: Optional[str] = "🔔 OpenTask Alert Test"
    body: Optional[str] = "Web Push system is fully functional and connected to the backend!"
    url: Optional[str] = "/notifications"


def _resolve_db_user_id(current_user: Optional[dict]) -> Optional[int]:
    """Helper to find opentask.users.id for the logged-in GitHub user."""
    if not current_user:
        return None
    gh_id = str(current_user.get("id")) if current_user.get("id") is not None else None
    gh_login = current_user.get("login") or current_user.get("gh_username")

    if not gh_id and not gh_login:
        return None

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id FROM opentask.users WHERE gh_id = %s OR gh_username = %s LIMIT 1;",
            (gh_id, gh_login),
        )
        row = cur.fetchone()
        return row["id"] if row else None
    except Exception:
        return None
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.get("/vapid-public-key")
def get_vapid_public_key():
    """Returns the VAPID applicationServerKey for frontend push subscriptions."""
    return {"publicKey": settings.vapid_public_key}


@router.post("/subscribe")
async def subscribe_push(
    payload: PushSubscriptionPayload,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Register or refresh a browser Web Push subscription."""
    db_user_id = _resolve_db_user_id(current_user) or payload.user_id

    try:
        result = save_push_subscription(
            user_id=db_user_id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
        return {"status": "subscribed", "subscription": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save push subscription: {e}")


@router.post("/test")
async def test_push_notification(
    payload: Optional[TestNotificationPayload] = None,
    current_user: dict = Depends(get_current_user),
):
    """Send a test push notification to the currently authenticated user."""
    db_user_id = _resolve_db_user_id(current_user)
    if not db_user_id:
        raise HTTPException(
            status_code=400,
            detail="Could not resolve internal user record for current session."
        )

    title = payload.title if payload and payload.title else "🔔 OpenTask Alert Test"
    body = payload.body if payload and payload.body else "Web Push system is active and responsive!"
    url = payload.url if payload and payload.url else "/notifications"

    delivered_count, total_subs = send_push_notification(
        user_id=db_user_id,
        title=title,
        body=body,
        url=url,
        tag="test-alert",
    )

    if total_subs == 0:
        return {
            "status": "warning",
            "message": "No active device subscriptions found for your account. Please click 'Enable Web Push' first.",
            "delivered": 0,
            "total": 0,
        }

    if delivered_count == 0:
        return {
            "status": "error",
            "message": f"Found {total_subs} subscription(s), but delivery failed. Please click 'Enable Web Push' again to refresh your device subscription.",
            "delivered": 0,
            "total": total_subs,
        }

    return {
        "status": "success",
        "message": f"Push alert dispatched to {delivered_count} active device(s).",
        "delivered": delivered_count,
        "total": total_subs,
    }
