"""
worker/app/handlers/builtin.py

Built-in job handlers shipped for demonstration and testing.

These are real handlers — they follow the same contract as production handlers
(async, accept payload + job_id, raise on failure). They're used in:
- Manual testing while building the system
- The retry and DLQ tests in Phase 7
- The concurrency proof in test_atomic_claim.py

Do not delete these — they're referenced in tests.
"""
import asyncio
import logging
import random

logger = logging.getLogger("worker.handlers.builtin")


async def handle_send_email(payload: dict, job_id: str) -> None:
    """Simulate sending an email.

    Sleeps to simulate I/O, then logs success. The payload is expected to
    contain 'to' and 'subject' keys — missing keys are logged as warnings,
    not errors, since the handler still completes successfully.
    """
    to = payload.get("to", "<unknown>")
    subject = payload.get("subject", "<no subject>")
    logger.info("job_id=%s Sending email to=%s subject=%s", job_id, to, subject)
    await asyncio.sleep(0.5)  # simulate network I/O
    logger.info("job_id=%s Email sent.", job_id)


async def handle_random_fail(payload: dict, job_id: str) -> None:
    """Randomly fail ~50% of the time.

    Used to test retry logic without manual intervention.
    The failure_rate key in the payload overrides the default 0.5.
    """
    failure_rate: float = float(payload.get("failure_rate", 0.5))
    if random.random() < failure_rate:  # noqa: S311
        raise RuntimeError(f"job_id={job_id} Random failure triggered (rate={failure_rate}).")
    logger.info("job_id=%s Random-fail handler succeeded.", job_id)


async def handle_always_fail(payload: dict, job_id: str) -> None:  # noqa: ARG001
    """Always fail — used by test_dlq.py to exercise the DLQ path."""
    raise RuntimeError(f"job_id={job_id} Always-fail handler: intentional failure for testing.")


async def handle_sleep(payload: dict, job_id: str) -> None:
    """Sleep for `duration_seconds` (default 1). Used for concurrency tests."""
    duration = float(payload.get("duration_seconds", 1))
    logger.info("job_id=%s Sleeping for %.1fs.", job_id, duration)
    await asyncio.sleep(duration)
    logger.info("job_id=%s Sleep complete.", job_id)


def register_builtin_handlers() -> None:
    """Register all built-in handlers. Called once on worker startup."""
    from app.handlers import register_handler

    register_handler("send_email", handle_send_email)
    register_handler("random_fail", handle_random_fail)
    register_handler("always_fail", handle_always_fail)
    register_handler("sleep", handle_sleep)
