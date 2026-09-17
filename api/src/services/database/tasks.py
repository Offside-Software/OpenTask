from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from fastapi import HTTPException, BackgroundTasks
import psycopg2
import psycopg2.extras

from services.database.database import _get_conn
from services.database.database import _put_conn
from services.database.database import router as db_router, SafeId
from services.database.id_generator import _generator

class DatabaseTask(BaseModel):
    id: Optional[SafeId] = None
    project_id: Optional[SafeId] = None
    bucket_id: Optional[SafeId] = None
    meeting_id: Optional[SafeId] = None
    parent_task_id: Optional[SafeId] = None
    lead_assignee_id: Optional[SafeId] = None
    suggested_assignee_id: Optional[SafeId] = None
    title: str
    description: Optional[str] = None
    type: str  # CODE, REQUIREMENT, DESIGN, OTHER
    weight: int  # Points (1-8)
    branch_name: Optional[str] = None
    last_activity_at: Optional[datetime] = None
    order_idx: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@db_router.post("/tasks")
def db_create_task(task: DatabaseTask):
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Resolve bucket_id if it's 'draft' or missing
        target_bucket_id = task.bucket_id
        if target_bucket_id == 'draft' or target_bucket_id is None:
            cur.execute(
                "SELECT id FROM opentask.buckets WHERE project_id = %s AND state = 'DRAFT' LIMIT 1;",
                (task.project_id,)
            )
            row = cur.fetchone()
            if row:
                target_bucket_id = row['id']
            elif target_bucket_id == 'draft':
                raise HTTPException(status_code=400, detail="No DRAFT bucket found for this project")

        # Generate new order_idx if missing
        assigned_order_idx = task.order_idx
        if assigned_order_idx is None and target_bucket_id is not None:
            cur.execute("SELECT COALESCE(MAX(order_idx), -1) + 1 AS next_idx FROM opentask.tasks WHERE bucket_id = %s;", (target_bucket_id,))
            row = cur.fetchone()
            assigned_order_idx = row['next_idx'] if row else 0

        mapping = {
            "id": _generator.generate(),    
            "project_id": task.project_id,
            "bucket_id": target_bucket_id,
            "meeting_id": task.meeting_id,
            "parent_task_id": task.parent_task_id,
            "lead_assignee_id": task.lead_assignee_id,
            "suggested_assignee_id": task.suggested_assignee_id,
            "title": task.title,
            "description": task.description,
            "type": task.type,
            "weight": task.weight,
            "branch_name": task.branch_name,
            "last_activity_at": task.last_activity_at,
            "order_idx": assigned_order_idx,
        }

        columns = []
        placeholders = []
        params = []
        for k, v in mapping.items():
            if v is not None:
                columns.append(k)
                placeholders.append("%s")
                params.append(v)

        if not columns:
            raise HTTPException(status_code=400, detail="No data provided for insert")
        
        cols_sql = ", ".join(columns)
        vals_sql = ", ".join(placeholders)
        sql = f"INSERT INTO opentask.tasks ({cols_sql}) VALUES ({vals_sql}) RETURNING id, project_id, bucket_id, meeting_id, parent_task_id, lead_assignee_id, suggested_assignee_id, title, description, type, weight, branch_name, last_activity_at, order_idx, created_at, updated_at;"

        cur.execute(sql, params)
        conn.commit()
        row = cur.fetchone()
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



@db_router.get("/tasks")
def db_get_tasks():
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, project_id, bucket_id, meeting_id, parent_task_id, lead_assignee_id, suggested_assignee_id, title, description, type, weight, branch_name, last_activity_at, order_idx, created_at, updated_at FROM opentask.tasks;")
        rows = cur.fetchall()
        return rows
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.get("/tasks/{task_id}")
def db_get_task_by_id(task_id: SafeId):
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, project_id, bucket_id, meeting_id, parent_task_id, lead_assignee_id, suggested_assignee_id, title, description, type, weight, branch_name, last_activity_at, order_idx, created_at, updated_at FROM opentask.tasks WHERE id = %s LIMIT 1;",
            (task_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return row
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


class TaskUpdate(BaseModel):
    project_id: Optional[SafeId] = None
    bucket_id: Optional[SafeId] = None
    meeting_id: Optional[SafeId] = None
    parent_task_id: Optional[SafeId] = None
    lead_assignee_id: Optional[SafeId] = None
    suggested_assignee_id: Optional[SafeId] = None
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    weight: Optional[int] = None
    branch_name: Optional[str] = None
    last_activity_at: Optional[datetime] = None
    order_idx: Optional[int] = None

@db_router.put("/tasks/{task_id}")
def db_update_task(task_id: SafeId, task_data: TaskUpdate, background_tasks: BackgroundTasks):
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        update_data = task_data.dict(exclude_unset=True)
        if not update_data:
            raise HTTPException(status_code=400, detail="No data provided for update")
        
        set_clause = ", ".join([f"{k} = %s" for k in update_data.keys()])
        params = list(update_data.values())
        params.append(task_id)
        
        sql = f"UPDATE opentask.tasks SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING id, project_id, bucket_id, meeting_id, parent_task_id, lead_assignee_id, suggested_assignee_id, title, description, type, weight, branch_name, last_activity_at, order_idx, created_at, updated_at;"
        
        cur.execute(sql, params)
        conn.commit()
        row = cur.fetchone()
        
        if update_data.get("bucket_id") is None: 
            pass # No bucket change, no sync needed
        else:
            from services.github_sync import sync_task_to_github_branch
            background_tasks.add_task(sync_task_to_github_branch, task_id, update_data["bucket_id"])
            
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return row
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)


@db_router.delete("/tasks/{task_id}")
def db_delete_task(task_id: SafeId):
    """Hard delete a task."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("DELETE FROM opentask.tasks WHERE id = %s RETURNING id;", (task_id,))
        conn.commit()
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return {"id": task_id, "status": "deleted"}
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


@db_router.put("/projects/{project_id}/buckets/{bucket_id}/tasks/reorder")
def db_reorder_tasks(project_id: SafeId, bucket_id: SafeId, task_ids: list[SafeId], background_tasks: BackgroundTasks):
    """Batch reorder tasks inside a specific bucket."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Verify tasks belong to the project
        if not task_ids:
            return {"status": "success", "order": [], "bucket_id": bucket_id}

        format_strings = ','.join(['%s'] * len(task_ids))
        # Lock rows in consistent sorted order to eliminate deadlocks with concurrent deletes/updates
        sorted_ids = sorted(task_ids, key=lambda x: int(x))
        cur.execute(
            f"SELECT id FROM opentask.tasks WHERE project_id = %s AND id IN ({format_strings}) ORDER BY id FOR UPDATE;",
            tuple([project_id] + sorted_ids)
        )
        valid_tasks = {str(row['id']) for row in cur.fetchall()}
        invalid_tasks = {str(t) for t in task_ids} - valid_tasks
        if invalid_tasks:
            raise HTTPException(status_code=400, detail=f"Invalid task IDs for this project: {invalid_tasks}")
            
        # Update all tasks in a single atomic CASE statement
        cases = " ".join(["WHEN id = %s THEN %s" for _ in task_ids])
        params = []
        for idx, t_id in enumerate(task_ids):
            params.extend([t_id, idx])
        params.append(bucket_id)
        params.append(project_id)
        params.extend(task_ids)

        query = f"""
            UPDATE opentask.tasks
            SET order_idx = CASE {cases} ELSE order_idx END,
                bucket_id = %s,
                updated_at = NOW()
            WHERE project_id = %s AND id IN ({format_strings});
        """
        cur.execute(query, tuple(params))
        conn.commit()
        
        from services.github_sync import sync_task_to_github_branch
        for t_id in task_ids:
            background_tasks.add_task(sync_task_to_github_branch, t_id, bucket_id)
            
        return {"status": "success", "order": task_ids, "bucket_id": bucket_id}
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
