"""
worker/app/handlers/compute_heavy.py

CPU-intensive handler for demonstrating resource-aware scheduling.

This handler actually burns CPU for ~3 seconds by computing SHA-256 hashes
over a 1 MB in-memory buffer. It is not a `time.sleep` call — the work is
real and will show up as elevated CPU% in the worker's heartbeat metrics.

Why this approach:
- Hashing is deterministic, reproducible, and produces real CPU load.
- It uses only the standard library (hashlib) so there is no extra dependency.
- The iteration count (50_000 rounds) is tuned to take roughly 2–4 seconds
  on typical server hardware; it can be overridden via the payload's
  'iterations' key so tests can use a smaller value.

Design note: this handler is only registered when the worker's WORKER_TYPE
env var is not 'standard', AND it targets queues with
required_worker_type='high_compute'. Standard workers never run this handler
because they never claim from high_compute queues — the claim query filters
them out atomically.
"""
import hashlib
import logging

logger = logging.getLogger("worker.handlers.compute_heavy")

# Default iteration count — adjust down in tests, leave high for demos
_DEFAULT_ITERATIONS = 50_000


async def handle_cpu_burn(payload: dict, job_id: str) -> None:
    """Burn real CPU for several seconds to demonstrate resource-aware scheduling.

    The work is synchronous CPU hashing. In an async worker this blocks the
    event loop for the duration, which is intentional for demonstration —
    it makes the CPU spike visible in psutil metrics and shows the worker
    is genuinely busy.

    For production use of CPU-heavy work, run in a ProcessPoolExecutor so
    the async loop stays free. This handler is a demo, not a pattern.
    """
    iterations: int = int(payload.get("iterations", _DEFAULT_ITERATIONS))
    logger.info(
        "job_id=%s Starting cpu_burn with %d hash iterations.", job_id, iterations
    )

    # 1 MB seed buffer — all hashing is in-memory, no I/O
    data = b"distributed-job-scheduler-cpu-burn-demo" * (1024 * 1024 // 38)
    digest = data

    for i in range(iterations):
        digest = hashlib.sha256(digest).digest()

    logger.info(
        "job_id=%s cpu_burn complete. Final digest prefix: %s",
        job_id,
        digest[:8].hex(),
    )
