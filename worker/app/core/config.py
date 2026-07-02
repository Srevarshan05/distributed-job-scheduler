"""
worker/app/core/config.py

Single source of truth for all worker configuration.
Named constants for timeouts are defined here — no magic numbers anywhere else.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# ── Timeout constants ─────────────────────────────────────────────────────────
# These are the defaults; the actual values come from env vars below.
# ORPHAN_TIMEOUT = 3 × HEARTBEAT_INTERVAL by design.
# See docs/design_decisions.md for the rationale.
DEFAULT_HEARTBEAT_INTERVAL_SECONDS: int = 30
DEFAULT_ORPHAN_TIMEOUT_SECONDS: int = 90       # 3 × heartbeat
DEFAULT_POLL_INTERVAL_SECONDS: int = 2
DEFAULT_MAX_RETRY_DELAY_SECONDS: int = 3600    # cap so jobs can't land days away


class WorkerSettings(BaseSettings):
    """Worker configuration from environment / .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # ─── Database ─────────────────────────────────────────────────────────────
    database_url: str

    # ─── Identity ─────────────────────────────────────────────────────────────
    worker_id: str = "worker-1"

    # ─── Timing ───────────────────────────────────────────────────────────────
    poll_interval_seconds: int = DEFAULT_POLL_INTERVAL_SECONDS
    heartbeat_interval_seconds: int = DEFAULT_HEARTBEAT_INTERVAL_SECONDS
    orphan_timeout_seconds: int = DEFAULT_ORPHAN_TIMEOUT_SECONDS
    max_retry_delay_seconds: int = DEFAULT_MAX_RETRY_DELAY_SECONDS

    # ─── Server ───────────────────────────────────────────────────────────────
    worker_host: str = "0.0.0.0"
    worker_port: int = 8001


@lru_cache
def get_worker_settings() -> WorkerSettings:
    """Return cached WorkerSettings instance."""
    return WorkerSettings()
