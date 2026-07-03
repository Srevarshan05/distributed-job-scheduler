#!/bin/sh
# backend/entrypoint.sh
#
# Runs inside the Docker container only. Not used for local dev.
# Sequence: wait implicitly (db healthcheck in compose handles it),
# run migrations, seed if empty, then start the API server.
set -e

echo "==> Running Alembic migrations..."
alembic upgrade head

echo "==> Seeding database (skips if data already exists)..."
python /app/scripts/seed.py --if-empty

echo "==> Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
