#!/bin/bash
# start.sh
# Startup & Installer Script for macOS and Linux (Hybrid Setup)
# Runs PostgreSQL in Docker, and Backend + Workers + Frontend locally.

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}==========================================================${NC}"
echo -e "${CYAN}          JobRunR Distributed Job Scheduler${NC}"
echo -e "${CYAN}            Interactive Setup & Launch Script${NC}"
echo -e "${CYAN}==========================================================${NC}"
echo ""

# 1. Dependency Checks

# A. Check Python
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD=python3
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD=python
else
    echo -e "${RED}✖ Python is not installed.${NC}"
    echo -e "${YELLOW}Please install Python 3.11+ using your package manager.${NC}"
    exit 1
fi
echo -e "${GREEN}✔ Python found: $($PYTHON_CMD --version)${NC}"

# B. Check Node & npm
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo -e "${GREEN}✔ Node.js found: $(node --version)${NC}"
    echo -e "${GREEN}✔ npm found: v$(npm --version)${NC}"
else
    echo -e "${RED}✖ Node.js or npm is not installed.${NC}"
    echo -e "${YELLOW}Please install Node.js (v20+) on your system.${NC}"
    exit 1
fi

# C. Check Docker
if command -v docker >/dev/null 2>&1; then
    echo -e "${GREEN}✔ Docker found: $(docker --version)${NC}"
else
    echo -e "${RED}✖ Docker is not installed.${NC}"
    echo -e "${YELLOW}Please install Docker on your machine.${NC}"
    exit 1
fi

# D. Check if Docker Daemon is running
echo -e "Checking if Docker service is running..."
while true; do
    if docker info >/dev/null 2>&1; then
        echo -e "${GREEN}✔ Docker Daemon is active and running.${NC}"
        break
    fi
    echo ""
    echo -e "${YELLOW}⚠️ Docker Desktop / Daemon is NOT running!${NC}"
    echo -e "${YELLOW}Please start Docker Desktop and wait for it to be ready.${NC}"
    echo -e "${CYAN}Press [Enter] once Docker is running to retry...${NC}"
    read -r
done

# 2. File & Environment Setup
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Copying .env.example to .env...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✔ .env file created.${NC}"
else
    echo -e "${GREEN}✔ .env file already exists.${NC}"
fi

# 3. Python Virtual Environment & Dependencies
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment (.venv)...${NC}"
    $PYTHON_CMD -m venv .venv
    echo -e "${GREEN}✔ Virtual environment created.${NC}"
else
    echo -e "${GREEN}✔ Virtual environment (.venv) already exists.${NC}"
fi

echo -e "${YELLOW}Installing/Upgrading Python dependencies...${NC}"
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r backend/requirements.txt -r worker/requirements.txt
echo -e "${GREEN}✔ Python packages installed successfully.${NC}"

# 4. Frontend Node Modules
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies (npm install)...${NC}"
    cd frontend && npm install && cd ..
    echo -e "${GREEN}✔ Frontend packages installed.${NC}"
else
    echo -e "${GREEN}✔ Frontend dependencies (node_modules) already exist.${NC}"
fi

# 5. Database Container (Postgres)
echo -e "${YELLOW}Starting PostgreSQL database in Docker...${NC}"
docker compose up db -d
echo -e "${GREEN}✔ Database container started.${NC}"

echo -e "Waiting 5 seconds for PostgreSQL database to initialize..."
sleep 5

# 6. Database Migrations & Seeding
echo -e "${YELLOW}Running database migrations...${NC}"
cd backend && ../.venv/bin/alembic upgrade head && cd ..
echo -e "${GREEN}✔ Database migrations completed.${NC}"

echo -e "${YELLOW}Seeding database...${NC}"
./.venv/bin/python scripts/seed.py --if-empty
echo -e "${GREEN}✔ Database seed complete.${NC}"

# 7. Start Services using concurrently
echo ""
echo -e "${CYAN}🚀 Launching all services concurrently...${NC}"
echo -e "${YELLOW}Admin credentials: admin@example.com / password123${NC}"
echo -e "${GREEN}Web Dashboard: http://localhost:5173${NC}"
echo -e "${GREEN}Swagger API docs: http://localhost:8000/docs${NC}"
echo -e "${CYAN}Press Ctrl+C to stop all services simultaneously.${NC}"
echo ""

npx concurrently \
  --names "API,Worker,Frontend" \
  --prefix-colors "blue,magenta,cyan" \
  --kill-others \
  "cd backend && ../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload" \
  "cd worker && WORKER_ID=standard-1 WORKER_TYPE=standard ../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload" \
  "cd frontend && npm run dev"
