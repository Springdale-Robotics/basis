# Basis — Website Content & Instructions

Everything to put on a basis.app (or wherever you host it) marketing/docs site,
plus complete in-depth installation and operations instructions.

Organized so you can lift sections wholesale into page templates, or hand it
to whatever doc generator you end up using (Astro Starlight, Docusaurus,
Nextra, VitePress, plain HTML).

---

## 0. Site structure suggestion

A small but sufficient information architecture for an early-stage self-hosted
project:

```
/                       — Hero, features, install one-liner, screenshots
/docs/                  — Versioned documentation root
  /install/             — Install paths (native, Docker, future RPi)
  /setup/               — First-run setup
  /remote-access/       — Tailscale / Cloudflare / custom-domain
  /backups/             — Backup + restore (when restore ships)
  /updating/            — How updates work, rollback
  /architecture/        — How it's built (for the curious)
  /troubleshooting/     — FAQ + common problems
/changelog              — Pulled from GitHub Releases
/roadmap                — What's coming, what's not planned
/security               — Threat model, what data lives where
/about                  — Who's making it
/discord (or similar)   — Community link (when ready)
```

The repo itself stays at `github.com/Springdale-Robotics/basis`. The site
exists to make Basis discoverable and to host docs that are easier to read
than a long README.

---

## 1. Marketing copy

### Tagline candidates

Pick one for the hero:

- **"The household OS that lives in your closet."** — Punchy, sets up the
  self-hosted angle.
- **"Calendar, recipes, chores, photos — for your family, on your hardware."**
  — Concrete; says exactly what it does.
- **"Everything your household runs on, in one app you actually own."**
  — Ownership framing; appeals to the self-hosting crowd.
- **"Your family's home server — without the homework."** — Hints at the
  white-glove installer story.

### Hero subheading

> Basis is a self-hosted household app: calendar with CalDAV sync, recipes
> with meal planning, chores and tasks, an inventory + shopping list, photos
> and files. One install command on a box you control, and everything past
> that is configured through the web UI — no SSH, no YAML.

### Three-bullet pitch

- **One install command, then UI for everything else.** Paste a single
  `curl | sudo bash` line. After that, every piece of configuration — remote
  access, updates, backups, system shell — happens in the browser.
- **Designed for households, not enterprises.** Per-member permissions,
  group overrides, a "rewards & chore chart" mode you can turn off when the
  kids grow up, sensible defaults for the way real families use things.
- **Yours to keep.** MIT-licensed, runs entirely on hardware you own. No
  cloud account required. Optional Tailscale / Cloudflare Tunnel for remote
  access when you want it.

---

## 2. Feature list (long-form, for the homepage / features page)

### Calendar

Shared household calendar with two-way CalDAV/ICS sync. iOS Calendar, macOS
Calendar, Outlook, Thunderbird, and Google Calendar can all subscribe AND
edit. Per-calendar colors. Free/busy view-only sharing for visitors.

### Recipes & meal plan

Recipe library with URL import (parses any reasonable recipe page). Meal
planning per day/per meal. Cook mode that turns a recipe into a
voice-friendly step-through. Optional: AI parsing of recipe images.

### Tasks & chores

Assignable tasks with due dates and recurrence (RRULE-style — daily, weekly,
monthly, weird intervals). Rewards mode awards points for completed chores,
designed for households with kids; turn it off in settings if you're past
that age. Quick-add parser ("buy milk tomorrow at 9am, assigned to Jordan").

### Inventory & shopping list

Track what's in the pantry / fridge / wherever. Smart shopping list that
infers when you're running low. Image-based intake (snap a receipt, auto-add
items) — optional.

### Lists

A general-purpose "lists" surface for things that aren't tasks or shopping:
checklist (one-off, like "beach trip packing"), wishlist, notes. Offline
sync — works on bad cellular signal at the grocery store.

### Files, photos, videos, music

Browser-based file storage. Thumbnails. Video and music transcoding so
clients can stream. Photo gallery view.

### Per-member permissions

Members have roles (admin, member, kid, visitor). Each major feature
(calendars, tasks, inventory, etc.) has a default per-role permission level
you can override per user OR per group. "Kid can view-but-not-edit the
calendar," "babysitter group can see only today's events," etc.

### Remote access — without the hard parts

Pick a mode in settings: Tailscale (auto-TLS on your tailnet), Cloudflare
Tunnel (free, no port-forwarding), custom domain (your own reverse proxy),
or local-only. The settings page handles the whole setup — including
installing `cloudflared` and `tailscale` if they're missing — via a guided
terminal you watch from the browser. No SSH required.

### CalDAV / ICS interop

The calendar speaks real CalDAV with PROPFIND/REPORT/etc. iOS subscribes
without rejection prompts. App-specific passwords keep your main credentials
out of mobile devices.

---

## 3. Hardware recommendations (page: /docs/hardware)

Basis is light. It runs comfortably on:

- **Raspberry Pi 4 / 5** (4GB RAM or more) — the canonical home-server
  target. SSD strongly recommended over SD card.
- **Mini PC** (Beelink, Minisforum, NUC) — overkill for the household app,
  perfect if you're already running Plex/Jellyfin/Sonarr.
- **Old laptop or desktop** — anything with 2GB RAM and a 64-bit CPU works.
- **A cloud VPS** — fine, but you lose some of the point. Self-hosted
  doesn't mean "in your house" necessarily; it means "you control it."

Storage: budget at least 20 GB for the OS + DB. Add however much you want
for media (photos, video, music). The app itself is small.

Networking: any standard home LAN. Remote access works without
port-forwarding if you use Tailscale or Cloudflare Tunnel.

---

## 4. Install — in-depth (page: /docs/install)

### Option A: Native (Ubuntu / Debian) — recommended

One terminal command on the host:

```bash
git clone https://github.com/Springdale-Robotics/basis
cd basis
sudo bash backend/deploy/native/install.sh --source "$(pwd)"
```

What the installer does, step by step:

1. **Sanity checks.** Confirms you're running as root, identifies the OS.
2. **Installs system packages** via `apt`:
   - Node.js 20 (from the NodeSource repo)
   - PostgreSQL 16 (`postgresql` + `postgresql-contrib`)
   - Redis (`redis-server`)
   - ffmpeg (for media thumbnails)
   - build tools (gcc, make) for native Node modules
3. **Creates a `basis` system user** with a real shell and a home at
   `/opt/basis`. Adds them to the `sudo` group. **Prompts you to set a
   password** — this is the password you'll be asked for when an admin
   action in the UI needs root.
4. **Lays out `/opt/basis/`:**
   - `versions/<timestamp>/` — the actual code (kept around for rollback)
   - `current` → symlinked to the active version (atomic update swap)
   - `data/storage/` — uploads (photos, files) — never touched by updates
   - `data/backups/` — pg_dump output
   - `bin/` — locally-installed binaries (cloudflared, etc.)
   - `.env` — persistent config, owned 600 by basis:basis
5. **Builds backend + frontend.** `npm ci` + `tsc` for the backend,
   `npm ci` + `vite build` for the frontend.
6. **Creates the PostgreSQL user + database.** Random password, written into
   `.env`. Grants ownership.
7. **Generates `SESSION_SECRET` and `ENCRYPTION_KEY`** with `openssl rand`.
8. **Runs database migrations.**
9. **Installs and enables systemd units:** `basis.service` (the API + SPA)
   and `basis-worker.service` (background jobs). `Restart=always` with
   crash-loop protection.
10. **Opens the firewall** for port 3000 (if `ufw` is active).
11. **Starts the service** and prints the local IP + URL.

Total time: ~5 minutes on first run (mostly `npm ci`).

After it finishes you'll see:

```
✓ Basis is installed

  Open your browser to finish setup:
    http://localhost:3000
    http://192.168.1.50:3000  (LAN)
```

Open that URL on your phone or another computer. The rest happens in the
browser.

### Option B: Docker / Docker Compose

If you already live in Docker land:

```bash
git clone https://github.com/Springdale-Robotics/basis
cd basis/backend
./install.sh
```

This installs Docker if it's missing, generates secrets, and runs
`docker compose up -d`. Stack: backend + Postgres + Redis. Optional Ollama
container for local AI features.

Caveat: the current Docker image is **backend-only**. You'll need to serve
the frontend separately (a Caddy / nginx config in front, or build the
frontend manually and serve it via the backend's FRONTEND_DIST env var).
This will be fixed in a future release.

### Option C: macOS (development / personal use)

Works but isn't a typical deployment target. Install with Homebrew:

```bash
brew install node@20 postgresql@16 redis ffmpeg
git clone https://github.com/Springdale-Robotics/basis
cd basis
sudo bash backend/deploy/native/install.sh --source "$(pwd)" --skip-deps
```

The `--skip-deps` flag tells the installer you've handled package
installation yourself. Everything else is the same.

### Option D: Raspberry Pi

Use the native installer on Raspberry Pi OS (Debian-based). A turnkey SD
card image is on the roadmap.

---

## 5. First-run setup walkthrough (page: /docs/setup)

You've installed. You hit `http://192.168.1.50:3000` from your phone.
Here's what happens:

1. **First-run gate.** No households exist yet → you're redirected to
   `/setup` instead of `/login`.
2. **Create your household.** Name (e.g. "The Sams"), timezone (auto-detected
   from your browser).
3. **Create the admin account.** Email (used for sign-in only — Basis never
   sends mail from this), display name, password.
4. **Sign in.** You land on the dashboard.
5. **From the dashboard, the recommended next steps:**
   - **Invite household members** — Settings → Members → Invite. Each gets
     a one-time link.
   - **Set up remote access** — Settings → Remote Access. Pick a mode (see
     next section).
   - **Add a calendar** — Settings → Calendars → "Add Local Calendar".
   - **Connect your phone's Calendar app** — Settings → Calendars → "Connect
     a device" → walks you through the iOS/Android CalDAV install profile.

You're now using Basis on your LAN. If you want to use it outside the house,
keep reading.

---

## 6. Remote access (page: /docs/remote-access)

By default, Basis is reachable only on your local network. There are three
supported paths to "use it from anywhere," ordered by ease:

### Tailscale (recommended for most people)

**Tailscale's free tier** lets up to ~3 users with up to 100 devices into
a private mesh network. Your phone, your laptop, and your home server all
join the same "tailnet," and they can reach each other without port-
forwarding. Bonus: Tailscale issues a real Let's Encrypt cert for your
tailnet hostname, so CalDAV on iOS works without warnings.

Setup, from the Remote Access settings page:

1. Pick "Tailscale" as the mode.
2. Click **"Install Tailscale"**. A modal opens with an embedded terminal.
3. You'll be prompted for the `basis` user's password (the one you set
   during install). Type it.
4. Tailscale installs and starts. The script then runs `sudo tailscale up`,
   which prints an auth URL.
5. The auth URL is auto-detected; click the button to open it in another
   tab. Sign in to your Tailscale account, authorize this machine.
6. Come back to Basis. Click **"Enable Tailscale HTTPS"**.
7. Done. Your phone (after installing Tailscale and joining the same
   tailnet) reaches Basis at `https://<your-hostname>.<tailnet>.ts.net`.

### Cloudflare Tunnel (recommended for sharing with non-Tailscale users)

A Cloudflare tunnel publishes Basis to the public internet without
port-forwarding, with Cloudflare's TLS in front. Requires a Cloudflare
account and a domain on Cloudflare DNS (free tier is fine).

1. Pick "Cloudflare Tunnel" as the mode.
2. Click **"Install cloudflared"**. The installer downloads the binary into
   `/opt/basis/bin/cloudflared`. No sudo needed.
3. In another tab, open
   [Cloudflare Zero Trust](https://one.dash.cloudflare.com/). Create a new
   tunnel. Copy the connector token.
4. Paste the token into the Basis UI. Set your public URL (e.g.
   `https://home.yourdomain.com`).
5. Click **"Connect tunnel"**. Basis spawns `cloudflared` as a child
   process. The tunnel survives backend restarts.

### Custom domain (for users with their own reverse proxy)

You already have a domain pointed at a server, and you're comfortable
running Caddy or nginx in front of Basis:

1. Pick "Custom domain" as the mode.
2. Enter your public URL.
3. Click **"Test reachability"** — Basis fetches its own URL from inside
   the box and reports whether it terminates somewhere.
4. The page shows you copy-pastable Caddy and nginx snippets templated to
   your hostname. Drop them into your config, reload, you're done.

### Local-only

If you only ever use Basis on your LAN, set the Public URL to your local
IP and you're done. CalDAV on iOS will throw a cert warning the first time
since there's no HTTPS — once you accept it, it works fine.

---

## 7. Updating (page: /docs/updating)

Basis checks for new releases on GitHub.

1. Go to **Settings → Updates**.
2. The page shows your current version and the latest GitHub release with
   notes.
3. Click **"Update to vX.Y.Z"**. A modal opens with an embedded terminal.
4. The update script:
   - Downloads the latest release tarball
   - Extracts it to `/opt/basis/versions/<new-version>/`
   - Runs `npm ci` and builds
   - Runs database migrations
   - **Atomically swaps** `/opt/basis/current` to point at the new version
   - Triggers `systemctl restart basis basis-worker` (detached, so the
     restart survives the terminal session ending)
5. Wait about 60 seconds, refresh the page. You're on the new version.

The previous version stays at `/opt/basis/versions/<old-version>/`, and each
update writes a pre-update database snapshot to `/opt/basis/data/backups/`
named `pre-update-<version>-<timestamp>.sql.gz`. To roll back, point the symlink
at the old version and restart:

```bash
sudo ln -sfn versions/<old-version> /opt/basis/current
sudo systemctl restart basis basis-worker
```

Migrations are forward-only, so if the update applied schema changes, also
restore that pre-update snapshot (see Backups → Restore) — otherwise the old
code runs against the newer schema.

A one-click rollback button is on the roadmap.

Updates can also be checked / triggered manually with:

```bash
cd /opt/basis/current
sudo systemctl stop basis basis-worker
git pull   # if running from source
# (or download a fresh tarball)
npm ci && npm run build
npm run db:migrate
sudo systemctl start basis basis-worker
```

---

## 8. Backups (page: /docs/backups)

Basis uses `pg_dump` to take full-database snapshots, gzipped, stored under
`/opt/basis/data/backups/`. From the **Settings → Backup** page:

- **Back up now** — runs `pg_dump | gzip` synchronously. Takes ~1 second
  per MB of database. Result: a `basis-<timestamp>.sql.gz` file in the
  backups directory.
- **Download** — pulls the .sql.gz file to your computer for safekeeping.
- **Delete** — removes a backup.

### Restore

Restore via the UI is in development. For now, restore manually from a
backup file:

```bash
# Stop the app so nothing's writing.
sudo systemctl stop basis basis-worker

# Drop existing connections to the DB.
sudo -u postgres psql -d postgres -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = 'basis' AND pid <> pg_backend_pid();"

# Drop and recreate.
sudo -u postgres dropdb basis
sudo -u postgres createdb -O basis basis

# Restore.
gunzip -c /opt/basis/data/backups/basis-<timestamp>.sql.gz | \
  sudo -u basis psql -d basis

# Start back up.
sudo systemctl start basis basis-worker
```

### Off-site backups

Local backups protect you from data corruption. They don't protect you from
fire, flood, or theft. For off-site:

- **Easiest**: download the .sql.gz files via the UI and stash them in
  whatever cloud storage you already use.
- **Automated**: a cron job that uploads new backups to S3 / Backblaze B2 /
  rclone destination. Roadmap.

---

## 9. Architecture (page: /docs/architecture)

For the curious. Skip if you just want to use it.

- **Backend**: Node 20, Fastify, Drizzle ORM, PostgreSQL 16, Redis (sessions
  + BullMQ job queue), socket.io for real-time updates.
- **Frontend**: React 18, Vite, Tailwind, shadcn/ui (Radix-based), TanStack
  React Query for server state, Zustand for client state.
- **Auth**: cookie-based sessions in PostgreSQL, Lucia-style. App-specific
  passwords for CalDAV.
- **Multi-tenancy**: Row-level security via `app.household_id` Postgres
  context. Each request scopes itself to one household.
- **Real-time sync**: socket.io rooms per household; events invalidate
  React Query caches client-side.
- **CalDAV**: Native implementation in the backend (no external CalDAV
  server). Handles PROPFIND, REPORT, time-range queries, sync-collection
  semantics correctly enough for iOS Calendar.
- **Background jobs**: BullMQ + Redis. Notification dispatch, periodic
  sync of subscribed external calendars, thumbnail generation, backup
  cleanup, etc.
- **Static serving**: In production, the backend serves the built frontend
  at `/`, with SPA fallback to `index.html`. Single port, no reverse proxy
  required for the LAN case.

### Update + install model

- `/opt/basis/current` is a symlink to the active version
- Versions are stored at `/opt/basis/versions/<version>/`
- Updates write the new version to a new directory, swap the symlink atomically
- systemd restart picks up the new code; old version stays for rollback

### Why a single Postgres database for everything

For a household-scale app, the simplicity wins. One backup, one set of
indexes, one migration path. The schema isolation is at the row level
(`household_id` everywhere) rather than the database level.

### Why no microservices

Basis runs on a Raspberry Pi. The whole app is one Fastify process, one
worker process, Postgres, Redis. Anything else is overhead.

---

## 10. FAQ / Troubleshooting (page: /docs/faq)

### Why is it called Basis?

The household OS that everything else builds on top of. "Basis" — as in
"on a daily basis" and "the basis of." It's also short.

### Is this like Home Assistant?

No. Home Assistant manages your smart-home devices. Basis manages your
household's logistics — calendars, recipes, chores, inventory, lists, files.
The two pair nicely (Basis has a Smart Home feature flag for integration
later) but they don't overlap.

### Is this like Nextcloud?

Closer, but different focus. Nextcloud is a general-purpose self-hosted
cloud — files, calendar, contacts, dozens of apps in a plugin model. Basis
is opinionated about being a household app: it ships with meal planning,
chore charts, and shopping integration, and it doesn't try to be email
or office productivity.

### Can I move my data later?

Yes. Use the backup feature to export a `.sql.gz` of your database; the
uploaded files live under `/opt/basis/data/storage/`. Both are portable to
another Basis install.

### What happens if I lose the host?

You restore from your last backup on a new install. If you've kept off-site
backups (highly recommended), you lose only whatever was between the last
backup and the failure.

### Does Basis upload my data anywhere?

No. The only network traffic Basis initiates by default:

- Subscribed external calendars (Google, Outlook) when you've added them
- Recipe URL imports when you paste one
- The GitHub Releases API when you check for updates

Everything else stays on your hardware.

### Can multiple households share one Basis install?

The data model supports it (multi-tenant via household_id) but the install
script and update flow assume one household per host. Multi-household is
on the roadmap as a separate deployment mode.

### The frontend bundle is huge (~2 MB). Why?

Pre-1.0 priority is feature completeness, not bundle size. Code-splitting
is a planned optimization.

### Why does the in-UI terminal exist?

So you never need to SSH into your server. It's gated behind the admin role
+ requires the host user's sudo password for privileged commands — same
trust model as SSH. If you're worried about it, set a strong host password
and don't share admin credentials.

### Updates broke my install. What now?

The previous version is still at `/opt/basis/versions/<previous>/`. Roll
back:

```bash
sudo ln -sfn versions/<previous> /opt/basis/current
sudo systemctl restart basis basis-worker
```

If the update ran migrations, also restore the pre-update snapshot the updater
left in `/opt/basis/data/backups/` (see the Backups → Restore steps). Then file
an issue: github.com/Springdale-Robotics/basis/issues.

---

## 11. Security & privacy notes (page: /security)

**Threat model:** household-scale self-hosted app. The expected admin is the
person installing it; the expected users are people they live with.
Basis is not designed for use by people who are adversarial to each other.

### What lives where

- **Database**: per-household data — events, recipes, tasks, lists,
  inventory, user records (with argon2-hashed passwords), session tokens.
- **File storage**: uploaded photos, videos, files.
- **`.env`**: secrets (DB password, session secret, encryption key). 600
  permissions, owned by the `basis` system user.
- **GitHub**: only what you push (code changes, if any).
- **Cloudflare / Tailscale**: traffic metadata if you use them for remote
  access (their respective privacy policies apply). Basis itself doesn't
  send anything to them.

### Authentication

- Cookie sessions, signed with `SESSION_SECRET`. 7-day default expiry.
- Passwords hashed with argon2id at the standard parameters.
- App passwords for CalDAV — scoped per-device, revocable, never give
  access to mint other app passwords.

### Update integrity

Updates pull tarballs from GitHub Releases over HTTPS. The release workflow
publishes a SHA-256 sum alongside each tarball, and the in-UI updater verifies
it before extraction — a checksum mismatch, or a missing sum, aborts the update
before any code is installed. Before running migrations the updater also takes a
pre-update database snapshot to `/opt/basis/data/backups/`, so a rollback can
restore the old schema as well as the old code.

### Reporting a vulnerability

Email [TBD] or open a GitHub Security Advisory at
github.com/Springdale-Robotics/basis/security/advisories/new.

---

## 12. Roadmap (page: /roadmap)

In rough priority order. Subject to change.

### Soon (next few releases)

- Restore-from-backup via UI (drops + recreates DB, restarts service)
- Off-site backup destinations (S3, B2, rclone)
- Backup scheduler (configurable cron + retention)
- One-click rollback to previous version
- Frontend bundle code-splitting
- Real lint configs + green CI on lint as well

### Mid-term

- Raspberry Pi SD card image
- Docker image that includes the frontend
- macOS Homebrew install path with `brew services` instead of systemd
- Linux distro packages (apt repo for unattended-upgrades story)
- Multi-host deployment (DB on one box, app on another)
- "Connect another household" — read-only cross-household sharing (e.g.,
  see grandparents' calendar)

### Long-term

- AI features: meal suggestions based on inventory, summarization of
  household activity
- Public family-facing pages (read-only menus, "what's for dinner this
  week")
- Plugin model — third-party features added to the household

### Explicitly not planned

- Email server / IMAP / SMTP (use a real email provider)
- Office productivity (use Office / Google / Apple)
- A general-purpose smart-home replacement (use Home Assistant)

---

## 13. Changelog (page: /changelog)

Pulled automatically from
[GitHub Releases](https://github.com/Springdale-Robotics/basis/releases).
Use the GitHub API or fetch the RSS feed and render server-side at build
time.

---

## 14. Contributing (page: /docs/contributing)

Basis is MIT-licensed and open to contributions. The codebase is on GitHub:
github.com/Springdale-Robotics/basis.

### Setup

```bash
git clone https://github.com/Springdale-Robotics/basis
cd basis
./dev.sh start   # starts Postgres + Redis in Docker, backend + frontend native
```

Backend at `http://localhost:3000`, frontend at `http://localhost:5173`.

### Workflow

- File an issue first for non-trivial changes — keeps work from being
  duplicated.
- One feature per PR. Smaller PRs get reviewed faster.
- Lint configs are TODO; in the meantime, match the surrounding style.
- Run `./dev.sh test` before opening a PR.

### Code of conduct

Be decent to each other. The household-scale assumption applies to the
project too.

---

## 15. About (page: /about)

[Fill in: who you are, why you built Basis, how to contact you.]

---

## 16. Assets needed for the site

Things you'll want graphic/visual help with:

- **Logo / wordmark** — "Basis" in a confident sans-serif. Maybe an
  abstract mark (a foundation block?). Keep it simple — household app, not
  enterprise.
- **Favicon** + Apple touch icon (192px, 512px, maskable).
- **Open Graph / Twitter card image** (1200×630). Tagline over a screenshot.
- **Screenshots** (in this priority order):
  - Dashboard
  - Calendar (week view)
  - Recipe + cook mode
  - Tasks/chores assignment
  - Meal plan
  - Settings → Remote Access (showcases the white-glove install story)
  - Settings → Updates (showcases the operations story)
- **Short demo video / GIF** (~30s): tap through dashboard → calendar →
  recipe import → cook mode → mark a chore done. Helps the homepage way
  more than copy.
- **Architecture diagram** — for the /docs/architecture page. Boxes for
  Backend / Frontend / Postgres / Redis / optional Cloudflare/Tailscale.

---

## 17. SEO / meta

### Per-page metadata

```html
<title>Basis — Self-hosted household app</title>
<meta name="description" content="Calendar, recipes, chores, photos, files. Self-hosted. One install command, then UI for everything else. MIT-licensed.">
<meta property="og:title" content="Basis">
<meta property="og:description" content="The household OS that lives in your closet.">
<meta property="og:image" content="https://basis.app/og.png">
<meta name="twitter:card" content="summary_large_image">
```

### Page-specific

- `/` — focus on the tagline + install one-liner. Keywords: "self-hosted
  household app", "open source family calendar", "household management".
- `/docs/*` — focus on the specific task. Long-tail SEO from "install
  homemanager" style queries.
- `/changelog` — set `noindex` to avoid splitting PageRank across version
  pages.

### Robots / sitemap

Generate a sitemap.xml at build time including all `/docs/*` paths.
Robots.txt allowing everything except `/changelog/*`.

---

## 18. Footer content (every page)

- Copyright Springdale Robotics 2026
- Link to GitHub (github.com/Springdale-Robotics/basis)
- Link to /security
- Link to MIT license
- Maybe a Discord / community link when one exists
- "Built with Basis" link to the site itself (cheeky)

---

## 19. Suggested tech stack for the site

You want fast static pages + readable Markdown docs. Options ranked by
fit-for-purpose:

1. **Astro Starlight** — Built specifically for docs sites. Markdown
   first-class. Good defaults. Easy to add a homepage that isn't docs.
2. **VitePress** — Vue-flavored. Smaller, simpler, very fast.
3. **Docusaurus** — Heavier. Built by Meta. Big ecosystem.
4. **Nextra** — Next.js-flavored. Good if you want React for the homepage.

Any of these gives you syntax-highlighted code blocks, a sidebar nav, and
search out of the box. All are free.

---

## 20. Launch checklist

When you're ready to send people to the site:

- [ ] Logo + favicon + OG image
- [ ] At least 4 screenshots taken from a real install (not the dev seed
      data — fresh, demo household)
- [ ] All `/docs/*` pages reviewed end-to-end
- [ ] Install one-liner tested on a fresh Ubuntu VM
- [ ] Cloudflare / Tailscale flows tested end-to-end
- [ ] /security page reviewed by someone who isn't the author
- [ ] About page filled in
- [ ] Discord / community link decided
- [ ] Email for security reports decided
- [ ] DNS for basis.app (or whatever domain) pointed at the site
- [ ] HTTPS cert issued
- [ ] Repo description points at the site

When `v0.2.0` (or whatever's next) ships, share on:

- r/selfhosted
- Hacker News (Show HN)
- Lobste.rs
- Tildes
- The relevant Mastodon/Bluesky communities

---

*This document was generated alongside the codebase. Update sections in
place as features land or change. Worth re-reading before each release to
catch drift.*
