#!/bin/sh
# backend/entrypoint.sh
#
# Runs inside the Docker container only. Not used for local dev.
# Sequence:
#   1. Run Alembic migrations (idempotent — safe to run on every restart)
#   2. Seed the database only if empty (--if-empty flag skips if data exists)
#   3. Start the API server
set -e

echo "==> Running Alembic migrations..."
alembic upgrade head

echo "==> Seeding database (skips if data already exists)..."
# Run seed in a subshell; if it fails we log the error but do not exit.
# This is safe: the only reason seed fails after migrations succeed is if
# there is a data conflict (e.g. unique constraint on slug). We log and move on.
python /app/scripts/seed.py --if-empty || echo "WARN: Seed script exited with error — continuing startup (data may already exist)"

echo "==> Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
