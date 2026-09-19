import logging
from services.database.tasks import DatabaseTask, db_update_task
from services.database.activities import DatabaseActivity, db_create_activity
from fastapi import BackgroundTasks
from services.database.database import _get_conn, _put_conn
import psycopg2.extras
import re
from github_app import get_github_client
from services.database.id_generator import _generator

logger = logging.getLogger("uvicorn.error")

async def process_github_event(payload: dict, event: str, pool=None):
    action = payload.get("action", "")

    if event == "pull_request":
        if action == "opened":
            await on_pr_opened(payload, pool)
        elif action == "reopened":
            await on_pr_reopened(payload, pool)
        elif action == "synchronize":
            await on_pr_synchronize(payload, pool)
        elif action == "closed":
            await on_pr_closed(payload, pool)
            
    elif event == "pull_request_review":
        if action == "submitted":
            await on_pr_review_submitted(payload, pool)

    elif event in ("issue_comment", "pull_request_review_comment"):
        if action == "created":
            await on_pr_comment_created(payload, event, pool)

async def sync_github_tasks(payload: dict):
    """Synchronization of tasks from GitHub tasks.md files to local DB."""
    repo_full_name = payload.get("repository", {}).get("full_name")
    repo_url = payload.get("repository", {}).get("html_url")
    installation_id = payload.get("installation", {}).get("id")
    
    if not repo_full_name or not installation_id:
        return

    try:
        gh = get_github_client(installation_id)
        repo = gh.get_repo(repo_full_name)
        
        # Get PR author to assign tasks if possible
        pr_author_gh = payload.get("pull_request", {}).get("user", {}).get("login")
        lead_assignee_id = None
        
        # 1. Sweep for tasks.md files in openspec/changes/
        try:
            contents = repo.get_contents("openspec/changes")
        except:
            logger.info(f"No openspec/changes directory found in {repo_full_name}")
            return

        all_tasks = []
        for item in contents:
            if item.type == "dir":
                try:
                    task_files = repo.get_contents(item.path)
                    for tf in task_files:
                        if tf.name == "tasks.md":
                            content = tf.decoded_content.decode("utf-8")
                            # Simple parser for - [ ] Task Title
                            lines = content.splitlines()
                            for line in lines:
                                match = re.search(r"^- \[[ xX]\] (.*)$", line)
                                if match:
                                    all_tasks.append(match.group(1).strip())
                except Exception as e:
                    logger.warning(f"Error reading tasks.md in {item.path}: {e}")
                    continue
        
        if not all_tasks:
            logger.info(f"No tasks found in openspec/changes/ for {repo_full_name}")
            return

        # 2. Sync with DB
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            # Look up lead_assignee_id by gh_username
            if pr_author_gh:
                cur.execute("SELECT id FROM opentask.users WHERE gh_username = %s LIMIT 1;", (pr_author_gh,))
                user_row = cur.fetchone()
                if user_row:
                    lead_assignee_id = user_row["id"]

            # Find project by repo URL
            cur.execute("SELECT id FROM opentask.projects WHERE %s = ANY(gh_repo_url) LIMIT 1;", (repo_url,))
            project_row = cur.fetchone()
            
            if not project_row:
                # Zero-Config: Create project
                project_id = _generator.generate()
                cur.execute(
                    "INSERT INTO opentask.projects (id, name, gh_repo_url) VALUES (%s, %s, %s) RETURNING id;",
                    (project_id, repo_full_name.split("/")[-1], [repo_url])
                )
                project_id = cur.fetchone()["id"]
                
                # Create default DRAFT bucket
                bucket_id = _generator.generate()
                cur.execute(
                    "INSERT INTO opentask.buckets (id, project_id, name, state, is_system_locked, order_idx) "
                    "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;",
                    (bucket_id, project_id, "AI Drafts", "DRAFT", True, 0)
                )
                target_bucket_id = cur.fetchone()["id"]
                logger.info(f"Zero-Config: Created project {project_id} and DRAFT bucket for {repo_full_name}")
            else:
                project_id = project_row["id"]
                # Find DRAFT bucket
                cur.execute("SELECT id FROM opentask.buckets WHERE project_id = %s AND state = 'DRAFT' LIMIT 1;", (project_id,))
                bucket_row = cur.fetchone()
                if bucket_row:
                    target_bucket_id = bucket_row["id"]
                else:
                    # Create if missing
                    bucket_id = _generator.generate()
                    cur.execute(
                        "INSERT INTO opentask.buckets (id, project_id, name, state, is_system_locked, order_idx) "
                        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;",
                        (bucket_id, project_id, "AI Drafts", "DRAFT", True, 0)
                    )
                    target_bucket_id = cur.fetchone()["id"]

            # Upsert tasks
            created_count = 0
            for task_title in all_tasks:
                # Check if task already exists
                cur.execute("SELECT id FROM opentask.tasks WHERE project_id = %s AND title = %s LIMIT 1;", (project_id, task_title))
                if cur.fetchone():
                    continue
                
                # Insert new task
                task_id = _generator.generate()
                cur.execute(
                    "INSERT INTO opentask.tasks (id, project_id, bucket_id, lead_assignee_id, title, type, weight) VALUES (%s, %s, %s, %s, %s, 'CODE', 1);",
                    (task_id, project_id, target_bucket_id, lead_assignee_id, task_title)
                )
                created_count += 1
            
            conn.commit()
            if created_count > 0:
                logger.info(f"Successfully synced {created_count} new tasks for {repo_full_name}")
        except Exception as e:
            conn.rollback()
            logger.error(f"Error syncing tasks to DB for {repo_full_name}: {e}")
        finally:
            cur.close()
            _put_conn(conn)
            
    except Exception as e:
        logger.error(f"Error fetching tasks from GitHub for {repo_full_name}: {e}")

async def on_pr_comment_created(payload: dict, event: str, pool=None):
    """
    Handle new comments on PRs (both conversation issue comments and code review comments).
    Dispatches push notifications to the PR author, assignees, and project managers.
    """
    from services.notifications import notify_pr_comment

    comment = payload.get("comment", {})
    repo = payload.get("repository", {})
    installation_id = payload.get("installation", {}).get("id")

    comment_user = comment.get("user", {})
    commenter_gh = comment_user.get("login", "")
    comment_body = comment.get("body", "")

    # Ignore comments from GitHub App bots to prevent notification spam / loops
    if not commenter_gh or comment_user.get("type") == "Bot" or commenter_gh.endswith("[bot]"):
        logger.info(f"Skipping notification for bot comment by {commenter_gh}")
        return

    pr_number = None
    pr_title = ""
    pr_url = ""
    pr_author_gh = ""

    if event == "issue_comment":
        issue = payload.get("issue", {})
        if "pull_request" not in issue:
            return  # Not a PR comment
        pr_number = issue.get("number")
        pr_title = issue.get("title", "")
        pr_url = comment.get("html_url") or issue.get("html_url", "")
        pr_author_gh = issue.get("user", {}).get("login", "")
    elif event == "pull_request_review_comment":
        pr = payload.get("pull_request", {})
        pr_number = pr.get("number")
        pr_title = pr.get("title", "")
        pr_url = comment.get("html_url") or pr.get("html_url", "")
        pr_author_gh = pr.get("user", {}).get("login", "")

    if not pr_number or not comment_body:
        return

    repo_full_name = repo.get("full_name", "")
    repo_url = repo.get("html_url") or f"https://github.com/{repo_full_name}"

    target_user_ids = set()
    project_id = None
    commenter_user_id = None

    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Match project
        cur.execute("SELECT id FROM opentask.projects WHERE %s = ANY(gh_repo_url) LIMIT 1;", (repo_url,))
        proj_row = cur.fetchone()
        if not proj_row and installation_id:
            cur.execute(
                "SELECT project_id FROM opentask.github_installations WHERE installation_id = %s LIMIT 1;",
                (installation_id,)
            )
            inst_row = cur.fetchone()
            if inst_row:
                project_id = inst_row["project_id"]
        elif proj_row:
            project_id = proj_row["id"]

        # Add project members
        if project_id:
            cur.execute("SELECT user_id FROM opentask.project_member WHERE project_id = %s;", (project_id,))
            for m in cur.fetchall():
                if m.get("user_id"):
                    target_user_ids.add(m["user_id"])

        # Add PR author
        if pr_author_gh:
            cur.execute("SELECT id FROM opentask.users WHERE gh_username = %s LIMIT 1;", (pr_author_gh,))
            author_row = cur.fetchone()
            if author_row:
                target_user_ids.add(author_row["id"])

        # Exclude commenter
        cur.execute("SELECT id FROM opentask.users WHERE gh_username = %s LIMIT 1;", (commenter_gh,))
        commenter_row = cur.fetchone()
        if commenter_row:
            commenter_user_id = commenter_row["id"]
            target_user_ids.discard(commenter_user_id)

    except Exception as e:
        logger.warning(f"Error resolving users for PR comment notification: {e}")
    finally:
        if cur:
            cur.close()
        _put_conn(conn)

    if target_user_ids:
        try:
            notify_pr_comment(
                pr_number=pr_number,
                pr_title=pr_title,
                pr_url=pr_url,
                commenter_gh=commenter_gh,
                comment_body=comment_body,
                target_user_ids=list(target_user_ids),
                project_id=project_id,
            )
            logger.info(f"✅ Dispatched PR comment notification to {len(target_user_ids)} users.")
        except Exception as e:
            logger.warning(f"⚠️ Failed to dispatch PR comment notification: {e}")

    # Check for on-demand review trigger command in comment: /review, !review, @opentask review
    cmd = comment_body.strip().lower()
    if any(trigger in cmd for trigger in ("/review", "!review", "@opentask review", "@openequilibra review")):
        logger.info(f"⚡ [WEBHOOK] Comment command '{comment_body.strip()[:30]}' detected on PR #{pr_number}. Triggering on-demand AI review...")
        from services.pr_evaluator import process_task_aware_pr_evaluation
        if installation_id and repo_full_name and pr_number:
            try:
                await process_task_aware_pr_evaluation(
                    repo_full_name=repo_full_name,
                    pr_number=pr_number,
                    installation_id=installation_id,
                    pr_title=pr_title,
                    pr_body="",
                )
            except Exception as ev_err:
                logger.error(f"Error in on-demand comment review for PR #{pr_number}: {ev_err}")


async def on_pr_opened(payload: dict, pool=None):
    from services.pr_evaluator import process_task_aware_pr_evaluation
    from services.notifications import notify_pr_opened

    pr = payload.get("pull_request", {})
    repo = payload.get("repository", {})
    installation_id = payload.get("installation", {}).get("id")
    repo_full_name = repo.get("full_name")
    pr_number = pr.get("number")

    # 1. Notify related users (project managers, assignees) that a new PR was opened
    if pr_number and repo_full_name:
        try:
            repo_url = repo.get("html_url") or f"https://github.com/{repo_full_name}"
            pr_url = pr.get("html_url") or f"https://github.com/{repo_full_name}/pull/{pr_number}"
            pr_title = pr.get("title", "")
            author_gh = pr.get("user", {}).get("login", "Unknown")

            target_user_ids = set()
            project_id = None
            conn = _get_conn()
            cur = None
            try:
                cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cur.execute("SELECT id FROM opentask.projects WHERE %s = ANY(gh_repo_url) LIMIT 1;", (repo_url,))
                proj_row = cur.fetchone()
                if not proj_row and installation_id:
                    cur.execute(
                        "SELECT project_id FROM opentask.github_installations WHERE installation_id = %s LIMIT 1;",
                        (installation_id,)
                    )
                    inst_row = cur.fetchone()
                    if inst_row:
                        project_id = inst_row["project_id"]
                elif proj_row:
                    project_id = proj_row["id"]

                if project_id:
                    cur.execute("SELECT user_id FROM opentask.project_member WHERE project_id = %s;", (project_id,))
                    for m in cur.fetchall():
                        if m.get("user_id"):
                            target_user_ids.add(m["user_id"])
            finally:
                if cur:
                    cur.close()
                _put_conn(conn)

            notify_pr_opened(
                pr_number=pr_number,
                pr_title=pr_title,
                pr_url=pr_url,
                author_gh=author_gh,
                repo_full_name=repo_full_name,
                target_user_ids=list(target_user_ids),
                project_id=project_id,
            )
        except Exception as ne:
            logger.warning(f"Failed to dispatch notify_pr_opened: {ne}")

    # 2. Task-Aware AI Evaluation (evaluates against actual project backlog tasks)
    if all([pr_number, repo_full_name, installation_id]):
        await process_task_aware_pr_evaluation(
            repo_full_name=repo_full_name,
            pr_number=pr_number,
            installation_id=installation_id,
            pr_title=pr.get("title", ""),
            pr_body=pr.get("body", "") or "",
            branch_name=pr.get("head", {}).get("ref", ""),
        )

    # 3. Task Synchronization
    await sync_github_tasks(payload)

    # 4. State Management + Forgotten Task Detection
    await handle_pr_opened(payload)


async def on_pr_reopened(payload: dict, pool=None):
    from services.pr_evaluator import process_task_aware_pr_evaluation
    pr = payload.get("pull_request", {})
    repo = payload.get("repository", {})
    installation_id = payload.get("installation", {}).get("id")
    if all([pr.get("number"), repo.get("full_name"), installation_id]):
        await process_task_aware_pr_evaluation(
            repo_full_name=repo["full_name"],
            pr_number=pr["number"],
            installation_id=installation_id,
            pr_title=pr.get("title", ""),
            pr_body=pr.get("body", "") or "",
            branch_name=pr.get("head", {}).get("ref", ""),
        )
        
    await sync_github_tasks(payload)
    await handle_pr_opened(payload)


async def on_pr_synchronize(payload: dict, pool=None):
    from services.pr_evaluator import process_task_aware_pr_evaluation
    pr = payload.get("pull_request", {})
    repo = payload.get("repository", {})
    installation_id = payload.get("installation", {}).get("id")
    if all([pr.get("number"), repo.get("full_name"), installation_id]):
        await process_task_aware_pr_evaluation(
            repo_full_name=repo["full_name"],
            pr_number=pr["number"],
            installation_id=installation_id,
            pr_title=pr.get("title", ""),
            pr_body=pr.get("body", "") or "",
            branch_name=pr.get("head", {}).get("ref", ""),
        )

    await sync_github_tasks(payload)

async def on_pr_closed(payload: dict, pool=None):
    # 1. KPI and Scoring
    await process_kpi_score(payload, pool)
    
    # 2. Task Synchronization (Placeholder)
    await sync_github_tasks(payload)
    
    # 3. Legacy State Management
    await handle_pr_closed(payload)

async def on_pr_review_submitted(payload: dict, pool=None):
    # 1. KPI and Scoring for approvals
    await process_review_kpi(payload, pool)
    
    # 2. Legacy State Management
    await handle_pr_review_submitted(payload)


async def process_kpi_score(payload: dict, pool=None):
    # Completion Event (Merge): lead_assignee_id receives W * 1.0
    pr = payload.get("pull_request", {})
    if not pr.get("merged"):
        return

    branch_name = pr.get("head", {}).get("ref", "")
    
    task_match = re.search(r"^.*?(\d+)-.*$", branch_name)
    if not task_match:
        task_match = re.search(r"(\d+)", branch_name)
        
    if not task_match:
        logger.info("KPI score (completion) not updated: couldn't find task ID in branch")
        return
        
    task_id = int(task_match.group(1))
    
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("BEGIN;")
        
        cur.execute("SELECT id, project_id, weight, lead_assignee_id FROM opentask.tasks WHERE id = %s LIMIT 1;", (task_id,))
        task_row = cur.fetchone()
        if not task_row:
            logger.info(f"Task {task_id} not found in DB.")
            cur.execute("ROLLBACK;")
            return
            
        project_id = task_row["project_id"]
        weight = task_row["weight"] or 0
        lead_assignee_id = task_row["lead_assignee_id"]
        
        if lead_assignee_id:
            score_delta = weight * 1.0
            cur.execute(
                "UPDATE opentask.project_member "
                "SET kpi_score = kpi_score + %s "
                "WHERE user_id = %s AND project_id = %s;",
                (score_delta, lead_assignee_id, project_id)
            )
        
        cur.execute("SELECT id FROM opentask.buckets WHERE project_id = %s AND state = 'COMPLETED' LIMIT 1;", (project_id,))
        bucket_row = cur.fetchone()
        completed_bucket_id = bucket_row["id"] if bucket_row else None
        
        if completed_bucket_id:
            cur.execute(
                "UPDATE opentask.tasks SET bucket_id = %s, updated_at = NOW() WHERE id = %s;",
                (completed_bucket_id, task_id)
            )
            
        cur.execute("COMMIT;")
        if lead_assignee_id:
            logger.info(f"Successfully processed merge KPI for task {task_id}, assignee {lead_assignee_id}, delta {score_delta}")
        
    except Exception as e:
        if cur:
            cur.execute("ROLLBACK;")
        logger.error(f"Error processing KPI atomic update: {e}")
    finally:
        if cur:
            cur.close()
        _put_conn(conn)


async def process_review_kpi(payload: dict, pool=None):
    # Review Event (Approval): Reviewer receives W * 0.2
    review = payload.get("review", {})
    if review.get("state") != "approved":
        return

    pr = payload.get("pull_request", {})
    branch_name = pr.get("head", {}).get("ref", "")
    author_username = pr.get("user", {}).get("login")
    reviewer_username = review.get("user", {}).get("login")
    
    if not reviewer_username or reviewer_username == author_username:
        logger.info("KPI score not updated: reviewer is author or missing")
        return

    task_match = re.search(r"^.*?(\d+)-.*$", branch_name)
    if not task_match:
        task_match = re.search(r"(\d+)", branch_name)
        
    if not task_match:
        return
        
    task_id = int(task_match.group(1))
    
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("BEGIN;")
        
        cur.execute("SELECT id FROM opentask.users WHERE gh_username = %s LIMIT 1;", (reviewer_username,))
        reviewer_row = cur.fetchone()
        if not reviewer_row:
            logger.info(f"Reviewer {reviewer_username} not found in DB.")
            cur.execute("ROLLBACK;")
            return
            
        reviewer_id = reviewer_row["id"]
        
        cur.execute("SELECT id, project_id, weight FROM opentask.tasks WHERE id = %s LIMIT 1;", (task_id,))
        task_row = cur.fetchone()
        if not task_row:
            cur.execute("ROLLBACK;")
            return
            
        project_id = task_row["project_id"]
        weight = task_row["weight"] or 0
        score_delta = weight * 0.2
        
        cur.execute(
            "UPDATE opentask.project_member "
            "SET kpi_score = kpi_score + %s "
            "WHERE user_id = %s AND project_id = %s;",
            (score_delta, reviewer_id, project_id)
        )
            
        cur.execute("COMMIT;")
        logger.info(f"Successfully processed review KPI for task {task_id}, reviewer {reviewer_username}, delta {score_delta}")
        
    except Exception as e:
        if cur:
            cur.execute("ROLLBACK;")
        logger.error(f"Error processing review KPI update: {e}")
    finally:
        if cur:
            cur.close()
        _put_conn(conn)



def find_project_bucket_by_state(repo_url: str, target_state: str):
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id FROM opentask.projects WHERE %s = ANY(gh_repo_url) LIMIT 1;",
            (repo_url,)
        )
        project_row = cur.fetchone()
        if not project_row: return None
        
        # The Magic Query
        cur.execute(
            "SELECT id FROM opentask.buckets WHERE project_id = %s AND state = %s ORDER BY order_idx ASC LIMIT 1;", 
            (project_row["id"], target_state)
        )
        bucket_row = cur.fetchone()
        
        bucket_id = bucket_row["id"] if bucket_row else None
        return project_row["id"], bucket_id
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)

def find_task_by_branch(project_id: int, branch_name: str):
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, title, type, weight FROM opentask.tasks WHERE project_id = %s AND branch_name = %s LIMIT 1;",
            (project_id, branch_name)
        )
        return cur.fetchone()
    finally:
        if cur is not None:
            cur.close()
        _put_conn(conn)

async def handle_pr_closed(payload: dict):
    pr = payload.get("pull_request", {})
    repo_url = payload.get("repository", {}).get("html_url")
    branch_name = pr.get("head", {}).get("ref")
    gh_username = pr.get("user", {}).get("login", "Unknown")

    if not repo_url or not branch_name:
        return

    is_merged = pr.get("merged", False)
    target_state = 'COMPLETED' if is_merged else 'ONGOING'

    project_data = find_project_bucket_by_state(repo_url, target_state)
    if not project_data: return
    project_id, target_bucket_id = project_data

    task = find_task_by_branch(project_id, branch_name)
    if not task: return
    
    if not target_bucket_id:
        logger.error(f"Project {project_id} is missing a bucket with state '{target_state}'")
        return

    try:
        db_update_task(task["id"], DatabaseTask(bucket_id=target_bucket_id, title=task.get("title", ""), type=task.get("type", "CODE"), weight=task.get("weight", 0)), BackgroundTasks()) 
        logger.info(f"Moved task {task['id']} to bucket {target_bucket_id}.")
        
        action_msg = "merged" if is_merged else "closed without merging"
        db_create_activity(DatabaseActivity(
            project_id=project_id,
            user_name=gh_username,
            action=action_msg,
            target=f"PR for {branch_name}"
        ))
    except Exception as e:
        logger.error(f"Failed to move task {task['id']}: {e}")

async def handle_pr_opened(payload: dict):
    pr = payload.get("pull_request", {})
    repo_url = payload.get("repository", {}).get("html_url")
    branch_name = pr.get("head", {}).get("ref")
    gh_username = pr.get("user", {}).get("login", "Unknown")
    pr_number = pr.get("number", 0)

    if not repo_url or not branch_name:
        return

    # Find the task by branch
    project_data = find_project_bucket_by_state(repo_url, "ON_REVIEW")
    if not project_data:
        return
    project_id, target_bucket_id = project_data

    task = find_task_by_branch(project_id, branch_name)
    if not task:
        return

    # Check current task state
    conn = _get_conn()
    cur = None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT b.state, b.name, t.lead_assignee_id, pm.user_id as manager_id "
            "FROM opentask.tasks t "
            "JOIN opentask.buckets b ON t.bucket_id = b.id "
            "LEFT JOIN opentask.project_member pm ON pm.project_id = t.project_id AND pm.role = 'MANAGER' "
            "WHERE t.id = %s LIMIT 1;",
            (task["id"],)
        )
        task_state_row = cur.fetchone()
    finally:
        if cur:
            cur.close()
        _put_conn(conn)

    if task_state_row:
        current_state = task_state_row.get("state", "")
        current_bucket_name = task_state_row.get("name", "Unknown")
        manager_id = task_state_row.get("manager_id")
        task_title = task.get("title", "Task")

        # FORGOTTEN TASK: task is in TODO or DRAFT but PR was opened
        if current_state in ("TODO", "DRAFT", "PENDING"):
            logger.warning(f"[FORGOTTEN TASK] PR #{pr_number} opened for task '{task_title}' still in {current_state}")

            # Create alert for project manager
            if manager_id:
                try:
                    alert_conn = _get_conn()
                    alert_cur = None
                    try:
                        alert_cur = alert_conn.cursor()
                        alert_id = _generator.generate()
                        alert_cur.execute(
                            """
                            INSERT INTO opentask.alerts
                                (id, user_id, context_id, project_id, title, description, type, severity, suggested_actions, is_resolved)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE);
                            """,
                            (
                                alert_id,
                                manager_id,
                                task["id"],
                                project_id,
                                f"⚠️ Forgotten Task: {task_title}",
                                f"{gh_username} opened PR #{pr_number} for task '{task_title}', but the task is still in '{current_bucket_name}'. The developer may have forgotten to move it to ONGOING.",
                                "FORGOTTEN_TASK",
                                "warning",
                                ["Move task to ONGOING", "Review the PR", "Contact developer"]
                            )
                        )
                        alert_conn.commit()
                        logger.info(f"[FORGOTTEN TASK] Alert created for manager {manager_id}")
                    except Exception as ae:
                        alert_conn.rollback()
                        logger.error(f"[FORGOTTEN TASK] Failed to create alert: {ae}")
                    finally:
                        if alert_cur:
                            alert_cur.close()
                        _put_conn(alert_conn)
                except Exception as e:
                    logger.error(f"[FORGOTTEN TASK] Error in alert creation: {e}")

            # Log activity but DON'T auto-move task for forgotten tasks
            try:
                db_create_activity(DatabaseActivity(
                    project_id=project_id,
                    user_name=gh_username,
                    action=f"opened PR #{pr_number} (⚠️ task still in {current_bucket_name})",
                    target=task_title
                ))
            except Exception as e:
                logger.error(f"[FORGOTTEN TASK] Failed to log activity: {e}")
            return  # Don't auto-move

    # Normal flow: task is ONGOING, move to ON_REVIEW
    if not target_bucket_id:
        logger.error(f"Project {project_id} is missing a bucket with state 'ON_REVIEW'")
        return

    try:
        db_update_task(task["id"], DatabaseTask(bucket_id=target_bucket_id, title=task.get("title", ""), type=task.get("type", "CODE"), weight=task.get("weight", 0)), BackgroundTasks())
        logger.info(f"Moved task {task['id']} to bucket {target_bucket_id}.")
        db_create_activity(DatabaseActivity(
            project_id=project_id,
            user_name=gh_username,
            action="opened",
            target=f"PR for {branch_name}"
        ))
    except Exception as e:
        logger.error(f"Failed to move task {task['id']}: {e}")


async def handle_pr_review_submitted(payload: dict):
    review = payload.get("review", {})
    state = review.get("state")
    
    if state != "changes_requested":
        return

    pr = payload.get("pull_request", {})
    repo_url = payload.get("repository", {}).get("html_url")
    branch_name = pr.get("head", {}).get("ref")
    gh_username = review.get("user", {}).get("login", "Unknown")

    if not repo_url or not branch_name:
        return

    project_data = find_project_bucket_by_state(repo_url, "ONGOING")
    if not project_data: return
    project_id, target_bucket_id = project_data
    
    if not target_bucket_id: 
        logger.error(f"Project {project_id} is missing a bucket with state 'ONGOING'")
        return

    task = find_task_by_branch(project_id, branch_name)
    if not task:
        return

    try:
        db_update_task(task["id"], DatabaseTask(bucket_id=target_bucket_id, title=task.get("title", ""), type=task.get("type", "CODE"), weight=task.get("weight", 0)), BackgroundTasks())
        logger.info(f"Moved task {task['id']} to bucket {target_bucket_id}.")
        db_create_activity(DatabaseActivity(
            project_id=project_id,
            user_name=gh_username,
            action="requested changes on",
            target=f"PR for {branch_name}"
        ))
    except Exception as e:
        logger.error(f"Failed to move task {task['id']}: {e}")
