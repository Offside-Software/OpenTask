from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from fastapi import HTTPException
import psycopg2
import psycopg2.extras
import httpx
import jwt
import time
import logging

from services.database.database import _get_conn, _put_conn
from services.database.database import router as db_router, SafeId
from services.database.id_generator import _generator
from config import settings

logger = logging.getLogger("uvicorn.error")


class DatabaseGithubInstallation(BaseModel):
    id: Optional[SafeId] = None
    project_id: Optional[SafeId] = None
    installation_id: int
    account_login: str
    account_type: Optional[str] = "Organization"
    created_at: Optional[datetime] = None


def _generate_app_jwt() -> str:
    """Generate a GitHub App JWT for authenticating as the App."""
    private_key = settings.gh_app_private_key.replace("\\n", "\n")
    payload = {
        "iat": int(time.time()) - 60,
        "exp": int(time.time()) + (10 * 60),
        "iss": str(settings.gh_app_id)
    }
    return jwt.encode(payload, private_key, algorithm="RS256")


def _init_github_installations_table():
    """Ensure opentask.github_installations and opentask.pr_reviews tables exist."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS opentask.github_installations (
                id BIGINT PRIMARY KEY,
                project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
                installation_id BIGINT NOT NULL,
                account_login TEXT NOT NULL,
                account_type TEXT DEFAULT 'Organization',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_gh_installations_project ON opentask.github_installations(project_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_gh_installations_unique ON opentask.github_installations(project_id, installation_id);

            CREATE TABLE IF NOT EXISTS opentask.pr_reviews (
                id BIGINT PRIMARY KEY,
                project_id BIGINT REFERENCES opentask.projects(id) ON DELETE CASCADE,
                task_id BIGINT REFERENCES opentask.tasks(id) ON DELETE SET NULL,
                repo_full_name TEXT NOT NULL,
                pr_number INT NOT NULL,
                pr_title TEXT,
                pr_url TEXT,
                verdict TEXT NOT NULL,
                feedback TEXT,
                matched_task_title TEXT,
                completeness_score INT DEFAULT 0,
                reviewed_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_pr_reviews_project ON opentask.pr_reviews(project_id);
            CREATE INDEX IF NOT EXISTS idx_pr_reviews_task ON opentask.pr_reviews(task_id);

            ALTER TABLE opentask.tasks ADD COLUMN IF NOT EXISTS repo_url TEXT;
            CREATE INDEX IF NOT EXISTS idx_tasks_repo_url ON opentask.tasks(repo_url);
        """)
        conn.commit()
        logger.info("[GITHUB_INSTALLATIONS] Tables initialized.")
    except Exception as e:
        conn.rollback()
        logger.warning(f"[GITHUB_INSTALLATIONS] Error initializing tables: {e}")
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.post("/projects/{project_id}/installations")
def db_link_installation(project_id: int, installation: DatabaseGithubInstallation):
    """Link a GitHub App installation to a project."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Verify project exists
        cur.execute("SELECT id FROM opentask.projects WHERE id = %s LIMIT 1;", (project_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Project not found")

        row_id = _generator.generate()
        cur.execute(
            """
            INSERT INTO opentask.github_installations (id, project_id, installation_id, account_login, account_type)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (project_id, installation_id) DO UPDATE
                SET account_login = EXCLUDED.account_login,
                    account_type = EXCLUDED.account_type
            RETURNING id, project_id, installation_id, account_login, account_type, created_at;
            """,
            (row_id, project_id, installation.installation_id, installation.account_login, installation.account_type)
        )
        row = cur.fetchone()
        conn.commit()
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


@db_router.get("/projects/{project_id}/installations")
def db_get_project_installations(project_id: int):
    """List all GitHub App installations linked to a project."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, project_id, installation_id, account_login, account_type, created_at "
            "FROM opentask.github_installations WHERE project_id = %s ORDER BY created_at ASC;",
            (project_id,)
        )
        return cur.fetchall()
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.delete("/projects/{project_id}/installations/{installation_id}")
def db_unlink_installation(project_id: int, installation_id: int):
    """Unlink a GitHub App installation from a project."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "DELETE FROM opentask.github_installations WHERE project_id = %s AND installation_id = %s RETURNING id;",
            (project_id, installation_id)
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Installation link not found")
        conn.commit()
        return {"status": "unlinked", "installation_id": installation_id}
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


@db_router.get("/projects/{project_id}/repos")
def db_get_project_repos(project_id: int):
    """Aggregate all repos accessible from installations linked to this project."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Also get the project's current gh_repo_url list
        cur.execute("SELECT gh_repo_url FROM opentask.projects WHERE id = %s LIMIT 1;", (project_id,))
        p_row = cur.fetchone()
        if p_row is None:
            raise HTTPException(status_code=404, detail="Project not found")
        connected_urls = set(p_row.get("gh_repo_url") or [])

        cur.execute(
            "SELECT installation_id, account_login, account_type FROM opentask.github_installations WHERE project_id = %s;",
            (project_id,)
        )
        installations = cur.fetchall()
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)

    if not installations:
        return {"repos": [], "connected_urls": list(connected_urls)}

    jwt_token = _generate_app_jwt()
    all_repos = []

    import httpx as _httpx
    with _httpx.Client(timeout=15.0) as http:
        for inst in installations:
            inst_id = inst["installation_id"]
            # Get installation token
            try:
                token_resp = http.post(
                    f"https://api.github.com/app/installations/{inst_id}/access_tokens",
                    headers={
                        "Authorization": f"Bearer {jwt_token}",
                        "Accept": "application/vnd.github.v3+json"
                    }
                )
                token_resp.raise_for_status()
                inst_token = token_resp.json()["token"]
            except Exception as e:
                logger.warning(f"[GITHUB_INSTALLATIONS] Failed to get token for installation {inst_id}: {e}")
                continue

            # List repos for this installation
            try:
                repos_resp = http.get(
                    f"https://api.github.com/installation/repositories",
                    headers={
                        "Authorization": f"token {inst_token}",
                        "Accept": "application/vnd.github.v3+json"
                    },
                    params={"per_page": 100}
                )
                repos_resp.raise_for_status()
                repos_data = repos_resp.json().get("repositories", [])
                for r in repos_data:
                    all_repos.append({
                        "full_name": r["full_name"],
                        "html_url": r["html_url"],
                        "private": r["private"],
                        "description": r.get("description"),
                        "installation_id": inst_id,
                        "account_login": inst["account_login"],
                        "account_type": inst["account_type"],
                        "is_connected": r["html_url"] in connected_urls,
                    })
            except Exception as e:
                logger.warning(f"[GITHUB_INSTALLATIONS] Failed to list repos for installation {inst_id}: {e}")

    return {"repos": all_repos, "connected_urls": list(connected_urls)}
