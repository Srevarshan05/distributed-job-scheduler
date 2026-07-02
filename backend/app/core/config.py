"""
backend/app/core/config.py

Single source of truth for all configuration values read from the environment.
Every other module imports from here — nothing reads os.environ directly.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ─── Database ────────────────────────────────────────────────────────────
    database_url: str

    # ─── Auth ────────────────────────────────────────────────────────────────
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # ─── Server ──────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8000


@lru_cache
def get_settings() -> Settings:
    """Return cached Settings instance.

    Cached so the .env file is read exactly once per process lifetime.
    """
    return Settings()
