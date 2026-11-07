# Developer Guide: Developing Job Intelligence (Backend & Frontend)

This guide provides the complete set of commands, workflows, and best practices for developing the **Job Intelligence** application locally.

---

## Table of Contents
1. [Prerequisites & System Requirements](#1-prerequisites--system-requirements)
2. [Initial Workspace Setup](#2-initial-workspace-setup)
3. [Environment Configuration](#3-environment-configuration)
4. [Database & Supporting Services Setup](#4-database--supporting-services-setup)
5. [Prisma Workflow & Schema Management](#5-prisma-workflow--schema-management)
6. [Starting Local Development Servers](#6-starting-local-development-servers)
7. [Running Tests (5-Layer Testing Architecture)](#7-running-tests-5-layer-testing-architecture)
8. [Code Quality, Linting & Formatting](#8-code-quality-linting--formatting)
9. [Crawler, CLI & Background Tasks in Development](#9-crawler-cli--background-tasks-in-development)
10. [Troubleshooting Common Issues](#10-troubleshooting-common-issues)

---

## 1. Prerequisites & System Requirements

Before beginning development, ensure your local system has:
- **Node.js**: `v20.x` or `v22.x` LTS (`node -v`)
- **Package Manager**: `pnpm` `v9.x` (`corepack enable && pnpm -v`)
- **Docker & Docker Compose**: Required for running local PostgreSQL 16 and Redis 7 services or running disposable test containers (`docker --version`, `docker compose version`).
- **PostgreSQL Client (Optional)**: `psql` for manual database inspection.

---

## 2. Initial Workspace Setup

Clone the repository and install all root and sub-package dependencies:

```bash
# From repository root
pnpm install
```

> [!NOTE]
> Root `package.json` coordinates shared tooling (Prettier, ESLint, TypeScript). `backend/` and `frontend/` have their own independent `package.json` boundaries for clean runtime isolation.

---

## 3. Environment Configuration

Copy the example configuration to `.env` in the project root:

```bash
cp .env.example .env
```

### Essential Development Variables in `.env`:

| Variable | Recommended Dev Value | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://jobapp:jobapp_local@127.0.0.1:5432/job_intelligence` | PostgreSQL connection string (local or Neon). |
| `DATABASE_MODE` | `local` (or `neon`) | Identifies active database profile. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis instance for sliding-window rate limiting. |
| `RATE_LIMIT_FAIL_OPEN` | `true` | Allows dev/test requests to succeed if Redis is not running. |
| `ADMIN_USERNAME` | `admin` | HTTP Basic Auth username for operations console. |
| `ADMIN_PASSWORD` | `asdfasdf` | HTTP Basic Auth password for operations console. |
| `DEFAULT_CANDIDATE_PASSWORD` | `asdfasdf` | Default initial password for seeded candidate accounts. |
| `CANDIDATE_SESSION_SECRET` | `local-development-session-secret-2026-change-before-production` | Secret key used to sign HMAC session tokens. |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Allowed CORS origin for frontend client requests (`3000` for local dev, `3003` for Docker). |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | Base API URL called by the Next.js frontend. |

Verify your environment configuration:
```bash
pnpm env:check
```

---

## 4. Database & Supporting Services Setup

You can run your database and caching services locally using Docker without installing PostgreSQL or Redis natively.

### Option A: Local Docker Services (PostgreSQL 16 + Redis 7)

Start only the database and Redis containers in the background:

```bash
# Starts local PostgreSQL on :5432 and Redis on :6379
docker compose up -d db redis
```

Check service status:
```bash
docker compose ps
```

Verify PostgreSQL is healthy:
```bash
docker compose exec db pg_isready -U jobapp -d job_intelligence
```

Verify Redis is healthy:
```bash
docker compose exec redis redis-cli ping
# Expected response: PONG
```

### Option B: Cloud Neon Database

If connecting directly to a remote Neon PostgreSQL instance, update `.env`:
```env
DATABASE_URL=postgresql://<user>:<password>@<ep-id>.neon.tech/<dbname>?sslmode=require
DATABASE_MODE=neon
```

---

## 5. Prisma Workflow & Schema Management

This project uses a **modular Prisma schema** architecture located in [`backend/prisma/schema/`](file:///home/chillpc/MohammadSheakh/projects/26/job-intelligence-prd-db-switch-ready/job-intelligence-prd-db-switch/backend/prisma/schema).

### Build Schema & Generate Prisma Client (`prisma:sync`)

Whenever you modify any `.prisma` file under `backend/prisma/schema/`, run `prisma:sync` to assemble `prisma/schema.prisma` and regenerate `@prisma/client`:

```bash
# From root:
pnpm prisma:sync

# Or from backend/:
pnpm --dir backend prisma:sync
```

### Database Migrations in Development (`prisma:migrate:dev`)

Generate and apply a new timestamped migration:

```bash
# From root:
pnpm prisma:migrate:dev

# Or from backend/:
pnpm --dir backend prisma:migrate:dev
```

> [!IMPORTANT]
> `prisma:migrate:dev` executes [`prisma/scripts/migrate-dev.mjs`](file:///home/chillpc/MohammadSheakh/projects/26/job-intelligence-prd-db-switch-ready/job-intelligence-prd-db-switch/backend/prisma/scripts/migrate-dev.mjs) which rebuilds the modular schema, generates a migration file, applies it, and recalculates migration checksums automatically.

### Check Migration Status (`prisma:migrate:status`)

```bash
pnpm prisma:migrate:status
```

### Deploy Migrations to Authoritative Database (`prisma:migrate:deploy`)

Applies pending migrations without prompting:
```bash
pnpm prisma:migrate:deploy
```

### Safe Idempotent Database Seeding (`prisma:seed`)

Seed initial metadata and candidate test accounts safely:

```bash
# Preview seed actions (read-only):
pnpm prisma:seed

# Apply seed records to the active database:
pnpm prisma:seed --apply
```

---

## 6. Starting Local Development Servers

During development, run the NestJS API backend and Next.js frontend concurrently.

### Running Both Concurrently (Recommended)

Open two terminal windows:

#### Terminal 1 — Backend API (NestJS with Hot Reload on Port 4000)
```bash
# From repository root:
pnpm dev:backend

# Or from backend directory:
cd backend && pnpm dev
```
- **API Base URL**: `http://localhost:4000/api/v1`
- **Health Endpoint**: `http://localhost:4000/api/v1/health`
- **Swagger / API Endpoints**: All routes prefixed with `/api/v1/*`

#### Terminal 2 — Frontend App (Next.js 15 App Router with Fast Refresh on Port 3000)
```bash
# From repository root:
pnpm dev:frontend

# Or from frontend directory:
cd frontend && pnpm dev
```
- **Landing Gateway**: `http://localhost:3000/`
- **Candidate Dashboard**: `http://localhost:3000/candidate`
- **Candidate Jobs Explorer & Categories**: `http://localhost:3000/candidate/jobs`
- **Candidate Companies**: `http://localhost:3000/candidate/companies`
- **Candidate Pipeline Tracker**: `http://localhost:3000/candidate/pipeline`
- **Candidate Profile Tuning**: `http://localhost:3000/candidate/profile`
- **Candidate Login**: `http://localhost:3000/candidate/login`
- **Operations Console (Admin)**: `http://localhost:3000/admin`
*(Note: When running with Docker Compose instead of local dev, frontend is served at `http://localhost:3003`)*

---

## 7. Running Tests (5-Layer Testing Architecture)

The codebase implements a comprehensive 5-layer testing pyramid. All tests run fast, reliably, and independently.

### Quick Commands Overview

| Layer | Scope | Target | Command |
| :--- | :--- | :--- | :--- |
| **Layer 1** | Pure Domain Unit Tests | Pure TypeScript functions/domain services | `pnpm test:unit` |
| **Layer 1** | Nest Module Integration Tests | Nest services with mocked dependencies | `pnpm test:integration` |
| **Layer 1** | All Fast Tests (Unit + Integration) | In-memory Jest runner | `pnpm test:backend` |
| **Layer 2** | Database Integration Tests | Real disposable PostgreSQL 16 container | `pnpm test:database` |
| **Layer 3** | HTTP API E2E Tests | Real disposable PostgreSQL 16 container | `pnpm test:e2e` |
| **Layer 4** | Playwright Browser Tests | Real browser automation (Chromium) | `pnpm test:browser` |
| **Layer 5** | Static Typechecks | TypeScript compiler across workspace | `pnpm typecheck` |

### Detailed Test Execution:

#### 1. Unit & Component Integration Tests (`Layer 1`)
Runs 9 test suites / 50 unit tests using in-memory execution in ~5-6 seconds:
```bash
pnpm test:unit
```
*(Tests cover CandidateJobsService, Matcher, JobCategoryClassifier, CareerPageParser, LinkedInParser, PasswordService, EmailRender, BigIntSerializer, and RateLimitGuard).*

#### 2. Real Database Integration Tests (`Layer 2`)
Automatically spins up a disposable Docker container running PostgreSQL 16, creates tables, executes transactions, tests concurrency locking, and destroys the container:
```bash
pnpm test:database
```

#### 3. Full HTTP E2E Tests (`Layer 3`)
Boots a real NestJS application instance connected to disposable PostgreSQL and executes Supertest HTTP requests across all API routes:
```bash
pnpm test:e2e
```

#### 4. Real Browser Playwright Tests (`Layer 4`)
Boots the NestJS API and Next.js frontend against disposable PostgreSQL and automates user journeys in headless Chromium:
```bash
pnpm test:browser
```

#### 5. Run Single Specific Test File
```bash
# Run one unit test:
pnpm --dir backend jest src/core/guards/sliding-window-rate-limit.guard.spec.ts

# Run one integration test:
pnpm --dir backend jest test/integration/candidate-api.integration-spec.ts
```

---

## 8. Code Quality, Linting & Formatting

The codebase enforces strict TypeScript typing (zero `any`) and consistent styling via Prettier and ESLint.

```bash
# Check formatting without writing:
pnpm format:check

# Automatically fix formatting:
pnpm format

# Run ESLint (max warnings: 0):
pnpm lint

# Automatically fix lint issues:
pnpm lint:fix

# Run combined style validation:
pnpm check:style

# Run TypeScript typechecks across root, backend, and frontend:
pnpm typecheck
pnpm --dir backend typecheck
pnpm --dir backend typecheck:test
pnpm --dir frontend typecheck
```

---

## 9. Crawler, CLI & Background Tasks in Development

You can test individual CLI commands and batch routines without waiting for cron triggers:

```bash
# Build backend first if testing compiled commands:
pnpm build:backend

# Display daily crawl CLI help and options:
pnpm crawl:daily --help
# Or run with:
node backend/dist/src/commands/crawl-daily.js --help

# Test crawler on pilot/sample companies:
pnpm crawl:pilot

# Run LinkedIn company enrichment crawler (website & career page extraction):
pnpm crawl:linkedin

# Run a crawler dry run (does not persist to DB):
pnpm crawl:dry

# Display candidate notification digest CLI help:
pnpm notify:daily --help
# Or run with:
node backend/dist/src/commands/notify-daily.js --help

# Enrich company categories deterministically:
pnpm categories:enrich

# Audit PRD compliance:
pnpm prd-audit
```

---

## 10. Troubleshooting Common Issues

### Issue 1: Port Already in Use (4000, 3000, or 3003)
Find and terminate any orphaned processes:
```bash
# Check for process on port 4000 (backend):
lsof -i :4000
kill -9 <PID>

# Check for process on port 3000 (frontend local dev) or 3003 (Docker frontend):
lsof -i :3000
lsof -i :3003
kill -9 <PID>
```

### Issue 2: Prisma Client Out of Sync
If Prisma types are missing new columns:
```bash
pnpm prisma:sync
```

### Issue 3: Redis Connection Refused in Dev
If Redis is not running locally, make sure `RATE_LIMIT_FAIL_OPEN=true` is set in your `.env`. The `SlidingWindowRateLimitGuard` will log a warning and allow all requests to proceed.
To start Redis:
```bash
docker compose up -d redis
```

### Issue 4: Docker Permission Denied on Disposable Database Tests
Ensure your user has access to Docker without `sudo`:
```bash
docker ps
```
If permission is denied, add your user to the `docker` group:
```bash
sudo usermod -aG docker $USER
```
