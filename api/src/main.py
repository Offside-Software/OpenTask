import sys
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from routers import auth, github, meetings, tasks, telegram

sys.path.insert(0, str(Path(__file__).parent))

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from services.database.database import router as db_router, create_pool, close_pool
from services.database import users as _db_users
from services.database import projects as _db_projects
from services.database import buckets as _db_buckets
from services.database import tasks as _db_tasks
from services.database import project_member as _db_project_member
from services.database import alerts as _db_alerts
from services.database import activities as _db_activities
from services.database import meetings as _db_meetings
from services.database import history as _db_history

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the DB pool on startup and close it on shutdown."""
    create_pool()
    _db_history.init_project_history_table()
    yield
    close_pool()

app = FastAPI(title="Lunaris API", version="0.1.0", lifespan=lifespan)

from config import settings

allowed_origins = [
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]
if getattr(settings, "frontend_url", None):
    fe_url = settings.frontend_url.rstrip("/")
    if fe_url not in allowed_origins:
        allowed_origins.append(fe_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class StripApiPrefixMiddleware:
    """
    ASGI middleware to strip '/api' prefix for routes defined without it (e.g. /tasks, /auth),
    while preserving routes defined with prefix (e.g. /api/v1/tasks).
    Ensures seamless routing in both local development and production.
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
                scope = dict(scope)
                scope["path"] = new_path
                scope["raw_path"] = new_path.encode("latin-1")
        await self.app(scope, receive, send)

app.add_middleware(StripApiPrefixMiddleware)

@app.get("/")
def read_root():
    return {"Message": "FastAPI is running!"}

app.include_router(auth.router)
app.include_router(github.router)
app.include_router(db_router)
app.include_router(meetings.router)
app.include_router(tasks.router)
app.include_router(telegram.router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True, log_level="debug")
