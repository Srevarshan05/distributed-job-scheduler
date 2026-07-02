"""
worker/app/core/events.py

In-process WebSocket event broadcaster.

Keeps a set of active WebSocket connections and broadcasts JSON messages
to all of them. The broadcaster holds no business logic — it only fans out
events that other parts of the worker push to it.
"""
import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("worker.events")

# Shared active-connection registry — all coroutines in the same process see this.
_connections: set[WebSocket] = set()


def register(ws: WebSocket) -> None:
    """Add a WebSocket connection to the broadcast pool."""
    _connections.add(ws)


def deregister(ws: WebSocket) -> None:
    """Remove a WebSocket connection from the broadcast pool."""
    _connections.discard(ws)


async def broadcast(event_type: str, data: dict[str, Any]) -> None:
    """Send a JSON event to every connected WebSocket client.

    Failed sends are caught per-connection so one bad client
    doesn't interrupt delivery to the rest.
    """
    if not _connections:
        return

    message = json.dumps({"event": event_type, "data": data})
    dead: set[WebSocket] = set()

    for ws in list(_connections):
        try:
            await ws.send_text(message)
        except Exception:
            logger.debug("WebSocket send failed — removing dead connection.")
            dead.add(ws)

    for ws in dead:
        deregister(ws)
