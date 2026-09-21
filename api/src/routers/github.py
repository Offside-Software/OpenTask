import json
import httpx
import logging
import hmac
import hashlib
from fastapi import APIRouter, Request, HTTPException, Header, BackgroundTasks, Depends
from routers.auth import get_current_user
from github_app import get_github_client, get_github_integration, verify_webhook_signature
from services.pr_evaluator import process_pr_evaluation
from services.webhook_handlers import handle_pr_closed, handle_pr_opened

router = APIRouter(tags=["GitHub App"])
logger = logging.getLogger("uvicorn.error")


@router.get("/github/app")
def get_app_info():
    gi = get_github_integration()
    app_info = gi.get_app()
    return {
        "id": app_info.id,
        "name": app_info.name,
        "description": app_info.description,
        "html_url": app_info.html_url,
    }


@router.get("/github/repos")
def list_repos(installation_id: int | None = None):
    try:
        gh = get_github_client(installation_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    repos = [
        {"full_name": r.full_name, "private": r.private, "url": r.html_url}
        for r in gh.get_repos()
    ]
    return {"repos": repos}


@router.get("/github/installations")
def list_github_installations():
    """List all GitHub App installations accessible to this App (for the installation picker UI)."""
    import jwt as _jwt
    import time
    from config import settings as _settings

    private_key = _settings.gh_app_private_key.replace("\\n", "\n")
    payload = {
        "iat": int(time.time()) - 60,
        "exp": int(time.time()) + (10 * 60),
        "iss": str(_settings.gh_app_id)
    }
    jwt_token = _jwt.encode(payload, private_key, algorithm="RS256")

    import httpx
    with httpx.Client(timeout=15.0) as http:
        resp = http.get(
            "https://api.github.com/app/installations",
            headers={
                "Authorization": f"Bearer {jwt_token}",
                "Accept": "application/vnd.github.v3+json"
            },
            params={"per_page": 100}
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to list GitHub App installations")

    installations = resp.json()
    return {
        "installations": [
            {
                "installation_id": inst["id"],
                "account_login": inst["account"]["login"],
                "account_type": inst["account"]["type"],
                "account_avatar_url": inst["account"]["avatar_url"],
                "app_install_url": f"https://github.com/apps/{inst.get('app_slug', 'opentask')}/installations/new",
            }
            for inst in installations
        ]
    }


@router.get("/github/installations/{installation_id}/repos")
def list_installation_repos(installation_id: int):
    """List repos for a specific GitHub App installation."""
    import jwt as _jwt
    import time
    from config import settings as _settings
    import httpx

    private_key = _settings.gh_app_private_key.replace("\\n", "\n")
    payload = {
        "iat": int(time.time()) - 60,
        "exp": int(time.time()) + (10 * 60),
        "iss": str(_settings.gh_app_id)
    }
    jwt_token = _jwt.encode(payload, private_key, algorithm="RS256")

    with httpx.Client(timeout=15.0) as http:
        # Get installation token
        token_resp = http.post(
            f"https://api.github.com/app/installations/{installation_id}/access_tokens",
            headers={
                "Authorization": f"Bearer {jwt_token}",
                "Accept": "application/vnd.github.v3+json"
            }
        )
        if token_resp.status_code != 201:
            raise HTTPException(status_code=502, detail="Failed to get installation token")
        inst_token = token_resp.json()["token"]

        repos_resp = http.get(
            "https://api.github.com/installation/repositories",
            headers={
                "Authorization": f"token {inst_token}",
                "Accept": "application/vnd.github.v3+json"
            },
            params={"per_page": 100}
        )
        if repos_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to list installation repos")

    repos = repos_resp.json().get("repositories", [])
    return {
        "repos": [
            {
                "full_name": r["full_name"],
                "html_url": r["html_url"],
                "private": r["private"],
                "description": r.get("description"),
            }
            for r in repos
        ]
    }


@router.get("/github/app/install-url")
def get_app_install_url():
    """Return the GitHub App installation URL for connecting new orgs/accounts."""
    gi = get_github_integration()
    app_info = gi.get_app()
    app_slug = getattr(app_info, 'slug', None) or app_info.name.lower().replace(' ', '-')
    return {
        "install_url": f"https://github.com/apps/{app_slug}/installations/new"
    }


async def verify_signature(
    request: Request,
    x_hub_signature_256: str | None = Header(default=None),
) -> dict:
    import hmac
    import hashlib
    from config import settings

    raw_body = await request.body()
    secret = (settings.gh_webhook_secret or "").strip().strip("'\"")

    if not secret:
        # If no secret configured in environment, allow payload through with warning
        logger.warning("[GITHUB_WEBHOOK] No GH_WEBHOOK_SECRET configured; processing payload without signature verification.")
        try:
            return json.loads(raw_body)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if not x_hub_signature_256:
        raise HTTPException(status_code=401, detail="Missing signature")
    
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, x_hub_signature_256):
        logger.warning("[GITHUB_WEBHOOK] Invalid webhook signature detected.")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        return json.loads(raw_body)
    except json.JSONDecodeError:
        logger.error("[GITHUB_WEBHOOK] Invalid JSON payload received.")
        raise HTTPException(status_code=400, detail="Invalid JSON payload")


@router.post("/github/webhook")
async def github_webhook(
    request: Request,
    payload: dict = Depends(verify_signature),
    x_github_event: str | None = Header(default=None),
):
    """
    Receive and verify GitHub webhook payloads.
    Only processes events whose signature matches the webhook secret.
    Directly awaits event processing so serverless environments (like Vercel)
    keep the execution context alive until the evaluation and notifications finish.
    """
    event = x_github_event or "unknown"
    action = payload.get("action", "")
    logger.info(f"📥 [GITHUB_WEBHOOK] Received event '{event}' (action: '{action}')")
    
    from services.webhook_handlers import process_github_event
    try:
        await process_github_event(payload, event)
    except Exception as e:
        logger.error(f"[GITHUB_WEBHOOK] Error executing webhook event '{event}': {e}", exc_info=True)
    
    return {"status": "accepted"}

@router.get("/github/users/search")
async def search_github_users(query: str, current_user: dict = Depends(get_current_user)):
    del current_user
    normalized_query = query.strip()
    if len(normalized_query) < 2:
        return {"items": []}

    async with httpx.AsyncClient(timeout=10.0) as http:
        response = await http.get(
            "https://api.github.com/search/users",
            params={"q": f"{normalized_query} in:login", "per_page": 8},
            headers={"Accept": "application/vnd.github+json"},
        )

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to query GitHub usernames")

    payload = response.json()
    items = payload.get("items", [])
    return {
        "items": [
            {
                "login": item.get("login"),
                "avatar_url": item.get("avatar_url"),
                "html_url": item.get("html_url"),
            }
            for item in items
        ]
    }