# Deployment Guide

Basis installs **natively** — Node, PostgreSQL, and Redis as system packages,
managed by systemd. There is no production Docker stack. (Docker is still used
for *local development* infra; see [Development Setup](#development-setup).)

Supported targets: Ubuntu, Debian, Raspberry Pi OS. macOS is partial (see the
notes in `deploy/native/install.sh`).

## Quick Start

From a checkout (recommended while the repo is private):

```bash
sudo bash backend/deploy/native/install.sh --source "$(pwd)"
```

One-liner (once the repo is public):

```bash
curl -fsSL https://raw.githubusercontent.com/Springdale-Robotics/basis/main/backend/deploy/get-basis.sh | bash
```

The installer:

1. Installs Node 20, PostgreSQL, Redis, and Python (for the ingredient parser).
2. Creates a `basis` system user and the `/opt/basis` layout (atomically
   versioned under `versions/`, with `current` symlinked to the active one).
3. Builds the backend (`tsc`) and frontend (`vite build`).
4. Generates `/opt/basis/.env` with secure secrets and creates the database.
5. Runs migrations.
6. Installs and starts the systemd units, then prints the LAN URL.

Open the printed URL (e.g. `http://<lan-ip>:3000`) to complete first-run setup.

## Services

| Unit | Role |
|------|------|
| `basis.service` | API + serves the built SPA |
| `basis-worker.service` | BullMQ background jobs (notifications, sync, backup, cleanup) |
| `basis-ingredient-parser.service` | Python CRF sidecar for recipe quantity/unit parsing (localhost:8010) |

```bash
sudo systemctl status basis
sudo journalctl -u basis -f          # logs (also -u basis-worker, -u basis-ingredient-parser)
sudo systemctl restart basis
```

## Configuration

`/opt/basis/.env` is generated on first install and **preserved across
updates**. Notable keys (see `deploy/native/install.sh` for the full set):

```bash
DATABASE_URL=postgres://basis:…@localhost:5432/basis
REDIS_URL=redis://localhost:6379
SESSION_SECRET=…           # generated
ENCRYPTION_KEY=…           # generated
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
WORKERS_IN_PROCESS=false   # the dedicated worker unit runs jobs instead
STORAGE_PATH=/opt/basis/data/storage
FRONTEND_DIST=/opt/basis/current/frontend/dist
VLM_LLM_SERVICE_URL=http://localhost:8010   # ingredient parser sidecar
CORS_ORIGINS=              # empty: the backend serves the SPA same-origin
```

## Remote Access (HTTPS)

The app serves plain HTTP on `PORT`. For access beyond the LAN, the simplest
path is the built-in **Remote Access** settings (Tailscale / cloudflared),
which the app configures on the host for you — no separate proxy needed.

If you'd rather terminate TLS yourself on a public domain, `deploy/Caddyfile`
(auto-HTTPS) and `deploy/nginx.conf` (with certbot) are provided as starting
points. Then open the proxy ports:

```bash
sudo ufw allow 80
sudo ufw allow 443
```

## Updating

- **In-app:** the admin Update flow downloads a verified release tarball,
  snapshots the database, migrates, swaps the `current` symlink, and restarts
  the units.
- **Manual:** re-run the installer against a fresh checkout/tarball:
  ```bash
  sudo bash backend/deploy/native/install.sh --source "$(pwd)"
  ```
  Re-running is idempotent and keeps your existing `/opt/basis/.env`.

## Backups

The worker takes scheduled backups, and the update flow writes a pre-update
snapshot to `/opt/basis/data/backups/`. Manual database backup/restore:

```bash
# Backup
sudo -u basis pg_dump "$DATABASE_URL" | gzip > backup.sql.gz
# Restore
gunzip -c backup.sql.gz | sudo -u basis psql "$DATABASE_URL"
```

(`DATABASE_URL` lives in `/opt/basis/.env`.)

## Troubleshooting

```bash
# Service won't start — read the journal
sudo journalctl -u basis -n 50
sudo journalctl -u basis-worker -n 50

# DB / Redis reachable?
sudo systemctl status postgresql redis-server

# Recipe imports show "Ingredient parser unavailable"
sudo systemctl status basis-ingredient-parser
sudo journalctl -u basis-ingredient-parser -n 50
```

---

## Development Setup

Local dev uses Docker for Postgres/Redis/Ollama; the app runs on the host. The
top-level `./dev.sh` orchestrates everything:

```bash
./dev.sh start            # full stack (infra + backend + frontend)
./dev.sh start backend    # backend only
./dev.sh test             # run tests
./dev.sh db studio        # Drizzle Studio
```

To bring up just the dev infra by hand:

```bash
cd backend
docker compose -f docker-compose.dev.yml up -d postgres redis
```

### Backend npm commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert demo data |
| `npm run db:studio` | Open Drizzle Studio |
