# Basis

Self-hosted household management. Calendar, recipes, meal planning, tasks,
inventory, lists, files, photos — all in one app that runs on a box in your
closet.

**Status:** Pre-release. APIs and schemas may break between commits until the
first tagged release.

---

## What's in the box

- **Calendar** with CalDAV/ICS so iOS/macOS/Google clients can subscribe and
  edit two-way
- **Recipes + meal plan** including URL import and a cook mode
- **Tasks & chores** with recurring rules and per-person assignment
- **Inventory** tracking with shopping-list integration
- **Lists** (checklist / wishlist / notes) with offline sync
- **Files, photos, videos, music** with thumbnails and transcoding
- **Per-member permissions** and group-level overrides
- **Remote access** via Tailscale, Cloudflare Tunnel, or your own domain — all
  configurable from the settings UI without touching a terminal

---

## Installing

Two install paths. Both end with a URL you open in a browser to finish setup.

### Native (systemd, no Docker)

```bash
git clone https://github.com/Springdale-Robotics/basis
cd basis
sudo bash backend/deploy/native/install.sh --source "$(pwd)"
```

Installs Node 20, PostgreSQL 16, Redis. Creates a `basis` system user with
sudo, lays out `/opt/basis/`, builds the app, generates secrets, runs
migrations, installs systemd units, starts the service.

Tested on Ubuntu/Debian. macOS partial — `brew install node@20 postgresql@16 redis`
first, then run with `--skip-deps`.

### Docker

```bash
git clone https://github.com/Springdale-Robotics/basis
cd basis/backend
./install.sh
```

Installs Docker if missing, generates secrets, runs `docker compose up -d`.
Stack: backend + Postgres + Redis + (optional) Ollama for AI features.

---

## Development

```bash
./dev.sh start            # full stack — Postgres + Redis in Docker, backend + frontend native
./dev.sh start backend    # backend + its infra only
./dev.sh start frontend   # frontend only (assumes backend running)
./dev.sh stop
./dev.sh db push          # apply schema changes (dev)
./dev.sh db studio        # visual DB browser
./dev.sh test             # run all tests
```

Backend runs at `http://localhost:3000`, frontend at `http://localhost:5173`
(proxies `/api` to backend).

See `CLAUDE.md` for the architecture overview and `backend/DEPLOY.md` for the
deployment guide.

---

## License

[MIT](./LICENSE)
