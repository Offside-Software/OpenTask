import json
import httpx
import logging
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
                "app_install_url": f"https://github.com/apps/{inst.get('app_slug', 'openequilibra')}/installations/new",
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
    if not x_hub_signature_256:
        raise HTTPException(status_code=401, detail="Missing signature")
    
    raw_body = await request.body()
    expected = "sha256=" + __import__("hmac").new(
        __import__("config").settings.gh_webhook_secret.encode(),
        raw_body,
        __import__("hashlib").sha256,
    ).hexdigest()

    if not __import__("hmac").compare_digest(expected, x_hub_signature_256):
        logger.warning("Invalid webhook signature detected.")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        return __import__("json").loads(raw_body)
    except __import__("json").JSONDecodeError:
        logger.error("Invalid JSON payload received.")
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

@router.post("/github/webhook")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    payload: dict = Depends(verify_signature),
    x_github_event: str | None = Header(default=None),
):
    """
    Receive and verify GitHub webhook payloads.
    Only processes events whose signature matches the webhook secret.
    """
    event = x_github_event or "unknown"
    
    from services.webhook_handlers import process_github_event
    background_tasks.add_task(process_github_event, payload, event)
    
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