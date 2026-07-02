"""
backend/app/main.py

FastAPI application factory for the API server (port 8000).

Registers all routers, global exception handlers, and CORS middleware.
Nothing else lives here — this file's only job is to assemble the app.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.errors import AppError, app_error_handler, unhandled_error_handler
from app.routers.auth import router as auth_router
from app.routers.jobs import dlq_router, router as jobs_router
from app.routers.organizations import router as orgs_router
from app.routers.projects import router as projects_router

app = FastAPI(
    title="Distributed Job Scheduler — API",
    description=(
        "REST API for managing organizations, projects, queues, and jobs. "
        "See /docs for interactive documentation."
    ),
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow the Vite dev server and any localhost origin during development.
# Tighten this to the deployed frontend URL in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
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


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Liveness probe — returns 200 when the server is up."""
    return {"status": "ok"}
