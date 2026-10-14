from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
import psycopg2.extras
import logging

from services.database.database import _get_conn, _put_conn, SafeId
from services.ai_client import mask_api_key, test_gemini_api_key, resolve_gemini_client
from routers.auth import get_current_user

logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["Custom Integrated AI"])


class TestKeyRequest(BaseModel):
    api_key: str = Field(..., description="Google Gemini API key to test")


class SaveKeyRequest(BaseModel):
    api_key: str = Field(..., description="Google Gemini API key to persist")
    validate_first: Optional[bool] = Field(default=True, description="Whether to ping Gemini to ensure key is valid before saving")


# ----------------------------------------------------------------------
# 1. Test Key Verification Endpoint
# ----------------------------------------------------------------------
@router.post("/ai/test-key")
def test_key_endpoint(req: TestKeyRequest):
    """
    Test and verify whether an input Google Gemini API key is valid and operational.
    """
    res = test_gemini_api_key(req.api_key)
    return res


# ----------------------------------------------------------------------
# 2. Project-Level AI API Key Endpoints
# ----------------------------------------------------------------------
@router.get("/projects/{project_id}/ai-key")
def get_project_ai_key(project_id: SafeId):
    """
    Retrieve project custom AI key status and masked key representation.
    """
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, custom_ai_api_key FROM opentask.projects WHERE id = %s LIMIT 1;", (int(project_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")

        key = row.get("custom_ai_api_key")
        has_custom = bool(key and key.strip())
        return {
            "project_id": str(project_id),
            "has_custom_key": has_custom,
            "masked_key": mask_api_key(key) if has_custom else None
        }
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.post("/projects/{project_id}/ai-key")
def save_project_ai_key(project_id: SafeId, req: SaveKeyRequest):
    """
    Save or update custom Gemini AI API key for a project.
    """
    key = req.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")

    if req.validate_first:
        validation = test_gemini_api_key(key)
        if not validation["valid"]:
            raise HTTPException(
                status_code=400,
                detail=f"Key validation failed: {validation.get('error') or 'Invalid API key'}"
            )

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "UPDATE opentask.projects SET custom_ai_api_key = %s, updated_at = NOW() WHERE id = %s RETURNING id;",
            (key, int(project_id))
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.commit()
        return {
            "project_id": str(project_id),
            "status": "saved",
            "has_custom_key": True,
            "masked_key": mask_api_key(key)
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


@router.delete("/projects/{project_id}/ai-key")
def delete_project_ai_key(project_id: SafeId):
    """
    Clear/remove custom Gemini AI API key for a project (reverting to system/user fallback).
    """
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "UPDATE opentask.projects SET custom_ai_api_key = NULL, updated_at = NOW() WHERE id = %s RETURNING id;",
            (int(project_id),)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.commit()
        return {"project_id": str(project_id), "status": "removed", "has_custom_key": False}
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


# ----------------------------------------------------------------------
# 3. User-Level Personal AI API Key Endpoints
# ----------------------------------------------------------------------
@router.get("/users/me/ai-key")
def get_user_ai_key(current_user: dict = Depends(get_current_user)):
    """
    Retrieve current authenticated user's personal AI key status.
    """
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User not authenticated")

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, custom_ai_api_key FROM opentask.users WHERE id = %s LIMIT 1;", (int(user_id),))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        key = row.get("custom_ai_api_key")
        has_custom = bool(key and key.strip())
        return {
            "user_id": str(user_id),
            "has_custom_key": has_custom,
            "masked_key": mask_api_key(key) if has_custom else None
        }
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@router.post("/users/me/ai-key")
def save_user_ai_key(req: SaveKeyRequest, current_user: dict = Depends(get_current_user)):
    """
    Save or update personal Gemini AI API key for the current user.
    """
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User not authenticated")

    key = req.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")

    if req.validate_first:
        validation = test_gemini_api_key(key)
        if not validation["valid"]:
            raise HTTPException(
                status_code=400,
                detail=f"Key validation failed: {validation.get('error') or 'Invalid API key'}"
            )

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "UPDATE opentask.users SET custom_ai_api_key = %s WHERE id = %s RETURNING id;",
            (key, int(user_id))
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
        return {
            "user_id": str(user_id),
            "status": "saved",
            "has_custom_key": True,
            "masked_key": mask_api_key(key)
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


@router.delete("/users/me/ai-key")
def delete_user_ai_key(current_user: dict = Depends(get_current_user)):
    """
    Clear/remove personal Gemini AI API key for the current user.
    """
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="User not authenticated")

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "UPDATE opentask.users SET custom_ai_api_key = NULL WHERE id = %s RETURNING id;",
            (int(user_id),)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
        return {"user_id": str(user_id), "status": "removed", "has_custom_key": False}
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
