# start.ps1
# Interactive Startup & Installer Script for Windows (Hybrid Setup)
# Runs PostgreSQL in Docker, and Backend + Workers + Frontend locally.

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "          JobRunR Distributed Job Scheduler" -ForegroundColor Cyan
Write-Host "            Interactive Setup & Launch script" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Dependency Checks
# ─────────────────────────────────────────────────────────────────────────────

# A. Check Python
try {
    $pythonVer = & python --version 2>&1
    Write-Host "✔ Python found: $pythonVer" -ForegroundColor Green
} catch {
    Write-Host "✖ Python is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please download Python 3.11+ from https://www.python.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

# B. Check Node.js & npm
try {
    $nodeVer = & node --version 2>&1
    $npmVer = & npm --version 2>&1
    Write-Host "✔ Node.js found: $nodeVer" -ForegroundColor Green
    Write-Host "✔ npm found: v$npmVer" -ForegroundColor Green
} catch {
    Write-Host "✖ Node.js or npm is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please download Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

# C. Check Docker
try {
    $dockerVer = & docker --version 2>&1
    Write-Host "✔ Docker found: $dockerVer" -ForegroundColor Green
} catch {
    Write-Host "✖ Docker is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

# D. Check if Docker Daemon is running
Write-Host "Checking if Docker service is running..." -ForegroundColor Gray
while ($true) {
    & docker info >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✔ Docker Daemon is active and running." -ForegroundColor Green
        break
    }
    Write-Host ""
    Write-Host "⚠️ Docker Desktop is NOT running!" -ForegroundColor Yellow
    Write-Host "Please open Docker Desktop now and wait for it to start." -ForegroundColor Yellow
    Write-Host "Press any key once Docker Desktop is running to retry..." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. File & Environment Setup
# ─────────────────────────────────────────────────────────────────────────────

# Copy .env if it doesn't exist
if (-not (Test-Path ".env")) {
    Write-Host "Copying .env.example to .env..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✔ .env file created." -ForegroundColor Green
} else {
    Write-Host "✔ .env file already exists." -ForegroundColor Green
}

# ─────────────────────────────────────────────────────────────────────────────
# 3. Python Virtual Environment & Dependencies
# ─────────────────────────────────────────────────────────────────────────────

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python virtual environment (.venv)..." -ForegroundColor Yellow
    & python -m venv .venv
    Write-Host "✔ Virtual environment created." -ForegroundColor Green
} else {
    Write-Host "✔ Virtual environment (.venv) already exists." -ForegroundColor Green
}

Write-Host "Installing/Upgrading Python dependencies..." -ForegroundColor Yellow
& .\.venv\Scripts\python -m pip install --upgrade pip
& .\.venv\Scripts\pip install -r backend/requirements.txt -r worker/requirements.txt
Write-Host "✔ Python packages installed successfully." -ForegroundColor Green

# ─────────────────────────────────────────────────────────────────────────────
# 4. Frontend Node Modules
# ─────────────────────────────────────────────────────────────────────────────

if (-not (Test-Path "frontend/node_modules")) {
    Write-Host "Installing frontend dependencies (npm install)..." -ForegroundColor Yellow
    Set-Location frontend
    & npm install
    Set-Location ..
    Write-Host "✔ Frontend packages installed." -ForegroundColor Green
} else {
    Write-Host "✔ Frontend dependencies (node_modules) already exist." -ForegroundColor Green
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. Database Container (Postgres)
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "Starting PostgreSQL database in Docker..." -ForegroundColor Yellow
& docker compose up db -d
Write-Host "✔ Database container started." -ForegroundColor Green

Write-Host "Waiting 5 seconds for PostgreSQL database to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# ─────────────────────────────────────────────────────────────────────────────
# 6. Database Migrations & Seeding
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "Running database migrations..." -ForegroundColor Yellow
Set-Location backend
& ..\.venv\Scripts\alembic upgrade head
Set-Location ..
Write-Host "✔ Database migrations completed." -ForegroundColor Green

Write-Host "Seeding database..." -ForegroundColor Yellow
& .\.venv\Scripts\python scripts/seed.py --if-empty
Write-Host "✔ Database seed complete." -ForegroundColor Green

# ─────────────────────────────────────────────────────────────────────────────
# 7. Start Services in Separate Terminals
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "🚀 Launching all services in separate windows..." -ForegroundColor Cyan

# A. Backend API Server
Write-Host "→ Launching API Server on http://localhost:8000" -ForegroundColor Gray
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; ..\.venv\Scripts\activate; uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

# B. Standard Background Worker
Write-Host "→ Launching Standard Worker on port 8001" -ForegroundColor Gray
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd worker; ..\.venv\Scripts\activate; `$env:WORKER_ID='standard-1'; `$env:WORKER_TYPE='standard'; uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload"

# C. Frontend Dev Server
Write-Host "→ Launching Frontend on http://localhost:5173" -ForegroundColor Gray
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host ""
Write-Host "🎉 Setup and Launch Complete!" -ForegroundColor Green
Write-Host "You can close this control window now. Keep the new windows open while testing." -ForegroundColor Cyan
Write-Host "Admin user: admin@example.com / password123" -ForegroundColor Green
Write-Host "Dashboard: http://localhost:5173" -ForegroundColor Green
Write-Host "Swagger Docs: http://localhost:8000/docs" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close this window..."
