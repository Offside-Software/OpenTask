import sys
from pathlib import Path

# Ensure src/ directory is in sys.path
src_dir = Path(__file__).resolve().parent / "src"
if str(src_dir) not in sys.path:
    sys.path.insert(0, str(src_dir))

from main import app as base_app


class StripApiPrefixMiddleware:
    """
    ASGI middleware for Vercel serverless deployment.
    Strips '/api' from the request path so that standard routes like '/tasks',
    '/projects', etc. match correctly, while preserving existing '/api/v1/*' routes.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") in ("http", "websocket"):
            path = scope.get("path", "")
            if path.startswith("/api") and not path.startswith("/api/v1"):
                new_path = path[4:]
                if not new_path or not new_path.startswith("/"):
                    new_path = "/" + new_path
                scope["path"] = new_path
                scope["raw_path"] = new_path.encode("latin-1")
        await self.app(scope, receive, send)


base_app.add_middleware(StripApiPrefixMiddleware)

# Vercel looks for the ASGI callable named `app`
app = base_app
