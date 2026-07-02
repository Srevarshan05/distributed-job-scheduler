"""
worker/app/handlers/__init__.py

Job handler registry.

A handler is any async callable that accepts a payload dict and a job_id,
performs some work, and either returns normally (success) or raises an
exception (failure — the worker will retry or DLQ the job).

Register new handlers with `register_handler`. The worker's execution loop
calls `get_handler` to look up the right function for a job_type.
"""
import logging
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger("worker.handlers")

# Type alias for readability
JobHandler = Callable[[dict[str, Any], str], Awaitable[None]]

_REGISTRY: dict[str, JobHandler] = {}


def register_handler(job_type: str, handler: JobHandler) -> None:
    """Register a handler function for a job type.

    Raises ValueError if a handler for `job_type` is already registered —
    duplicate registrations are a bug, not a runtime condition to silently ignore.
    """
    if job_type in _REGISTRY:
        raise ValueError(f"Handler for job_type '{job_type}' is already registered.")
    _REGISTRY[job_type] = handler
    logger.debug("Registered handler for job_type='%s'.", job_type)


def get_handler(job_type: str) -> JobHandler | None:
    """Return the handler for `job_type`, or None if not registered."""
    return _REGISTRY.get(job_type)


# ── Import built-in handlers so they self-register on module load ──────────────
from app.handlers.builtin import register_builtin_handlers  # noqa: E402

register_builtin_handlers()
