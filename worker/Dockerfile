FROM python:3.11-slim AS base
WORKDIR /app

# Dependencies first — rebuild only when requirements.txt changes
COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY worker/ .

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
