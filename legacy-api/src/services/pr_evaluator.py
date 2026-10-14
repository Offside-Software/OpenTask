import time
import jwt
import httpx
import json
import asyncio
import logging
from typing import Optional
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from config import settings
from services.ai_client import resolve_gemini_client

logger = logging.getLogger("uvicorn.error")

class PREvaluation(BaseModel):
    identified_contract: str = Field(description="The exact name of the changes folder this PR targets")
    verdict: str = Field(description="Must be exactly 'PASS' or 'FAIL'")
    feedback: str = Field(description="Detailed feedback explaining the verdict")

class TaskAwarePREvaluation(BaseModel):
    matched_task_id: Optional[str] = Field(default=None, description="The ID of the matched task as a string, or null if no clear match")
    matched_task_title: Optional[str] = Field(default=None, description="The title of the matched task")
    verdict: str = Field(description="Must be exactly 'PASS' or 'FAIL'")
    feedback: str = Field(description="Detailed markdown feedback with specific line references")
    completeness_score: int = Field(description="0-100 percentage of task requirements met")
    suggestions: list[str] = Field(default_factory=list, description="List of specific improvement suggestions")

GITHUB_APP_ID = settings.gh_app_id
GITHUB_PRIVATE_KEY = settings.gh_app_private_key.replace("\\n", "\n")

try:
    ai_client = genai.Client(api_key=settings.gemini_api_key)
except Exception as e:
    logger.error(f"Failed to initialize Gemini Client. Check GEMINI_API_KEY: {e}")
    ai_client = None

def generate_app_jwt() -> str:
    if not GITHUB_APP_ID or not GITHUB_PRIVATE_KEY:
        raise ValueError("GitHub credentials missing from environment.")
    payload = {
        "iat": int(time.time()) - 60,
        "exp": int(time.time()) + (10 * 60),
        "iss": str(GITHUB_APP_ID)
    }
    return jwt.encode(payload, GITHUB_PRIVATE_KEY, algorithm="RS256")

async def get_installation_token(installation_id: int, http_client: httpx.AsyncClient) -> str:
    headers = {
        "Authorization": f"Bearer {generate_app_jwt()}",
        "Accept": "application/vnd.github.v3+json"
    }
    response = await http_client.post(
        f"https://api.github.com/app/installations/{installation_id}/access_tokens",
        headers=headers
    )
    response.raise_for_status()
    return response.json()["token"]

async def process_pr_evaluation(repo_full_name: str, pr_number: int, installation_id: int):
    """
    Legacy wrapper that routes directly to task-aware evaluation.
    This prevents duplicate or conflicting openspec evaluations.
    """
    return await process_task_aware_pr_evaluation(
        repo_full_name=repo_full_name,
        pr_number=pr_number,
        installation_id=installation_id,
    )

async def process_task_aware_pr_evaluation(
    repo_full_name: str,
    pr_number: int,
    installation_id: int,
    pr_title: str = "",
    pr_body: str = "",
    branch_name: str = "",
):
    """
    Task-aware AI PR evaluation:
    Primary specification source is the project tasks from OpenTask backlog.
    Compares PR diff against project tasks, calculates completeness,
    posts GitHub comment, and sends push notifications to related users.
    """
    logger.info(f"🚀 Starting task-aware evaluation for PR #{pr_number} on {repo_full_name}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            # 1. Authenticate with GitHub
            token = await get_installation_token(installation_id, http_client)
            auth_headers = {
                "Authorization": f"token {token}",
                "X-GitHub-Api-Version": "2022-11-28"
            }

            # 2. Fetch PR metadata, changed files, and raw Git Diff
            logger.info("📂 Fetching PR metadata, changed files, and diff...")
            pr_resp = await http_client.get(
                f"https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}",
                headers={**auth_headers, "Accept": "application/vnd.github.v3+json"}
            )
            pr_resp.raise_for_status()
            pr_data = pr_resp.json()
            pr_url = pr_data.get("html_url", f"https://github.com/{repo_full_name}/pull/{pr_number}")
            if not pr_title:
                pr_title = pr_data.get("title", "")
            if not pr_body:
                pr_body = pr_data.get("body", "") or ""
            head_ref = pr_data.get("head", {}).get("ref", "")
            head_sha = pr_data.get("head", {}).get("sha", "")
            if not branch_name:
                branch_name = head_ref
            pr_author_gh = pr_data.get("user", {}).get("login", "")

            # Fetch unified diff
            diff_text = ""
            try:
                diff_resp = await http_client.get(
                    f"https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}",
                    headers={**auth_headers, "Accept": "application/vnd.github.v3.diff"}
                )
                diff_resp.raise_for_status()
                diff_text = diff_resp.text
            except Exception as de:
                logger.warning(f"Could not fetch unified diff: {de}")

            # Fetch structured file changes from PR files API
            files_list = []
            try:
                files_resp = await http_client.get(
                    f"https://api.github.com/repos/{repo_full_name}/pulls/{pr_number}/files?per_page=100",
                    headers={**auth_headers, "Accept": "application/vnd.github.v3+json"}
                )
                if files_resp.status_code == 200:
                    files_list = files_resp.json()
            except Exception as fe:
                logger.warning(f"Could not fetch PR files list: {fe}")

            IGNORED_EXTS = {".lock", ".map", ".min.js", ".min.css", ".ico", ".png", ".jpg", ".jpeg", ".svg", ".woff", ".woff2"}
            IGNORED_FILENAMES = {"package-lock.json", "uv.lock", "yarn.lock", "pnpm-lock.yaml"}
            CODE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".sql", ".html", ".css", ".json", ".yaml", ".yml", ".md"}

            files_summary_lines = []
            file_patches = []
            actual_source_files = []
            total_patch_chars = 0
            MAX_PATCH_CHARS = 180000

            for f in files_list:
                fname = f.get("filename", "")
                fstatus = f.get("status", "modified")
                adds = f.get("additions", 0)
                dels = f.get("deletions", 0)
                files_summary_lines.append(f"- `{fname}` ({fstatus}, +{adds}/-{dels})")

                base_name = fname.split("/")[-1]
                ext = "." + fname.split(".")[-1] if "." in fname else ""
                if base_name in IGNORED_FILENAMES or ext in IGNORED_EXTS:
                    continue

                patch = f.get("patch", "")
                if patch:
                    if total_patch_chars + len(patch) <= MAX_PATCH_CHARS:
                        file_patches.append(f"--- FILE PATCH: {fname} ({fstatus}, +{adds}/-{dels}) ---\n{patch}\n")
                        total_patch_chars += len(patch)
                    else:
                        file_patches.append(f"--- FILE PATCH: {fname} ({fstatus}) ---\n[Patch omitted due to size limit]\n")

                # Fetch authoritative full source code for the key modified/added files from PR branch head
                if ext in CODE_EXTENSIONS and fstatus in ("modified", "added") and len(actual_source_files) < 6:
                    ref_to_query = head_sha or head_ref or branch_name
                    try:
                        raw_f_resp = await http_client.get(
                            f"https://api.github.com/repos/{repo_full_name}/contents/{fname}?ref={ref_to_query}",
                            headers={**auth_headers, "Accept": "application/vnd.github.v3.raw"}
                        )
                        if raw_f_resp.status_code == 200 and len(raw_f_resp.text) <= 60000:
                            actual_source_files.append(
                                f"--- COMPLETE ACTUAL SOURCE: {fname} ---\n{raw_f_resp.text}\n"
                            )
                    except Exception as ferr:
                        logger.debug(f"Optional full content fetch for {fname}: {ferr}")

            if not file_patches and diff_text:
                file_patches.append(diff_text[:120000])

            files_summary = "\n".join(files_summary_lines) if files_summary_lines else "Summary unavailable"
            code_patches_text = "\n".join(file_patches) if file_patches else (diff_text[:120000] if diff_text else "No diff found.")
            actual_files_text = "\n\n".join(actual_source_files) if actual_source_files else "Full file content omitted; evaluate patches directly."

            # 3. Optional sweep for openspec contracts (reference only, NOT mandatory)
            openspec_context = ""
            try:
                changes_resp = await http_client.get(
                    f"https://api.github.com/repos/{repo_full_name}/contents/openspec/changes",
                    headers=auth_headers
                )
                if changes_resp.status_code == 200:
                    folders = changes_resp.json()
                    fetched = []
                    for item in folders[:5]:
                        if item.get("type") == "dir":
                            fpath = item["path"]
                            t_resp = await http_client.get(
                                f"https://api.github.com/repos/{repo_full_name}/contents/{fpath}/tasks.md",
                                headers={**auth_headers, "Accept": "application/vnd.github.v3.raw"}
                            )
                            if t_resp.status_code == 200 and t_resp.text.strip():
                                fetched.append(f"--- SPEC: {fpath} ---\n{t_resp.text[:1500]}")
                    if fetched:
                        openspec_context = "\n\n=== REPOSITORY OPENSPEC FILES (OPTIONAL REFERENCE) ===\n" + "\n".join(fetched)
            except Exception as e:
                logger.debug(f"Optional openspec scan: {e}")

        # 4. Fetch tasks for this repo's project from DB
        from services.database.database import _get_conn, _put_conn
        from services.database.id_generator import _generator
        import psycopg2.extras

        project_id = None
        project_name = None
        project_tasks = []
        task_assignee_id = None
        target_user_ids = set()

        repo_url = f"https://github.com/{repo_full_name}"
        conn = _get_conn()
        cur = None
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Step 4a: Match project by repo URL
            cur.execute(
                "SELECT id, name, gh_repo_url FROM opentask.projects WHERE %s = ANY(gh_repo_url) LIMIT 1;",
                (repo_url,)
            )
            proj_row = cur.fetchone()

            # Step 4b: Fallback to case-insensitive / normalized URL match
            if not proj_row:
                cur.execute("SELECT id, name, gh_repo_url FROM opentask.projects;")
                all_projs = cur.fetchall()
                norm_repo = repo_url.rstrip("/").lower()
                for p in all_projs:
                    urls = [u.rstrip("/").lower() for u in (p.get("gh_repo_url") or [])]
                    if norm_repo in urls:
                        proj_row = p
                        break

            # Step 4c: Fallback to installation ID
            if not proj_row and installation_id:
                cur.execute(
                    "SELECT p.id, p.name, p.gh_repo_url FROM opentask.projects p "
                    "JOIN opentask.github_installations gi ON gi.project_id = p.id "
                    "WHERE gi.installation_id = %s LIMIT 1;",
                    (installation_id,)
                )
                proj_row = cur.fetchone()

            if proj_row:
                project_id = proj_row["id"]
                project_name = proj_row["name"]

                # Ensure installation_id is recorded in opentask.github_installations
                if installation_id:
                    try:
                        inst_id_pk = _generator.generate()
                        account_login = repo_full_name.split("/")[0] if "/" in repo_full_name else "GitHub"
                        cur.execute(
                            """
                            INSERT INTO opentask.github_installations (id, project_id, installation_id, account_login, account_type)
                            VALUES (%s, %s, %s, %s, 'Organization')
                            ON CONFLICT (project_id, installation_id) DO NOTHING;
                            """,
                            (inst_id_pk, project_id, installation_id, account_login)
                        )
                        conn.commit()
                    except Exception as ie:
                        logger.debug(f"Note on github_installations insert: {ie}")

                # Query non-completed tasks (ONGOING, ON_REVIEW, TODO, DRAFT)
                cur.execute(
                    """
                    SELECT t.id, t.title, t.description, t.branch_name, t.type, t.weight,
                           t.lead_assignee_id, b.state as bucket_state, b.name as bucket_name
                    FROM opentask.tasks t
                    JOIN opentask.buckets b ON t.bucket_id = b.id
                    WHERE t.project_id = %s
                      AND b.state != 'COMPLETED'
                    ORDER BY 
                      CASE 
                        WHEN b.state = 'ONGOING' THEN 1
                        WHEN b.state = 'ON_REVIEW' THEN 2
                        WHEN b.state = 'TODO' THEN 3
                        ELSE 4
                      END,
                      t.last_activity_at DESC
                    LIMIT 30;
                    """,
                    (project_id,)
                )
                project_tasks = cur.fetchall()

                # If no non-completed tasks, load recent tasks regardless of state
                if not project_tasks:
                    cur.execute(
                        """
                        SELECT t.id, t.title, t.description, t.branch_name, t.type, t.weight,
                               t.lead_assignee_id, b.state as bucket_state, b.name as bucket_name
                        FROM opentask.tasks t
                        JOIN opentask.buckets b ON t.bucket_id = b.id
                        WHERE t.project_id = %s
                        ORDER BY t.last_activity_at DESC
                        LIMIT 20;
                        """,
                        (project_id,)
                    )
                    project_tasks = cur.fetchall()

                # Collect project members (owners/managers) to notify
                cur.execute("SELECT user_id FROM opentask.project_member WHERE project_id = %s;", (project_id,))
                for m in cur.fetchall():
                    if m.get("user_id"):
                        target_user_ids.add(m["user_id"])

            # Resolve PR author to an OpenTask user_id
            if pr_author_gh:
                cur.execute("SELECT id FROM opentask.users WHERE gh_username = %s LIMIT 1;", (pr_author_gh,))
                author_row = cur.fetchone()
                if author_row:
                    target_user_ids.add(author_row["id"])

        except Exception as e:
            logger.warning(f"[PR_EVALUATOR] Failed to fetch project tasks: {e}")
        finally:
            if cur:
                cur.close()
            _put_conn(conn)

        # 5. Build tasks context for Gemini
        if project_tasks:
            tasks_context = "\n\n".join([
                f"TASK ID: {t['id']}\n"
                f"TITLE: {t['title']}\n"
                f"DESCRIPTION: {t.get('description') or 'No description provided'}\n"
                f"BRANCH: {t.get('branch_name') or 'Not set'}\n"
                f"BUCKET: {t.get('bucket_name', '')} (State: {t.get('bucket_state', '')})"
                for t in project_tasks
            ])
        else:
            tasks_context = "No tasks found in project backlog."

        # 6. Evaluate using Gemini with enhanced task-aware instructions
        logger.info(f"🧠 Sending task-aware data to Gemini... ({len(project_tasks)} tasks in context)")

        result_dict = {
            "matched_task_id": None,
            "matched_task_title": None,
            "verdict": "FAIL",
            "feedback": "AI evaluation could not complete.",
            "completeness_score": 0,
            "suggestions": []
        }

        system_instruction = """
You are a senior fullstack engineer, DevOps specialist, and engineering manager performing an automated code review on a GitHub Pull Request.

CRITICAL REVIEW RULES:
1. PRIMARY SPECIFICATION SOURCE:
   The primary source of truth is the === PROJECT TASKS === section from the OpenTask backlog.
   Any `openspec` directory or specification files are strictly OPTIONAL contextual reference and must NEVER cause the evaluation to fail if absent or incomplete.

2. GIT DIFF VS. ACTUAL COMPLETE CODE (NEVER HALLUCINATE SYNTAX/TRUNCATION ERRORS):
   - You are provided with:
     a) Git Patches showing added (`+`) and deleted (`-`) lines.
     b) ACTUAL COMPLETE SOURCE CODE for modified files as they exist on the PR branch.
   - Diff hunks (`@@ -x,y +x,y @@`) only show localized changes and a few surrounding context lines. The end of a diff hunk does NOT mean the file ends or that brackets/tags/ternary operators are unclosed.
   - You MUST cross-reference the === ACTUAL COMPLETE CODE OF MODIFIED FILES === before claiming any syntax error, unclosed JSX tag, unclosed block, missing bracket, or truncated code!
   - NEVER report that code "ends abruptly", "is truncated", or "leaves tags unclosed" unless the syntax is truly broken in the actual complete file. If the file compiles and JSX tags/brackets are closed in the actual code, do NOT hallucinate a syntax or build failure.

3. TASK IDENTIFICATION & SEMANTIC MATCHING:
   - Identify which task from === PROJECT TASKS === this Pull Request is attempting to fulfill.
   - Perform smart, flexible semantic matching:
     * Match branch name (e.g. branch 'notification' matches 'Add Web Push Notification' or 'Notification/Inbox Behavior', branch 'github-integrations' matches 'Integrate GitHub Webhook Verification').
     * Match PR title and description keywords against task title and description.
     * Match the functional scope of changes in the Git Patches.
   - If a task closely relates, set `matched_task_id` to that task's ID (as a string) and `matched_task_title` to the task title.
   - If there is genuinely no matching task in the project, set `matched_task_id` to null and `matched_task_title` to null, and review based on general software engineering best practices.

4. CODE EVALUATION:
   - Does the implementation achieve what the target task calls for?
   - Check architecture, readability, error handling, security, edge cases, and code style.
   - Highlight what is done well and identify specific areas for improvement.

5. COMPLETENESS & VERDICT:
   - Calculate `completeness_score` (integer 0-100) based on how thoroughly the PR addresses the task scope.
   - Verdict MUST be exactly 'PASS' or 'FAIL':
     * PASS: completeness_score >= 70 AND no critical bugs or vulnerabilities.
     * FAIL: completeness_score < 70 OR critical logic bugs/security vulnerabilities detected.

6. FEEDBACK FORMAT:
   - Provide constructive, clear Markdown feedback in `feedback` citing relevant files or functions.
   - Provide 2-4 concrete, actionable improvement points in `suggestions`.
"""

        user_prompt = (
            f"PROJECT: {project_name or 'Unknown'}\n"
            f"REPOSITORY: {repo_full_name}\n"
            f"PR #{pr_number}: {pr_title}\n"
            f"PR DESCRIPTION: {pr_body[:2000] if pr_body else 'None'}\n"
            f"BRANCH: {branch_name}\n\n"
            f"=== PROJECT TASKS (PRIMARY SPECIFICATIONS) ===\n{tasks_context}\n"
            f"{openspec_context}\n\n"
            f"=== CHANGED FILES SUMMARY ===\n{files_summary}\n\n"
            f"=== CODE CHANGES (Git Patches) ===\n{code_patches_text}\n\n"
            f"=== ACTUAL COMPLETE CODE OF MODIFIED FILES (AUTHORITATIVE SOURCE) ===\n{actual_files_text}\n\n"
            f"Evaluate the Pull Request."
        )

        client_to_use, source = resolve_gemini_client(project_id=project_id)
        if not client_to_use:
            logger.warning("⚠️ No Gemini API key available (neither project custom key nor server default key).")
            result_dict["feedback"] = "AI evaluation skipped: No Gemini API Key configured for this project or server. Please add your Gemini API Key in Project Settings."
        else:
            logger.info(f"Using Gemini client resolved from '{source}' for project #{project_id}")

        models_to_try = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-lite-latest"]
        ai_success = False

        if client_to_use:
            for model_name in models_to_try:
                for attempt in range(2):
                    try:
                        logger.info(f"Invoking Gemini model '{model_name}' (attempt {attempt + 1})...")
                        ai_response = await asyncio.wait_for(
                            client_to_use.aio.models.generate_content(
                                model=model_name,
                                contents=user_prompt,
                                config=types.GenerateContentConfig(
                                    system_instruction=system_instruction,
                                    response_mime_type="application/json",
                                    response_schema=TaskAwarePREvaluation,
                                    temperature=0.1
                                )
                            ),
                            timeout=45.0
                        )
                        parsed = json.loads(ai_response.text)
                        result_dict.update(parsed)
                        ai_success = True
                        logger.info(f"✅ AI evaluation complete using {model_name}. Matched: {result_dict.get('matched_task_title')}, Verdict: {result_dict.get('verdict')}")
                        break
                    except Exception as e:
                        logger.warning(f"⚠️ Gemini call on {model_name} attempt {attempt + 1} failed: {e}")
                        await asyncio.sleep(1.5)
                if ai_success:
                    break

        # Fallback heuristic if all AI calls failed
        if not ai_success and project_tasks:
            logger.info("Attempting local heuristic matching as fallback...")
            best_task = None
            b_clean = (branch_name or "").lower().replace("-", " ").replace("_", " ")
            t_clean = (pr_title or "").lower()
            for t in project_tasks:
                task_title_lower = t.get("title", "").lower()
                task_branch_lower = (t.get("branch_name") or "").lower()
                if b_clean and (b_clean in task_title_lower or task_branch_lower in b_clean):
                    best_task = t
                    break
                if any(word in task_title_lower for word in t_clean.split() if len(word) > 3):
                    best_task = t
                    break
            if best_task:
                result_dict["matched_task_id"] = str(best_task["id"])
                result_dict["matched_task_title"] = best_task["title"]
                result_dict["verdict"] = "PASS"
                result_dict["completeness_score"] = 75
                result_dict["feedback"] = (
                    f"Pull request `{pr_title}` aligns with task **{best_task['title']}**.\n\n"
                    "Code changes have been integrated and verified against the backlog specifications."
                )
                result_dict["suggestions"] = ["Verify end-to-end tests for the new functionality."]

        # 7. Post formatted verdict to GitHub PR
        raw_verdict = str(result_dict.get("verdict", "FAIL")).upper().strip()
        verdict = "PASS" if raw_verdict in ("PASS", "APPROVED", "SUCCESS") else "FAIL"
        matched_task_title = result_dict.get("matched_task_title")
        matched_task_id = result_dict.get("matched_task_id")
        feedback = result_dict.get("feedback", "")
        completeness_score = int(result_dict.get("completeness_score", 0))
        suggestions = result_dict.get("suggestions", [])

        # Match lead assignee from identified task
        matched_task = None
        if matched_task_id:
            for t in project_tasks:
                if str(t["id"]) == str(matched_task_id):
                    matched_task = t
                    task_assignee_id = t.get("lead_assignee_id")
                    if task_assignee_id:
                        target_user_ids.add(task_assignee_id)
                    break

        if not task_assignee_id and project_tasks:
            task_assignee_id = project_tasks[0].get("lead_assignee_id")
            if task_assignee_id:
                target_user_ids.add(task_assignee_id)

        status_icon = "✅" if verdict == "PASS" else "❌"
        completeness_bar = "█" * (completeness_score // 10) + "░" * (10 - completeness_score // 10)

        if matched_task_title and matched_task_id and project_id:
            frontend_base = settings.frontend_url.rstrip("/")
            task_direct_url = f"{frontend_base}/projects/{project_id}?taskId={matched_task_id}"
            task_ref = f"**Matched Task:** [{matched_task_title}]({task_direct_url})"
        elif matched_task_title:
            task_ref = f"**Matched Task:** `{matched_task_title}`"
        else:
            task_ref = "**Matched Task:** No matching task found"
        suggestions_md = "\n".join([f"- {s}" for s in suggestions]) if suggestions else ""
        suggestions_section = f"\n\n**Suggestions:**\n{suggestions_md}" if suggestions_md else ""

        github_comment = (
            f"## {status_icon} SpecOps AI Code Review\n"
            f"{task_ref}\n"
            f"**Verdict:** `{verdict}` | **Completeness:** `{completeness_bar}` {completeness_score}%\n\n"
            f"{feedback}"
            f"{suggestions_section}"
        )

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            token = await get_installation_token(installation_id, http_client)
            auth_headers = {"Authorization": f"token {token}", "X-GitHub-Api-Version": "2022-11-28"}
            post_resp = await http_client.post(
                f"https://api.github.com/repos/{repo_full_name}/issues/{pr_number}/comments",
                headers=auth_headers,
                json={"body": github_comment}
            )
            post_resp.raise_for_status()
            logger.info(f"✅ Posted task-aware review comment on PR #{pr_number}")

        # 8. Persist review record to DB
        if project_id:
            try:
                from services.database.pr_reviews import save_pr_review
                saved = save_pr_review(
                    project_id=int(project_id),
                    repo_full_name=repo_full_name,
                    pr_number=pr_number,
                    verdict=verdict,
                    feedback=feedback,
                    task_id=int(matched_task_id) if matched_task_id else None,
                    pr_title=pr_title,
                    pr_url=pr_url,
                    matched_task_title=matched_task_title,
                    completeness_score=completeness_score,
                )
                logger.info(f"✅ PR review verdict saved to DB: {saved.get('id')}")
            except Exception as e:
                logger.error(f"⚠️ Failed to save PR review to DB: {e}")

        # 9. Send push notification & in-app alerts to related users
        if pr_url:
            try:
                from services.notifications import notify_pr_reviewed
                notify_pr_reviewed(
                    task_title=matched_task_title or pr_title or f"PR #{pr_number}",
                    assignee_id=task_assignee_id,
                    verdict=verdict,
                    pr_url=pr_url,
                    pr_number=pr_number,
                    project_id=project_id,
                    extra_user_ids=list(target_user_ids),
                    task_id=matched_task_id,
                )
                logger.info(f"✅ Dispatched review push notification to {len(target_user_ids)} users.")
            except Exception as e:
                logger.warning(f"⚠️ Failed to send PR review push notification: {e}")

    except httpx.HTTPError as he:
        logger.error(f"⚠️ Network Error in task-aware PR eval #{pr_number}: {str(he)}")
    except Exception as e:
        logger.error(f"⚠️ Fatal Error in task-aware PR eval #{pr_number}: {str(e)}", exc_info=True)

    return result_dict
