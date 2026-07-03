"""
backend/app/main.py

FastAPI application factory for the API server (port 8000).

Registers all routers, global exception handlers, and CORS middleware.
Nothing else lives here — this file's only job is to assemble the app.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.errors import AppError, app_error_handler, unhandled_error_handler
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.jobs import dlq_router, router as jobs_router
from app.routers.log_export import router as log_export_router
from app.routers.organizations import router as orgs_router
from app.routers.projects import router as projects_router
from app.routers.workers import router as workers_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migration 0004 now owns the idempotency_key column.
    # Nothing to do here at startup.
    yield


app = FastAPI(
    title="Distributed Job Scheduler — API",
    description=(
        "REST API for managing organizations, projects, queues, and jobs. "
        "See /docs for interactive documentation."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

import time
import uuid
import contextvars
import logging

logger = logging.getLogger("app.api")
correlation_id_ctx = contextvars.ContextVar("correlation_id", default=None)

@app.middleware("http")
async def add_correlation_id_and_log(request, call_next):
    correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
    correlation_id_ctx.set(correlation_id)
    
    start_time = time.monotonic()
    response = await call_next(request)
    process_time = (time.monotonic() - start_time) * 1000
    
    response.headers["X-Correlation-ID"] = correlation_id
    response.headers["X-Response-Time-Ms"] = f"{process_time:.2f}"
    
    logger.info(
        "request_method=%s request_path=%s status_code=%d latency_ms=%.2f correlation_id=%s",
        request.method, request.url.path, response.status_code, process_time, correlation_id
    )
    return response

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the Vite dev server and any localhost origin during development.
# Tighten this to the deployed frontend URL in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # nginx proxy handles Docker; tighten in production deployment
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Exception handlers ────────────────────────────────────────────────────────
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(Exception, unhandled_error_handler)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router, prefix="/api/v1")
app.include_router(orgs_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(dlq_router, prefix="/api/v1")
app.include_router(workers_router, prefix="/api/v1")
app.include_router(log_export_router, prefix="/api/v1")
app.include_router(health_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Liveness probe — returns 200 when the server is up."""
    return {"status": "ok"}
