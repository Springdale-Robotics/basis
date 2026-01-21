# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

The main entry point is `./dev.sh` which manages the entire development environment:

```bash
./dev.sh start              # Start full stack (Postgres, Redis, backend, frontend)
./dev.sh start backend      # Backend only with Docker infrastructure
./dev.sh start frontend     # Frontend only (assumes backend running)
./dev.sh stop               # Stop all services
./dev.sh restart            # Restart all services
```

**Database:**
```bash
./dev.sh db                 # PostgreSQL shell
./dev.sh db push            # Push schema changes (dev)
./dev.sh db migrate         # Run migrations
./dev.sh db seed            # Insert demo data
./dev.sh db studio          # Drizzle Studio visual browser
./dev.sh db reset           # Delete all data (confirms first)
```

**Testing & Quality:**
```bash
./dev.sh test               # Run all tests
./dev.sh test backend       # Backend tests only
cd backend && npm run lint          # ESLint
cd backend && npm run typecheck     # TypeScript check
cd frontend && npm run lint         # Frontend ESLint
```

**Single test file:** `cd backend && npx vitest run path/to/test.ts`

## Architecture

### Backend (Fastify + TypeScript)

- **Entry:** `backend/src/index.ts` → `backend/src/app.ts`
- **API Routes:** `backend/src/modules/*/` - Each module has routes, services, schemas
- **Database:** Drizzle ORM with PostgreSQL, schema in `backend/src/db/schema/`
- **WebSocket:** Socket.io in `backend/src/websocket/` for real-time updates
- **Jobs:** BullMQ workers in `backend/src/jobs/` (notifications, sync, backup, cleanup)
- **All routes prefixed with `/api/v1/`**

### Frontend (React + Vite + TypeScript)

- **Entry:** `frontend/src/main.tsx` → `frontend/src/App.tsx`
- **Routing:** React Router v6, routes defined in `App.tsx`
- **State:** TanStack React Query for server state, Zustand stores in `frontend/src/stores/`
- **API:** Fetch wrapper in `frontend/src/api/client.ts`, domain modules in `frontend/src/api/`
- **UI:** shadcn/ui components (Radix-based) in `frontend/src/components/ui/`
- **Styling:** Tailwind CSS with custom theme

### Key Patterns

- **Multi-tenant:** Row-level security via `app.household_id` PostgreSQL context
- **Real-time sync:** WebSocket events trigger React Query invalidations
- **Auth:** Cookie-based sessions with Lucia, stored in database
- **Validation:** Zod schemas shared between routes and forms

## Infrastructure

- **PostgreSQL:** localhost:5432 (Docker, credentials: homemanager/devpassword)
- **Redis:** localhost:6379 (Docker, used for sessions and job queue)
- **Backend:** http://localhost:3000
- **Frontend:** http://localhost:5173 (proxies /api to backend)

Backend `.env` is auto-created by `dev.sh` with development defaults.

## Path Aliases

Both frontend and backend use `@/*` → `./src/*` path aliases.
