from pathlib import Path
from typing import Annotated, Optional

from pydantic import AliasChoices
from pydantic import BeforeValidator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

_REPO_ROOT = Path(__file__).parent.parent.parent
_API_DIR = Path(__file__).parent.parent

# Discover any existing env file
_env_candidates = [
    _REPO_ROOT / ".env",
    _REPO_ROOT / ".env.local",
]
_env_files = [str(p) for p in _env_candidates if p.exists()]


def _nullable_int(v: object) -> int | None:
    """Coerce empty strings and NULL-like values to None for optional int fields."""
    if v is None or str(v).strip().upper() in ("", "NULL", "NONE"):
        return None
    return v


class Settings(BaseSettings):
    supabase_url: str = Field(default="", validation_alias=AliasChoices("SUPABASE_URL"))
    supabase_key: str = Field(default="", validation_alias=AliasChoices("SUPABASE_KEY"))
    
    # PostgreSQL Connection
    postgresql_database_url: Optional[str] = Field(None, validation_alias=AliasChoices("POSTGRESQL_DATABASE_URL", "DATABASE_URL"))
    postgresql_username: str = Field(default="postgres", validation_alias=AliasChoices("POSTGRESQL_USERNAME"))
    postgresql_password: str = Field(default="", validation_alias=AliasChoices("POSTGRESQL_PASSWORD", "POSTGRESQL_PASSWPRD"))
    postgresql_host: str = Field(default="localhost", validation_alias=AliasChoices("POSTGRESQL_HOST"))
    postgresql_port: int = Field(default=5432, validation_alias=AliasChoices("POSTGRESQL_PORT"))
    postgresql_pooler_host: Optional[str] = Field(None, validation_alias=AliasChoices("POSTGRESQL_POOLER_HOST", "SUPABASE_POOLER_HOST"))
    postgresql_pooler_port: Optional[int] = Field(None, validation_alias=AliasChoices("POSTGRESQL_POOLER_PORT", "SUPABASE_POOLER_PORT"))
    postgresql_database: str = Field(default="postgres", validation_alias=AliasChoices("POSTGRESQL_DATABASE"))
    supabase_postgresql_cert: Optional[str] = Field(None, validation_alias=AliasChoices("SUPABASE_POSTGRESQL_CERT"))
    
    # GitHub App & OAuth
    gh_app_id: int = Field(default=0, validation_alias=AliasChoices("GH_APP_ID"))
    gh_app_private_key: str = Field(default="", validation_alias=AliasChoices("GH_APP_PRIVATE_KEY"))
    gh_webhook_secret: str = Field(default="", validation_alias=AliasChoices("GH_WEBHOOK_SECRET"))
    gh_app_client_id: str = Field(default="", validation_alias=AliasChoices("GH_APP_CLIENT_ID"))
    gh_app_client_secret: str = Field(default="", validation_alias=AliasChoices("GH_APP_CLIENT_SECRET"))
    gh_app_installation_id: Annotated[int | None, BeforeValidator(_nullable_int)] = None
    gh_oauth_redirect_uri: str = Field(
        default="http://localhost:5173/api/auth/callback",
        validation_alias=AliasChoices(
            "GH_OAUTH_REDIRECT_URI",
            "GITHUB_REDIRECT_URI"
        ),
    )
    frontend_url: str = Field(default="http://localhost:5173", validation_alias=AliasChoices("FRONTEND_URL"))
    
    # AI & 3rd Party Integrations
    gemini_api_key: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY"))
    secret_key: str = Field(default="opentask-local-development-secret-key-32chars", validation_alias=AliasChoices("SECRET_KEY"))
    recall_api_key: Optional[str] = Field(None, validation_alias=AliasChoices("RECALL_API_KEY"))
    telegram_bot_token: Optional[str] = Field(None, validation_alias=AliasChoices("TELEGRAM_BOT_TOKEN"))

    # Web Push (VAPID)
    vapid_public_key: str = Field(
        default="BFNGNl-sWQwDl1GTuh9-iM6bmHSVdosX8T7ax7hqLTPYzjM_G1DHrS0vwO1JRC75x9cOjvgybHK-19GbTWlrSN8",
        validation_alias=AliasChoices("VAPID_PUBLIC_KEY")
    )
    vapid_private_key: str = Field(
        default="u9WEYzZFke7f46Kkv5q98geTM08rAYQP8evwPxBp6G4",
        validation_alias=AliasChoices("VAPID_PRIVATE_KEY")
    )
    vapid_claim_email: str = Field(
        default="mailto:evangelionxyz10@gmail.com",
        validation_alias=AliasChoices("VAPID_CLAIM_EMAIL")
    )

    model_config = SettingsConfigDict(
        env_file=_env_files if _env_files else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()