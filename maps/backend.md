# Backend Map

All paths relative to project root (`homemanager/`).

## backend/
- `package.json` - Dependencies, scripts (dev, build, db:generate, db:migrate, db:seed)
- `tsconfig.json` - TypeScript config (ESM, ES2022, strict mode)
- `drizzle.config.ts` - Drizzle ORM config pointing to schema
- `.env.example` - Environment variable template
- `.gitignore` - Git ignores (node_modules, dist, .env, logs)
- `docker-compose.dev.yml` - Dev infra (postgres, redis, ollama, vlm-llm) + pgAdmin and Redis Commander
- `DEPLOY.md` - Deployment guide (native systemd install; dev setup)

## backend/deploy/
Production is a native (no-Docker) systemd install — see `deploy/native/`.
- `native/install.sh` - Native installer: Node 20 + Postgres + Redis, builds the app under /opt/basis, installs systemd units. Run `sudo bash ... --source <checkout>`.
- `native/basis.service` - API unit (serves the built SPA)
- `native/basis-worker.service` - BullMQ background worker unit
- `native/basis-ingredient-parser.service` - Python CRF ingredient-parser sidecar (localhost:8010)
- `nginx.conf` - Optional Nginx reverse proxy config with SSL, WebSocket support
- `Caddyfile` - Optional Caddy config with automatic HTTPS
- `get-basis.sh` - One-liner bootstrap: clones the repo and runs `deploy/native/install.sh`

User completes setup in browser via GET /api/v1/setup/status and POST /api/v1/setup

## backend/scripts/
- `migrate.ts` - Runs Drizzle migrations
- `seed.ts` - Creates demo household, admin/member users, default calendar, inventory locations

## backend/src/

### backend/src/config/
- `index.ts` - Zod-validated env config (DATABASE_URL, REDIS_URL, SESSION_SECRET, etc.)
- `database.ts` - Drizzle + postgres.js connection pool
- `redis.ts` - ioredis connection

### backend/src/types/
- `index.ts` - Shared types (UserRole, DeviceType, etc.)
- `fastify.d.ts` - Fastify request augmentation (user, requestId)

### backend/src/lib/
- `logger.ts` - Pino logger with async local storage for request context
- `errors.ts` - Error codes (AUTH_1xxx, VAL_2xxx, RES_3xxx, etc.) and AppError class
- `validators.ts` - Zod schemas (email, uuid, hexColor, iCalRRule, etc.)
- `encryption.ts` - libsodium encrypt/decrypt helpers
- `permissions.ts` - Role-based permission checking
- `circuit-breaker.ts` - Opossum wrapper for external service calls
- `metrics.ts` - Prometheus metrics (http_requests_total, etc.)

### backend/src/middleware/
- `request-id.middleware.ts` - Generates/propagates X-Request-ID
- `auth.middleware.ts` - Session validation, requireRole(), requireAdmin(), requireMember()
- `rls.middleware.ts` - Sets PostgreSQL RLS context (app.household_id)
- `error.middleware.ts` - Global error handler, maps AppError to HTTP responses
- `rate-limit.middleware.ts` - @fastify/rate-limit config
- `sanitization.middleware.ts` - XSS protection via sanitize-html

### backend/src/db/schema/
- `households.ts` - households table
- `users.ts` - users table with role enum
- `sessions.ts` - sessions table (token, expiresAt, deviceId)
- `devices.ts` - devices table (type, pushToken, lastSeen)
- `permissions.ts` - permissions table (userId, resourceType, resourceId)
- `groups.ts` - groups, group_members tables
- `calendars.ts` - calendars, calendar_events, event_attendees, calendar_shares tables
- `recipes.ts` - recipes, recipe_ingredients, meal_plans tables
- `inventory.ts` - inventory_locations, inventory_items tables
- `tasks.ts` - tasks, rewards, reward_history, achievements, user_achievements tables
- `files.ts` - files, folders, albums, album_files, playlists, playlist_items tables
- `lists.ts` - lists, list_items tables
- `notifications.ts` - notifications, user_settings tables
- `connections.ts` - connected_households, connection_invites, shared_resources, sync_queue tables
- `settings.ts` - extensions, ddns_config, music_integrations, backup_schedules, backups tables
- `audit.ts` - audit_logs table
- `member-invites.ts` - member_invites table
- `index.ts` - Re-exports all schemas + relations

### backend/src/modules/

#### auth/
- `auth.schema.ts` - Zod schemas for login, register, password reset
- `auth.service.ts` - login(), register(), logout(), createSession(), verifyPassword(), createPasswordResetToken()
- `auth.routes.ts` - POST /login, /register, /logout, /refresh, /forgot-password, /reset-password; GET /me

#### health/
- `health.routes.ts` - GET /health (checks DB + Redis connectivity)

#### setup/
- `setup.routes.ts` - GET /status, POST / (initial household + admin creation)

#### households/
- `households.routes.ts` - GET /, PATCH /, GET /members, POST /members/invite, DELETE /members/:id

#### users/
- `users.routes.ts` - GET /me, PATCH /me, PATCH /me/password, DELETE /me, GET /:id, PATCH /:id, DELETE /:id

#### devices/
- `devices.routes.ts` - GET /, POST /register, DELETE /:id, POST /:id/push-token, POST /:id/heartbeat

#### calendars/
- `calendars.routes.ts` - CRUD calendars, CRUD events, event attendees, calendar sharing, iCal export

#### recipes/
- `recipes.routes.ts` - CRUD recipes, ingredients, meal plans, recipe search, scaling

#### inventory/
- `inventory.routes.ts` - CRUD locations, CRUD items, quantity adjustments, low stock, expiring items

#### tasks/
- `tasks.routes.ts` - CRUD tasks, complete, assign, chores, rewards CRUD, achievements CRUD, user achievements

#### files/
- `files.routes.ts` - File upload/download/delete, folders CRUD, albums CRUD, playlists CRUD, storage usage

#### lists/
- `lists.routes.ts` - CRUD lists, CRUD items, toggle checked, reorder, clear checked

#### notifications/
- `notifications.routes.ts` - GET notifications, mark read, read all, delete, preferences, execute action

#### settings/
- `settings.routes.ts` - Household settings, theme, features, remote access, DDNS, extensions, music integrations

#### backup/
- `backup.routes.ts` - CRUD backups, download, restore, upload, schedules CRUD

#### connections/
- `connections.routes.ts` - Connection invites, accept/decline, CRUD connections, share resources, sync status

### backend/src/websocket/
- `index.ts` - Socket.io server init, auth middleware, room management, emitToHousehold/User/Room helpers
- `events.ts` - Typed event emitters (calendar, inventory, task, recipe, file, notification, list, device, sync)

### backend/src/jobs/
- `index.ts` - BullMQ queues (notification, sync, backup, cleanup, inventory), worker init, recurring job scheduling
- `notification.worker.ts` - Creates DB notification + emits real-time event
- `sync.worker.ts` - Processes share/update/delete sync between connected households
- `backup.worker.ts` - Gathers household data, encrypts, writes file, cleanup old backups
- `cleanup.worker.ts` - Expired sessions, old notifications, old audit logs, orphaned files
- `inventory.worker.ts` - Low stock alerts, expiring items alerts

### backend/src/app.ts
- Builds Fastify instance with plugins (helmet, cors, compress, cookie, multipart, swagger)
- Registers all route modules at /api/v1/* prefixes
- Sets up error handler and graceful shutdown hooks

### backend/src/index.ts
- Main entry: builds app, creates HTTP server, attaches WebSocket, starts workers, schedules jobs
- Graceful shutdown on SIGINT/SIGTERM

---

## Development Workflow

The development script `dev.sh` is located at the **project root** (not in backend/).

### Quick Start (Full Stack)
```bash
./dev.sh start
```
This starts DB/Redis in Docker, plus backend AND frontend locally with hot reload.
- Backend: http://localhost:3000
- Frontend: http://localhost:5173

### Commands
| Command | Description |
|---------|-------------|
| `./dev.sh start` | Full stack: DB, Redis, backend, frontend (hot reload) |
| `./dev.sh start backend` | Backend only: DB/Redis in Docker, backend locally |
| `./dev.sh start frontend` | Frontend only (backend must be running) |
| `./dev.sh stop` | Stop all services |
| `./dev.sh restart` | Restart all services |
| `./dev.sh rebuild` | Rebuild backend container (keeps data) |
| `./dev.sh logs [service]` | Tail logs (default: backend) |
| `./dev.sh db` | PostgreSQL shell |
| `./dev.sh db migrate` | Run migrations |
| `./dev.sh db push` | Push schema changes (dev) |
| `./dev.sh db seed` | Insert demo data |
| `./dev.sh db studio` | Open Drizzle Studio (visual DB browser) |
| `./dev.sh db reset` | Delete all data (confirms first) |
| `./dev.sh redis` | Redis CLI |
| `./dev.sh test` | Run all tests |
| `./dev.sh test backend` | Run backend tests |
| `./dev.sh test frontend` | Run frontend tests |
| `./dev.sh install` | Install all npm dependencies |
| `./dev.sh clean` | Remove everything (confirms first) |
| `./dev.sh help` | Show help |

### Typical Workflows

**Change code → auto-reloads** (when using `./dev.sh start`)

**Change schema:**
```bash
# Edit backend/src/db/schema/*.ts
./dev.sh db migrate   # or: ./dev.sh db push
```

**Rebuild Docker image after dependency changes:**
```bash
./dev.sh rebuild
```

**Start fresh:**
```bash
./dev.sh db reset
./dev.sh start
# Then seed: ./dev.sh db seed
```
