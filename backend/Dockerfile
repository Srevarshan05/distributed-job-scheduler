FROM python:3.11-slim AS base
WORKDIR /app

# Install dependencies first (separate layer — rebuild only when requirements change)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ .

# Copy seed script (lives outside backend/ in the repo)
COPY scripts/seed.py /app/scripts/seed.py

# Copy and make entrypoint executable
COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
