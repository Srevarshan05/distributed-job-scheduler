"""
worker/app/core/retry.py

Retry delay calculation strategies.

All three functions are pure — they take the attempt number and queue config,
return the next delay in seconds. No side effects.

The maximum delay cap (max_retry_delay_seconds from config) prevents a job
from being scheduled days into the future due to exponential growth.
See docs/design_decisions.md for why the cap is set where it is.
"""
import math

from app.core.config import get_worker_settings


def _cap(delay: float) -> int:
    """Clamp delay to the configured maximum and return as an integer seconds."""
    settings = get_worker_settings()
    return min(int(delay), settings.max_retry_delay_seconds)


def fixed_delay(base_delay_seconds: int, attempt: int) -> int:  # noqa: ARG001
    """Return the same delay regardless of attempt number."""
    return _cap(base_delay_seconds)


def linear_delay(base_delay_seconds: int, attempt: int) -> int:
    """Delay grows linearly: base * attempt.

    Attempt 1 → base, attempt 2 → 2×base, etc.
    """
    return _cap(base_delay_seconds * attempt)


def exponential_delay(base_delay_seconds: int, attempt: int) -> int:
    """Delay doubles each attempt: base * 2^(attempt-1).

    Attempt 1 → base, attempt 2 → 2×base, attempt 3 → 4×base, etc.
    Capped at max_retry_delay_seconds to prevent absurdly long waits.
    """
    return _cap(base_delay_seconds * math.pow(2, attempt - 1))


# Strategy registry — maps the queue's retry_strategy string to a function.
# Add new strategies here; nothing else needs to change.
STRATEGY_REGISTRY: dict[str, callable] = {
    "fixed": fixed_delay,
    "linear": linear_delay,
    "exponential": exponential_delay,
}


def calculate_next_run_delay(
    strategy: str,
    base_delay_seconds: int,
    attempt: int,
) -> int:
    """Dispatch to the correct retry strategy and return delay in seconds.

    Falls back to exponential if an unknown strategy name is configured —
    logs a warning rather than crashing the worker.
    """
    import logging

    handler = STRATEGY_REGISTRY.get(strategy)
    if handler is None:
        logging.getLogger("worker.retry").warning(
            "Unknown retry strategy '%s', falling back to 'exponential'.", strategy
        )
        handler = exponential_delay
    return handler(base_delay_seconds, attempt)
