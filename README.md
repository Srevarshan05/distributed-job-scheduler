# JobRunR — Distributed Job Scheduler

A production-inspired distributed background job scheduling platform built with **FastAPI**, **PostgreSQL**, and **React**.

---

## 🚀 Quick Start (Run with One Command)

Follow these simple steps to run the entire application on your computer.

### Step 1: Install Docker
Make sure you have **Docker Desktop** installed and running on your computer:
* **[Download Docker Desktop](https://www.docker.com/products/docker-desktop/)** (Available for Windows, Mac, and Linux).
* Make sure the Docker app is running in the background before continuing.

### Step 2: Clone the Project
Open your Terminal (macOS/Linux) or Command Prompt/PowerShell (Windows) and run:
```bash
git clone <your-repo-url>
cd distributed-job-scheduler
```

### Step 3: Copy the Environment Config File
Choose the command for your Operating System:

* **For Windows (PowerShell):**
  ```powershell
  Copy-Item .env.example .env
  ```
* **For Windows (Command Prompt):**
  ```cmd
  copy .env.example .env
  ```
* **For macOS / Linux:**
  ```bash
  cp .env.example .env
  ```

*(Note: The `.env` file contains settings like database passwords. The default settings in `.env.example` work out of the box, so you do not need to change anything!)*

### Step 4: Run the Application
Run this command to start everything:
```bash
docker compose up --build
```
*Wait a minute or two for the setup to complete.* Docker will automatically configure the database, run the startup steps, and start all services.

---

## 🖥️ How to Access the App

Once the command finishes, you can open these links in your browser:

* **Web Interface:** Go to **[http://localhost:5173](http://localhost:5173)** to see the dashboard.
* **Test Username:** `admin@example.com`
* **Test Password:** `password123`
* **API Documentation (Swagger):** Go to **[http://localhost:8000/docs](http://localhost:8000/docs)** to test the backend endpoints directly.

---

## 🧹 How to Clean Up and Reset
If you ever want to stop the application and wipe the database clean to start fresh, run:
```bash
docker compose down -v
```
*(The `-v` option deletes the database storage so it starts completely fresh next time you run `docker compose up --build`)*

---

## Architecture

```
Organization → Project → Queue → Job
```

| Component | Role |
|---|---|
| **Backend** (port 8000) | FastAPI REST API — auth, projects, queues, jobs, DLQ, health, WebSocket events |
| **Worker Standard** (port 8001) | Polls `standard` queues, executes background jobs, sends heartbeats |
| **Worker High-Compute** (port 8002) | Polls `high_compute` queues — separate process, same image, different `WORKER_TYPE` |
| **PostgreSQL 16** | Single source of truth — atomic claiming via `SELECT FOR UPDATE SKIP LOCKED` |
| **Frontend** (port 5173) | React SPA — real-time dashboard, job explorer, projects, workers, DLQ |

### Key design choices (full rationale in [`docs/design_decisions.md`](docs/design_decisions.md))

- **No broker.** `SELECT FOR UPDATE SKIP LOCKED` gives exactly-once claim semantics without Redis or RabbitMQ.
- **One worker image, two services.** `worker-standard` and `worker-highcompute` use the same Docker image, differentiated by `WORKER_TYPE` at runtime.
- **Embedded retry policy.** `retry_strategy`, `retry_delay_seconds`, and `retry_limit` live on the `queues` table — a separate table would add a join with no normalization benefit.
- **`max_workers` enforced at claim time.** The queue row is locked for the duration of the claim transaction to prevent exceeding concurrency limits across distributed workers.
- **Idempotency keys.** Optional `idempotency_key` on jobs prevents duplicate submission from retrying callers.

---

## Features

### Core
- ✅ Authentication (JWT) + Role-based access control (owner / member / read-only)
- ✅ Organizations → Projects → Queues → Jobs hierarchy
- ✅ Queue configuration: priority, concurrency limits, retry policy, pause/resume, scheduling policy (priority / FIFO / fair-share)
- ✅ Job types: immediate, delayed, scheduled (future `run_at`), recurring (cron), batch
- ✅ Worker: atomic poll & claim, concurrent execution, heartbeats, graceful shutdown, orphan recovery
- ✅ Full lifecycle: Queued → Claimed → Running → Completed / Failed → Dead Letter Queue
- ✅ Retry strategies: fixed, linear, exponential backoff
- ✅ Idempotency keys for exactly-once job submission
- ✅ `max_workers` per-queue concurrency enforcement

### Observability
- ✅ WebSocket real-time job status updates
- ✅ Live worker telemetry (CPU%, memory) via `psutil`
- ✅ System throughput chart (completed jobs per 5-minute window, last 60 mins)
- ✅ Per-job structured logs + full run history
- ✅ AI-generated failure summaries (Groq) for DLQ entries

### Bonus
- ✅ RBAC (three-tier: owner / member / read-only)
- ✅ Log export (CSV/JSON)
- ✅ Project-scoped queue management
- ✅ One-command Docker setup

---

## Running without Docker (local development)

### Prerequisites
- Python 3.11+
- Node.js 20+
- PostgreSQL 16 running locally

### Backend

```bash
cd distributed-job-scheduler
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate    # macOS/Linux

pip install -r backend/requirements.txt

# Set up env
cp backend/.env.example backend/.env
# Edit backend/.env: set DATABASE_URL to your local Postgres

# Run migrations + seed
cd backend
alembic upgrade head
cd ..
python scripts/seed.py

# Start API server
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Workers (two terminals)

```bash
# Terminal 1 — Standard worker
cd worker
WORKER_ID=standard-1 WORKER_TYPE=standard uvicorn app.main:app --host 127.0.0.1 --port 8001

# Terminal 2 — High-compute worker
cd worker
WORKER_ID=high-1 WORKER_TYPE=high_compute uvicorn app.main:app --host 127.0.0.1 --port 8002
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

---

## API Reference

Full interactive docs at http://localhost:8000/docs (Swagger UI) or http://localhost:8000/redoc.

### Key endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Register new user |
| `POST` | `/api/v1/auth/login` | Get JWT token |
| `GET` | `/api/v1/orgs` | List organizations |
| `GET` | `/api/v1/orgs/{id}/projects` | List projects in org |
| `POST` | `/api/v1/orgs/{id}/projects` | Create project |
| `GET` | `/api/v1/orgs/{id}/projects/{id}/queues` | List queues in project |
| `POST` | `/api/v1/orgs/{id}/projects/{id}/queues` | Create queue |
| `POST` | `/api/v1/queues/{id}/jobs` | Submit one job |
| `POST` | `/api/v1/queues/{id}/jobs/batch` | Submit batch of jobs |
| `GET` | `/api/v1/queues/{id}/jobs` | List jobs with filters |
| `GET` | `/api/v1/queues/{id}/jobs/{id}` | Job detail + logs + AI summary |
| `POST` | `/api/v1/queues/{id}/jobs/{id}/cancel` | Cancel a job |
| `GET` | `/api/v1/dlq/queues/{id}/dlq` | List DLQ entries |
| `POST` | `/api/v1/dlq/queues/{id}/dlq/{id}/retry` | Retry from DLQ |
| `GET` | `/api/v1/health/system` | Worker + queue health |
| `GET` | `/api/v1/health/throughput` | Throughput (jobs/5min, last 60 min) |
| `GET` | `/ws` | WebSocket live event stream |

---

## Project Structure

```
distributed-job-scheduler/
├── backend/                 # FastAPI API server
│   ├── app/
│   │   ├── core/            # DB, config, security, errors
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── routers/         # API route handlers
│   │   └── schemas/         # Pydantic request/response models
│   ├── alembic/             # Database migrations
│   ├── Dockerfile
│   └── entrypoint.sh        # Runs migrations + seed + uvicorn
├── worker/                  # Worker process (same image, two services)
│   ├── app/
│   │   ├── core/            # Poller, claim, executor, heartbeat
│   │   └── handlers/        # Job type handlers
│   └── Dockerfile
├── frontend/                # React SPA
│   ├── src/
│   │   ├── pages/           # Dashboard, JobExplorer, Projects, Workers, DLQ
│   │   └── components/      # Topbar, Sidebar, JobDrawer, StatusPipeline
│   ├── nginx.conf           # SPA fallback + /api proxy
│   └── Dockerfile           # Multi-stage: build → nginx
├── scripts/
│   └── seed.py              # Database seeder (supports --if-empty)
├── docs/
│   └── design_decisions.md  # Architectural decision records
├── tests/                   # 66 unit tests
├── docker-compose.yml       # One-command full stack
└── .env.example             # Environment variable template
```

---

## Running Tests

```bash
# From repo root with venv active
python -m pytest backend/tests/test_scheduler_logic.py -v
```

66 tests covering: retry strategies, job lifecycle transitions, DLQ promotion, priority ordering, RBAC permissions, cron scheduling, and atomic claim simulation.

---

## Roles & Permissions

| Action | Owner | Member | Read-only |
|---|---|---|---|
| View jobs / queues / logs | ✅ | ✅ | ✅ |
| Submit jobs | ✅ | ✅ | ❌ |
| Cancel jobs | ✅ | ✅ | ❌ |
| Pause / resume queue | ✅ | ❌ | ❌ |
| Create / delete project | ✅ | ❌ | ❌ |
| Invite users | ✅ | ❌ | ❌ |
| Retry DLQ entries | ✅ | ❌ | ❌ |
