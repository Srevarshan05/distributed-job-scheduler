"""
worker/app/main.py

FastAPI application for the Worker server (port 8001).

Responsibilities:
- Exposes /health for liveness checks.
- Exposes /ws for the WebSocket live-update stream.
- Starts the polling, heartbeat, and orphan-recovery loops on startup.
- Handles SIGTERM/SIGINT for graceful shutdown (finishes running jobs before exit).
"""
import asyncio
import logging
import signal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_worker_settings
from app.core.events import broadcast, deregister, register
from app.core.poller import run_worker

# Ensure handlers are registered before the poller starts
import app.handlers  # noqa: F401

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("worker.main")

app = FastAPI(
    title="Distributed Job Scheduler — Worker",
    description="Internal worker server. Handles job execution, heartbeats, and live updates.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_stop_event: asyncio.Event = asyncio.Event()
_worker_task: asyncio.Task | None = None


@app.on_event("startup")
async def _startup() -> None:
    """Start the worker loop as a background asyncio task."""
    global _worker_task
    settings = get_worker_settings()

    def _handle_signal(sig):
        logger.info("Received signal %s — initiating graceful shutdown.", sig.name)
        _stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, lambda s=sig: _handle_signal(s))
        except NotImplementedError:
            # Windows doesn't support add_signal_handler for SIGTERM
            pass

    _worker_task = asyncio.create_task(
        run_worker(settings.worker_id, _stop_event),
        name="worker-main",
    )
    logger.info("Worker '%s' started.", settings.worker_id)


@app.on_event("shutdown")
async def _shutdown() -> None:
    """Signal the worker loop to stop on server shutdown."""
    _stop_event.set()
    if _worker_task:
        await asyncio.wait_for(_worker_task, timeout=30)


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """WebSocket endpoint for real-time job and worker status updates.

    The frontend connects here and receives JSON events whenever a job changes
    status or a worker sends a heartbeat. The connection is kept open until
    the client disconnects.
    """
    await ws.accept()
    register(ws)
    logger.debug("WebSocket client connected.")
    try:
        while True:
            # Keep the connection open; we only send, we don't receive
            await ws.receive_text()
    except WebSocketDisconnect:
        logger.debug("WebSocket client disconnected.")
    finally:
        deregister(ws)
