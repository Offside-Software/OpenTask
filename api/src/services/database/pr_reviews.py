from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from fastapi import HTTPException, BackgroundTasks
import psycopg2
import psycopg2.extras

from services.database.database import _get_conn, _put_conn
from services.database.database import router as db_router, SafeId
from services.database.id_generator import _generator


class DatabasePrReview(BaseModel):
    id: Optional[SafeId] = None
    project_id: Optional[SafeId] = None
    task_id: Optional[SafeId] = None
    repo_full_name: str
    pr_number: int
    pr_title: Optional[str] = None
    pr_url: Optional[str] = None
    verdict: str  # 'PASS' or 'FAIL'
    feedback: Optional[str] = None
    matched_task_title: Optional[str] = None
    completeness_score: Optional[int] = 0
    reviewed_at: Optional[datetime] = None


def save_pr_review(
    project_id: int,
    repo_full_name: str,
    pr_number: int,
    verdict: str,
    feedback: str,
    task_id: Optional[int] = None,
    pr_title: Optional[str] = None,
    pr_url: Optional[str] = None,
    matched_task_title: Optional[str] = None,
    completeness_score: int = 0,
) -> dict:
    """Internal function to save a PR review verdict (called from pr_evaluator)."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        review_id = _generator.generate()
        cur.execute(
            """
            INSERT INTO opentask.pr_reviews
                (id, project_id, task_id, repo_full_name, pr_number, pr_title, pr_url,
                 verdict, feedback, matched_task_title, completeness_score, reviewed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING id, project_id, task_id, repo_full_name, pr_number, pr_title,
                      pr_url, verdict, feedback, matched_task_title, completeness_score, reviewed_at;
            """,
            (
                review_id, project_id, task_id, repo_full_name, pr_number,
                pr_title, pr_url, verdict, feedback, matched_task_title, completeness_score
            )
        )
        row = cur.fetchone()
        conn.commit()
        return dict(row) if row else {}
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.post("/pr-reviews")
def db_create_pr_review(review: DatabasePrReview):
    """Create a PR review verdict record."""
    try:
        return save_pr_review(
            project_id=int(review.project_id),
            repo_full_name=review.repo_full_name,
            pr_number=review.pr_number,
            verdict=review.verdict,
            feedback=review.feedback or "",
            task_id=int(review.task_id) if review.task_id else None,
            pr_title=review.pr_title,
            pr_url=review.pr_url,
            matched_task_title=review.matched_task_title,
            completeness_score=review.completeness_score or 0,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@db_router.get("/projects/{project_id}/pr-reviews")
def db_get_project_pr_reviews(project_id: int):
    """List all AI PR review verdicts for a project, newest first."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, project_id, task_id, repo_full_name, pr_number, pr_title, pr_url,
                   verdict, feedback, matched_task_title, completeness_score, reviewed_at
            FROM opentask.pr_reviews
            WHERE project_id = %s
            ORDER BY reviewed_at DESC
            LIMIT 50;
            """,
            (project_id,)
        )
        return cur.fetchall()
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.get("/tasks/{task_id}/pr-reviews")
def db_get_task_pr_reviews(task_id: SafeId):
    """List all AI PR review verdicts for a specific task, newest first."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, project_id, task_id, repo_full_name, pr_number, pr_title, pr_url,
                   verdict, feedback, matched_task_title, completeness_score, reviewed_at
            FROM opentask.pr_reviews
            WHERE task_id = %s
            ORDER BY reviewed_at DESC;
            """,
            (task_id,)
        )
        return cur.fetchall()
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


class TriggerPrReviewRequest(BaseModel):
    repo_full_name: Optional[str] = None
    pr_number: Optional[int] = None
    task_id: Optional[SafeId] = None


@db_router.post("/projects/{project_id}/pr-reviews/trigger")
async def db_trigger_pr_review(project_id: int, req: TriggerPrReviewRequest):
    """
    Immediately spawn AI PR evaluation for a specific PR or task.
    Enables instant review directly from the UI without waiting for GitHub webhooks.
    """
    from services.pr_evaluator import process_task_aware_pr_evaluation, get_installation_token
    import httpx

    repo_full_name = req.repo_full_name
    pr_number = req.pr_number
    task_id = req.task_id

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 1. Find installation ID for this project
        cur.execute(
            """
            SELECT installation_id FROM opentask.github_installations
            WHERE project_id = %s LIMIT 1;
            """,
            (project_id,)
        )
        inst_row = cur.fetchone()
        installation_id = inst_row["installation_id"] if inst_row else None

        # 2. Find connected repo from project if not provided
        cur.execute("SELECT gh_repo_url FROM opentask.projects WHERE id = %s LIMIT 1;", (project_id,))
        proj_row = cur.fetchone()
        proj_repos = (proj_row.get("gh_repo_url") or []) if proj_row else []

        if not repo_full_name and proj_repos:
            first_url = proj_repos[0].rstrip("/")
            if "github.com/" in first_url:
                repo_full_name = first_url.split("github.com/")[-1]

        # 3. If task_id provided, check task's repo_url and match PR by branch
        if task_id:
            cur.execute("SELECT branch_name, title, repo_url FROM opentask.tasks WHERE id = %s LIMIT 1;", (int(task_id),))
            t_row = cur.fetchone()
            if t_row and t_row.get("repo_url") and "github.com/" in t_row["repo_url"]:
                repo_full_name = t_row["repo_url"].rstrip("/").split("github.com/")[-1]

            if repo_full_name and not pr_number:
                inst_id_to_use = installation_id or 162827907
                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        token = await get_installation_token(inst_id_to_use, client)
                        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
                        resp = await client.get(
                            f"https://api.github.com/repos/{repo_full_name}/pulls?state=all&per_page=10",
                            headers=headers
                        )
                        if resp.status_code == 200:
                            pulls = resp.json()
                            b_name = (t_row.get("branch_name") or "").lower() if t_row else ""
                            t_title = (t_row.get("title") or "").lower() if t_row else ""
                            for p in pulls:
                                p_ref = p.get("head", {}).get("ref", "").lower()
                                p_title = p.get("title", "").lower()
                                if (b_name and (b_name in p_ref or p_ref in b_name)) or any(w in p_title for w in t_title.split() if len(w) > 3):
                                    pr_number = p["number"]
                                    break
                            if not pr_number and pulls:
                                pr_number = pulls[0]["number"]
                except Exception as ex:
                    pass

    finally:
        if cur:
            cur.close()
        _put_conn(conn)

    if not repo_full_name or not pr_number:
        raise HTTPException(
            status_code=400,
            detail="Could not automatically identify repo_full_name or pr_number. Please provide them explicitly."
        )

    if not installation_id:
        from config import settings
        installation_id = getattr(settings, "gh_app_installation_id", None) or 162827907

    # Run AI review immediately
    await process_task_aware_pr_evaluation(
        repo_full_name=repo_full_name,
        pr_number=pr_number,
        installation_id=installation_id,
    )

    # Return latest verdict from DB
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT * FROM opentask.pr_reviews
            WHERE project_id = %s AND repo_full_name = %s AND pr_number = %s
            ORDER BY reviewed_at DESC LIMIT 1;
            """,
            (project_id, repo_full_name, pr_number)
        )
        row = cur.fetchone()
        return row or {"status": "completed", "repo_full_name": repo_full_name, "pr_number": pr_number}
    finally:
        if cur:
            cur.close()
        _put_conn(conn)


@db_router.post("/projects/{project_id}/sync-prs")
async def db_sync_project_prs(project_id: int):
    """
    Scan all connected repositories for open or recent PRs,
    match them against project tasks, and immediately run AI Code Review.
    """
    from services.pr_evaluator import process_task_aware_pr_evaluation, get_installation_token
    import httpx

    conn = _get_conn()
    cur = None
    installation_id = None
    repos_to_scan = []
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT installation_id FROM opentask.github_installations WHERE project_id = %s LIMIT 1;", (project_id,))
        inst_row = cur.fetchone()
        installation_id = inst_row["installation_id"] if inst_row else None

        cur.execute("SELECT gh_repo_url FROM opentask.projects WHERE id = %s LIMIT 1;", (project_id,))
        proj_row = cur.fetchone()
        if proj_row and proj_row.get("gh_repo_url"):
            for u in proj_row["gh_repo_url"]:
                if "github.com/" in u:
                    repos_to_scan.append(u.rstrip("/").split("github.com/")[-1])
    finally:
        if cur:
            cur.close()
        _put_conn(conn)

    if not installation_id:
        from config import settings
        installation_id = getattr(settings, "gh_app_installation_id", None) or 162827907

    if not repos_to_scan:
        return {"scanned": 0, "reviews_triggered": 0, "message": "No repositories connected to this project."}

    triggered = []
    async with httpx.AsyncClient(timeout=20.0) as client:
        token = await get_installation_token(installation_id, client)
        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}

        for repo_name in repos_to_scan:
            resp = await client.get(f"https://api.github.com/repos/{repo_name}/pulls?state=open&per_page=10", headers=headers)
            pulls = resp.json() if resp.status_code == 200 else []
            if not pulls:
                resp_all = await client.get(f"https://api.github.com/repos/{repo_name}/pulls?state=all&per_page=3", headers=headers)
                pulls = resp_all.json() if resp_all.status_code == 200 else []

            for p in pulls:
                p_num = p["number"]
                p_title = p.get("title", "")
                p_branch = p.get("head", {}).get("ref", "")
                await process_task_aware_pr_evaluation(
                    repo_full_name=repo_name,
                    pr_number=p_num,
                    installation_id=installation_id,
                    pr_title=p_title,
                    pr_body=p.get("body") or "",
                    branch_name=p_branch,
                )
                triggered.append({
                    "repo_full_name": repo_name,
                    "pr_number": p_num,
                    "title": p_title,
                    "branch": p_branch,
                })

    return {
        "scanned": len(repos_to_scan),
        "reviews_triggered": len(triggered),
        "pull_requests": triggered,
    }


@db_router.get("/projects/{project_id}/pulls")
async def db_get_project_pulls(project_id: int):
    """List open and recent PRs for connected repositories."""
    from services.pr_evaluator import get_installation_token
    import httpx

    conn = _get_conn()
    cur = None
    installation_id = None
    repos_to_scan = []
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT installation_id FROM opentask.github_installations WHERE project_id = %s LIMIT 1;", (project_id,))
        inst_row = cur.fetchone()
        installation_id = inst_row["installation_id"] if inst_row else 162827907

        cur.execute("SELECT gh_repo_url FROM opentask.projects WHERE id = %s LIMIT 1;", (project_id,))
        proj_row = cur.fetchone()
        if proj_row and proj_row.get("gh_repo_url"):
            for u in proj_row["gh_repo_url"]:
                if "github.com/" in u:
                    repos_to_scan.append(u.rstrip("/").split("github.com/")[-1])
    finally:
        if cur:
            cur.close()
        _put_conn(conn)

    all_prs = []
    if repos_to_scan and installation_id:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                token = await get_installation_token(installation_id, client)
                headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"}
                for repo_name in repos_to_scan:
                    resp = await client.get(f"https://api.github.com/repos/{repo_name}/pulls?state=all&per_page=15", headers=headers)
                    if resp.status_code == 200:
                        for p in resp.json():
                            all_prs.append({
                                "repo_full_name": repo_name,
                                "number": p["number"],
                                "title": p["title"],
                                "state": p["state"],
                                "url": p["html_url"],
                                "branch": p.get("head", {}).get("ref"),
                                "author": p.get("user", {}).get("login"),
                                "created_at": p.get("created_at"),
                                "merged_at": p.get("merged_at"),
                            })
        except Exception as e:
            pass

    return {"pull_requests": all_prs}
