from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from fastapi import HTTPException, BackgroundTasks, Depends
import psycopg2
import psycopg2.extras

from services.database.database import _get_conn
from services.database.database import _put_conn
from services.database.database import router as db_router, SafeId
from services.database.id_generator import _generator
from routers.auth import get_current_user_optional
from services.database.history import record_project_event, resolve_user_info

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
def db_create_task(task: DatabaseTask, current_user: dict | None = Depends(get_current_user_optional)):
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
        row = cur.fetchone()

        # Log project history & activity
        user_id, user_name = resolve_user_info(cur, current_user, task.lead_assignee_id)

        record_project_event(
            project_id=task.project_id,
            user_name=user_name,
            action="created",
            target=task.title,
            event_type="TASK_CREATED",
            entity_type="TASK",
            entity_id=row["id"],
            metadata={"title": task.title, "bucket_id": str(target_bucket_id), "type": task.type, "weight": task.weight},
            user_id=user_id,
            conn=conn,
        )
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
def db_update_task(task_id: SafeId, task_data: TaskUpdate, background_tasks: BackgroundTasks, current_user: dict | None = Depends(get_current_user_optional)):
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Fetch current state before update
        cur.execute(
            "SELECT id, project_id, bucket_id, title, lead_assignee_id FROM opentask.tasks WHERE id = %s LIMIT 1;",
            (task_id,)
        )
        old_task = cur.fetchone()
        if old_task is None:
            raise HTTPException(status_code=404, detail="Task not found")

        update_data = task_data.dict(exclude_unset=True)
        if not update_data:
            raise HTTPException(status_code=400, detail="No data provided for update")
        
        set_clause = ", ".join([f"{k} = %s" for k in update_data.keys()])
        params = list(update_data.values())
        params.append(task_id)
        
        sql = f"UPDATE opentask.tasks SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING id, project_id, bucket_id, meeting_id, parent_task_id, lead_assignee_id, suggested_assignee_id, title, description, type, weight, branch_name, last_activity_at, order_idx, created_at, updated_at;"
        
        cur.execute(sql, params)
        row = cur.fetchone()
        if row is None:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Task not found")

        # Determine user identity
        user_id, user_name = resolve_user_info(cur, current_user, update_data.get("lead_assignee_id") or old_task.get("lead_assignee_id"))

        # Determine action and event_type
        new_bucket_id = update_data.get("bucket_id")
        old_bucket_id = old_task.get("bucket_id")
        title = row.get("title") or old_task.get("title")

        if new_bucket_id is not None and str(new_bucket_id) != str(old_bucket_id):
            # Check bucket state
            cur.execute("SELECT name, state FROM opentask.buckets WHERE id = %s LIMIT 1;", (new_bucket_id,))
            b_row = cur.fetchone()
            b_name = b_row["name"] if b_row else f"Bucket #{new_bucket_id}"
            b_state = b_row["state"] if b_row else "UNKNOWN"

            if b_state == "COMPLETED":
                record_project_event(
                    project_id=row["project_id"],
                    user_name=user_name,
                    action="completed",
                    target=title,
                    event_type="TASK_COMPLETED",
                    entity_type="TASK",
                    entity_id=task_id,
                    metadata={"title": title, "bucket_id": str(new_bucket_id), "bucket_name": b_name},
                    user_id=user_id,
                    conn=conn,
                )
            else:
                record_project_event(
                    project_id=row["project_id"],
                    user_name=user_name,
                    action="moved",
                    target=f"{title} to {b_name}",
                    event_type="TASK_MOVED",
                    entity_type="TASK",
                    entity_id=task_id,
                    metadata={"title": title, "bucket_id": str(new_bucket_id), "bucket_name": b_name},
                    user_id=user_id,
                    conn=conn,
                )

            # Only sync to GitHub if moving to an active ONGOING branch and it is a CODE task
            if b_state == "ONGOING" and row.get("type") == "CODE":
                from services.github_sync import sync_task_to_github_branch
                background_tasks.add_task(sync_task_to_github_branch, task_id, new_bucket_id)

        elif "lead_assignee_id" in update_data and update_data["lead_assignee_id"] != old_task.get("lead_assignee_id"):
            record_project_event(
                project_id=row["project_id"],
                user_name=user_name,
                action="assigned",
                target=title,
                event_type="TASK_ASSIGNED",
                entity_type="TASK",
                entity_id=task_id,
                metadata={"title": title, "lead_assignee_id": str(update_data["lead_assignee_id"])},
                user_id=user_id,
                conn=conn,
            )
        elif "title" in update_data or "description" in update_data:
            record_project_event(
                project_id=row["project_id"],
                user_name=user_name,
                action="updated",
                target=title,
                event_type="TASK_UPDATED",
                entity_type="TASK",
                entity_id=task_id,
                metadata={"title": title},
                user_id=user_id,
                conn=conn,
            )

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


@db_router.delete("/tasks/{task_id}")
def db_delete_task(task_id: SafeId, current_user: dict | None = Depends(get_current_user_optional)):
    """Hard delete a task."""
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, project_id, title FROM opentask.tasks WHERE id = %s LIMIT 1;", (task_id,))
        old_task = cur.fetchone()
        if old_task is None:
            raise HTTPException(status_code=404, detail="Task not found")

        cur.execute("DELETE FROM opentask.tasks WHERE id = %s RETURNING id;", (task_id,))

        user_id, user_name = resolve_user_info(cur, current_user, old_task.get("lead_assignee_id"))

        record_project_event(
            project_id=old_task["project_id"],
            user_name=user_name,
            action="deleted",
            target=old_task["title"],
            event_type="TASK_DELETED",
            entity_type="TASK",
            entity_id=task_id,
            metadata={"title": old_task["title"]},
            user_id=user_id,
            conn=conn,
        )
        conn.commit()

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
def db_reorder_tasks(
    project_id: SafeId,
    bucket_id: SafeId,
    task_ids: list[SafeId],
    background_tasks: BackgroundTasks,
    current_user: dict | None = Depends(get_current_user_optional),
):
    """Batch reorder tasks inside a specific bucket, logging move/completion events when buckets change."""
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
            f"SELECT id, bucket_id, title, lead_assignee_id FROM opentask.tasks WHERE project_id = %s AND id IN ({format_strings}) ORDER BY id FOR UPDATE;",
            tuple([project_id] + sorted_ids)
        )
        existing_rows = cur.fetchall()
        existing_tasks = {str(row['id']): row for row in existing_rows}
        valid_tasks = set(existing_tasks.keys())
        invalid_tasks = {str(t) for t in task_ids} - valid_tasks
        if invalid_tasks:
            raise HTTPException(status_code=400, detail=f"Invalid task IDs for this project: {invalid_tasks}")

        # Detect which tasks actually changed buckets (moved from another column)
        moved_tasks = [
            existing_tasks[str(t_id)] for t_id in task_ids
            if str(t_id) in existing_tasks and str(existing_tasks[str(t_id)]['bucket_id']) != str(bucket_id)
        ]

        # Fetch destination bucket info if any tasks moved
        target_bucket_name = f"Bucket #{bucket_id}"
        target_bucket_state = "UNKNOWN"
        if moved_tasks:
            cur.execute("SELECT name, state FROM opentask.buckets WHERE id = %s LIMIT 1;", (bucket_id,))
            b_row = cur.fetchone()
            if b_row:
                target_bucket_name = b_row.get("name") or target_bucket_name
                target_bucket_state = b_row.get("state") or target_bucket_state
            
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

        # Log project events for tasks that moved across buckets
        for m_task in moved_tasks:
            u_id, u_name = resolve_user_info(cur, current_user, m_task.get("lead_assignee_id"))
            t_title = m_task.get("title") or "Task"
            if target_bucket_state == "COMPLETED":
                record_project_event(
                    project_id=project_id,
                    user_name=u_name,
                    action="completed",
                    target=t_title,
                    event_type="TASK_COMPLETED",
                    entity_type="TASK",
                    entity_id=m_task["id"],
                    metadata={"title": t_title, "bucket_id": str(bucket_id), "bucket_name": target_bucket_name},
                    user_id=u_id,
                    conn=conn,
                )
            else:
                record_project_event(
                    project_id=project_id,
                    user_name=u_name,
                    action="moved",
                    target=f"{t_title} to {target_bucket_name}",
                    event_type="TASK_MOVED",
                    entity_type="TASK",
                    entity_id=m_task["id"],
                    metadata={"title": t_title, "bucket_id": str(bucket_id), "bucket_name": target_bucket_name},
                    user_id=u_id,
                    conn=conn,
                )

        conn.commit()

        # Only queue GitHub branch sync for CODE tasks that actually moved into an ONGOING bucket
        if target_bucket_state == "ONGOING" and moved_tasks:
            from services.github_sync import sync_task_to_github_branch
            for m_task in moved_tasks:
                if m_task.get("type") == "CODE":
                    background_tasks.add_task(sync_task_to_github_branch, m_task["id"], bucket_id)

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
