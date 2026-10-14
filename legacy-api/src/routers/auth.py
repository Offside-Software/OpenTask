import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from config import settings
from services.database.users import DatabaseUser, get_or_create_user
from services.database.database import SafeId
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/auth", tags=["Auth"])

_pending_oauth_states: set[str] = set()

_bearer = HTTPBearer(auto_error=False)

AUTH_COOKIE = "gh_token"

class AuthMeResponse(BaseModel):
    id: SafeId | None = None
    login: str | None = None
    name: str | None = None
    email: str | None = None
    avatar_url: str | None = None
    html_url: str | None = None
    public_repos: int | None = None
    followers: int | None = None
    db_user: DatabaseUser | None = None
    
http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(15.0, connect=5.0), 
    limits=httpx.Limits(max_connections=100)
)

async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """
    Dependency: resolves the GitHub access token from either:
      1. Authorization: Bearer <token> header  (API / mobile clients)
      2. gh_token HTTP-only cookie             (browser clients)
    Raises 401 if no token is present or the token is rejected by GitHub.
    """
    token: str | None = None

    if credentials:
        token = credentials.credentials
    else:
        token = request.cookies.get(AUTH_COOKIE)

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    async with httpx.AsyncClient() as http:
        resp = await http.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "User-Agent": "OpenTask-App",
            },
            timeout=10,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    return resp.json()


async def get_current_user_optional(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict | None:
    """
    Same as `get_current_user` but returns None instead of raising when
    authentication is missing/invalid. Useful for endpoints where auth is optional.
    """
    try:
        return await get_current_user(request, credentials)
    except HTTPException:
        return None


def _get_redirect_uri(request: Request) -> str:
    configured = (settings.gh_oauth_redirect_uri or "").strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto", "https" if "vercel.app" in host else "http")

    # If running on Vercel or production domain (non-localhost), dynamically use production host
    if host and "localhost" not in host and "127.0.0.1" not in host:
        return f"{proto}://{host}/api/auth/callback"

    return configured or f"{proto}://{host}/api/auth/callback"


def _get_frontend_url(request: Request) -> str:
    configured = (settings.frontend_url or "").strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto", "https" if "vercel.app" in host else "http")

    if host and "localhost" not in host and "127.0.0.1" not in host:
        return f"{proto}://{host}"

    return configured or f"{proto}://{host}"


@router.get("/login")
def auth_login(request: Request):
    """
    Redirect the browser to GitHub's OAuth authorization page.
    A random state token is generated to prevent CSRF.
    Stored in an HTTP-only cookie to be reliable in serverless environments.
    """
    state = secrets.token_urlsafe(32)
    _pending_oauth_states.add(state)
    redirect_uri = _get_redirect_uri(request)
    qs = urlencode({
        "client_id": settings.gh_app_client_id,
        "redirect_uri": redirect_uri,
        "state": state,
    })
    is_https = "https" in redirect_uri
    response = RedirectResponse(f"https://github.com/login/oauth/authorize?{qs}")
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=is_https,
        samesite="lax",
        path="/",
        max_age=600,
    )
    return response

@router.get("/callback")
async def auth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    installation_id: int | None = None,
    setup_action: str | None = None,
):
    """
    Handle the GitHub OAuth callback and GitHub App installation callback.
    - If it's an App installation (setup_action == 'install' or installation_id present):
      Gracefully redirects back to OpenTask workspaces.
    - If it's user OAuth login (code and state present):
      Validates state, exchanges code for access token, and sets auth cookie.
    """
    is_install_flow = setup_action == "install" or installation_id is not None
    frontend_url = _get_frontend_url(request)

    # 1. Handle GitHub App Installation callback (state is not provided by GitHub for installations)
    if is_install_flow and not state:
        access_token = None
        if code:
            try:
                client_id = settings.gh_app_client_id
                client_secret = settings.gh_app_client_secret
                redirect_uri = _get_redirect_uri(request)
                async with httpx.AsyncClient() as http:
                    token_resp = await http.post(
                        "https://github.com/login/oauth/access_token",
                        json={
                            "client_id": client_id,
                            "client_secret": client_secret,
                            "code": code,
                            "redirect_uri": redirect_uri,
                        },
                        headers={"Accept": "application/json"},
                        timeout=10,
                    )
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    access_token = token_data.get("access_token")
            except Exception as e:
                print(f"[AUTH WARNING] Failed to exchange code during installation: {e}")

        if access_token:
            async with httpx.AsyncClient() as http:
                user_resp = await http.get(
                    "https://api.github.com/user",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/vnd.github+json",
                    },
                    timeout=10,
                )
            user = user_resp.json() if user_resp.status_code == 200 else {}
            if user:
                try:
                    await run_in_threadpool(
                        get_or_create_user,
                        int(user.get("id", 0) or 0),
                        user.get("email"),
                        user.get("login"),
                        user.get("name"),
                        None,
                        access_token
                    )
                except Exception as err:
                    print(f"[AUTH WARNING] Failed to persist user during install callback: {err}")

        target_url = f"{frontend_url.rstrip('/')}/workspaces"
        response = RedirectResponse(url=target_url, status_code=302)
        if access_token:
            is_https = "https" in frontend_url
            response.set_cookie(
                key=AUTH_COOKIE,
                value=access_token,
                httponly=True,
                secure=is_https,
                samesite="lax",
                path="/",
                max_age=28800,
            )
        return response

    # 2. Standard OAuth Login Flow
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    cookie_state = request.cookies.get("oauth_state")
    if (not state) or ((state not in _pending_oauth_states) and (cookie_state != state)):
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
    _pending_oauth_states.discard(state)

    client_id = settings.gh_app_client_id
    client_secret = settings.gh_app_client_secret
    redirect_uri = _get_redirect_uri(request)

    # Exchange authorization code for access token
    async with httpx.AsyncClient() as http:
        token_resp = await http.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )

    if token_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="GitHub token exchange failed")

    token_data = token_resp.json()
    if "error" in token_data:
        raise HTTPException(
            status_code=400,
            detail=token_data.get("error_description", token_data["error"]),
        )

    access_token = token_data["access_token"]

    # Fetch the authenticated user's profile
    async with httpx.AsyncClient() as http:
        user_resp = await http.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=10,
        )

    user = user_resp.json() if user_resp.status_code == 200 else {}
    
    if user:
        try:
            await run_in_threadpool(
                get_or_create_user,
                int(user.get("id", 0) or 0),
                user.get("email"),
                user.get("login"),
                user.get("name"),
                None,
                access_token
            )
        except Exception as err:
            print(f"[AUTH WARNING] Failed to persist user in database during callback: {err}")

    response = RedirectResponse(url=frontend_url or "/", status_code=302)
    is_https = "https" in frontend_url or "https" in redirect_uri
    response.set_cookie(
        key=AUTH_COOKIE,
        value=access_token,
        httponly=True,
        secure=is_https,
        samesite="lax",
        path="/",
        max_age=28800,  # 8 hours
    )
    response.delete_cookie("oauth_state", path="/")
    return response

@router.get("/me", response_model=AuthMeResponse)
async def auth_me(current_user: dict = Depends(get_current_user)):
    """
    Return the profile of the currently authenticated GitHub user.
    Requires: Authorization: Bearer <access_token>
    """
    db_user = None
    try:
        db_user = await run_in_threadpool(
            get_or_create_user,
            int(current_user.get("id", 0) or 0),
            current_user.get("email"),
            current_user.get("login"),
            current_user.get("name"),
        )
    except Exception as err:
        print(f"[AUTH WARNING] Failed to fetch db_user in /me: {err}")
    
    return {
        "id": current_user.get("id"),
        "login": current_user.get("login"),
        "name": current_user.get("name"),
        "email": current_user.get("email"),
        "avatar_url": current_user.get("avatar_url"),
        "html_url": current_user.get("html_url"),
        "public_repos": current_user.get("public_repos"),
        "followers": current_user.get("followers"),
        "db_user": db_user,
    }

@router.post("/sync-user", response_model=DatabaseUser | None)
async def sync_logged_in_user(current_user: dict = Depends(get_current_user)):
    """
    Create or fetch a database user for the currently authenticated GitHub user.
    Call this from frontend after login succeeds.
    """
    return await run_in_threadpool(
        get_or_create_user,
        int(current_user.get("id", 0) or 0),
        current_user.get("email"),
        current_user.get("login"),
        current_user.get("name"),
    )

@router.post("/logout")
async def auth_logout():
    """
    Clear the auth cookie, effectively signing the user out.
    The frontend redirects to the login page after calling this endpoint.
    """
    response = JSONResponse({"logged_out": True})
    response.delete_cookie(key=AUTH_COOKIE, httponly=True, samesite="lax")
    return response
