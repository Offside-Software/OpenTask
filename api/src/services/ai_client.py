import logging
from typing import Optional, Tuple
from google import genai
from google.genai import types
import psycopg2.extras

from config import settings
from services.database.database import _get_conn, _put_conn

logger = logging.getLogger("uvicorn.error")


def mask_api_key(key: Optional[str]) -> Optional[str]:
    """Return a masked representation of an API key for safe UI display."""
    if not key:
        return None
    cleaned = key.strip()
    if len(cleaned) <= 8:
        return "********"
    return f"{cleaned[:6]}****************{cleaned[-4:]}"


def test_gemini_api_key(api_key: str) -> dict:
    """
    Validates a Gemini API key by making a lightweight ping to the Google Gemini API.
    Returns {"valid": bool, "message": str, "error": str | None}
    """
    if not api_key or not api_key.strip():
        return {"valid": False, "error": "API key cannot be empty", "message": None}

    cleaned_key = api_key.strip()
    try:
        test_client = genai.Client(api_key=cleaned_key)
        # Lightweight test prompt — try models in order of recency
        ping_model = "gemini-3.6-flash"
        try:
            response = test_client.models.generate_content(
                model=ping_model,
                contents="ping",
                config=types.GenerateContentConfig(
                    max_output_tokens=10,
                    temperature=0.0
                )
            )
        except Exception:
            # Fallback to flash-lite if the primary ping model also fails
            ping_model = "gemini-flash-lite-latest"
            response = test_client.models.generate_content(
                model=ping_model,
                contents="ping",
                config=types.GenerateContentConfig(
                    max_output_tokens=10,
                    temperature=0.0
                )
            )
        if response and (response.text is not None or response.candidates):
            return {
                "valid": True,
                "model": ping_model,
                "message": "Google Gemini API key successfully verified and operational!",
                "error": None
            }
        else:
            return {
                "valid": False,
                "model": None,
                "error": "Gemini API responded but returned an empty response.",
                "message": None
            }
    except Exception as e:
        error_msg = str(e)
        logger.warning(f"Gemini API key verification failed: {error_msg}")
        return {
            "valid": False,
            "error": f"Verification failed: {error_msg}",
            "message": None
        }


def resolve_gemini_client(
    project_id: Optional[int | str] = None,
    user_id: Optional[int | str] = None,
    explicit_key: Optional[str] = None
) -> Tuple[Optional[genai.Client], str]:
    """
    Resolves a Google Gemini API client based on priority:
    1. explicit_key (highest precedence)
    2. project_id -> opentask.projects.custom_ai_api_key
    3. user_id -> opentask.users.custom_ai_api_key
    4. settings.gemini_api_key (system default)

    Returns:
        (client, source): where source is 'explicit', 'project', 'user', 'system', or 'none'
    """
    # 1. Explicit Key
    if explicit_key and explicit_key.strip():
        try:
            return genai.Client(api_key=explicit_key.strip()), "explicit"
        except Exception as e:
            logger.warning(f"Failed to create client with explicit key: {e}")

    # 2. Project Custom AI Key
    if project_id:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT custom_ai_api_key FROM opentask.projects WHERE id = %s LIMIT 1;", (int(project_id),))
            p_row = cur.fetchone()
            if p_row and p_row.get("custom_ai_api_key"):
                p_key = p_row["custom_ai_api_key"].strip()
                if p_key:
                    try:
                        client = genai.Client(api_key=p_key)
                        logger.info(f"Resolved Gemini client using project #{project_id} custom key")
                        return client, "project"
                    except Exception as e:
                        logger.warning(f"Failed to initialize client with project key for project {project_id}: {e}")
        except Exception as err:
            logger.debug(f"Error querying project custom_ai_api_key: {err}")
        finally:
            if cur is not None:
                cur.close()
            _put_conn(conn)

    # 3. User Personal Custom AI Key
    if user_id:
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT custom_ai_api_key FROM opentask.users WHERE id = %s LIMIT 1;", (int(user_id),))
            u_row = cur.fetchone()
            if u_row and u_row.get("custom_ai_api_key"):
                u_key = u_row["custom_ai_api_key"].strip()
                if u_key:
                    try:
                        client = genai.Client(api_key=u_key)
                        logger.info(f"Resolved Gemini client using user #{user_id} personal key")
                        return client, "user"
                    except Exception as e:
                        logger.warning(f"Failed to initialize client with user key for user {user_id}: {e}")
        except Exception as err:
            logger.debug(f"Error querying user custom_ai_api_key: {err}")
        finally:
            if cur is not None:
                cur.close()
            _put_conn(conn)

    # 4. System Default Key
    if settings.gemini_api_key and settings.gemini_api_key.strip():
        try:
            client = genai.Client(api_key=settings.gemini_api_key.strip())
            return client, "system"
        except Exception as e:
            logger.error(f"Failed to initialize default system Gemini client: {e}")

    return None, "none"
