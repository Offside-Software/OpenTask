from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from fastapi import HTTPException
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
