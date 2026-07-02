# Distributed Job Scheduler (JobRunR)

A high-performance, real-time distributed job scheduler featuring AI-driven failure diagnostics, dynamic worker compute telemetry, and multi-tenant workspace access controls. 

Designed with a premium light grayscale aesthetic (inspired by Vercel and Linear) for maximum scannability and professional ease-of-use.

---

## 🚀 Key Features

### 1. 🛡️ Workspace Roles & Access Levels
* **Administrator (Owner):** Full control over workspace members. Can create and invite users, assign roles, and access setting panels.
* **Read & Write Access:** Full operational permissions to submit new jobs, pause/resume queues, and configure project parameters.
* **Read-Only Access:** Can inspect the system state, live telemetries, and timeline logs. Crucial buttons (like submit, cancel, retry, pause/resume, and user invitations) are disabled or hidden to prevent unauthorized modifications.
* **Invite Credentials sharing flow:** Owners can invite new users by entering their email, name, and selecting an access level. It saves credentials securely to the database and presents a copying screen to share credentials with the invitee instantly.

### 2. 🤖 JobRunR Failure Summary using Gen AI
* **Automated Failure Diagnostics:** Seamlessly listens to dead-letter queue promotions and triggers background diagnostics through the Groq API (`llama-3.3-70b-versatile`).
* **Instant Promotion:** Promotes failed jobs to the Dead Letter Queue (DLQ) immediately in a single database transaction, generating summaries asynchronously to avoid blocking user threads.
* **High Readability Panel:** Consolidates all failure explanations into an elegant feed inside the main dashboard with one-pass scannability.

### 3. ⚙️ Worker Compute Telemetry & Utilization
* **Dynamic Node Resource Indicators:** Displays real-time CPU core load and Memory footprint progress bars (thickened to 8px for maximum visibility) for active workers.
* **Friendly Node Names:** Custom worker identifiers (e.g. `Standard Background Worker #1`) instead of rawUUIDs for easy reading.
* **Active Status Motion:** Integrated fluid loading indicators using Lottie animations (`@lottiefiles/dotlottie-react` with `/animation.lottie` assets) and pulsing row shimmers during active computation.

### 4. 📂 Multi-Tenant Project Creation
* **Empty Project Fallback:** Defensive routing structure redirects organizations with no projects to a dedicated empty state prompting project setup. Prevents 422 submission failures.

---

## 🛠️ Architecture

* **Backend:** FastAPI, SQLAlchemy ORM (SQLAlchemy async sessions), Pydantic schemas, SQLite/Postgres with Alembic migrations.
* **Frontend:** React 18, Vite, CSS Variables (light mode, slate/zinc borders, `#09090b` accents).
* **Workers:** Independent polling processes querying tasks based on matching capabilities (`standard` vs. `high_compute`).

---

## 🏁 Getting Started

### Prerequisites
* Python 3.10+
* Node.js 18+

### 1. Backend Server Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Initialize virtual environment and install dependencies:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   ```
3. Run migrations and seed DB:
   ```bash
   python scripts/seed.py
   ```
4. Start the FastAPI server:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
   ```

### 2. Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the Vite development server:
   ```bash
   npm run dev
   ```

### 3. Background Workers Setup
Start individual worker nodes to pick up tasks from registered queues:
* **Standard worker node:**
  ```bash
  $env:WORKER_ID="standard-1"; $env:WORKER_TYPE="standard"; uvicorn app.main:app --host 127.0.0.1 --port 8001
  ```
* **High Compute worker node:**
  ```bash
  $env:WORKER_ID="high-1"; $env:WORKER_TYPE="high_compute"; uvicorn app.main:app --host 127.0.0.1 --port 8002
  ```

---

## 🔒 Default Credentials
* **Log In Email:** `admin@example.com`
* **Log In Password:** `password123`
