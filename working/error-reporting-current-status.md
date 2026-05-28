# Error reporting — current status

A floating bug button in the app lets any signed-in user submit a bug report. The
backend stores it locally, then a BullMQ worker POSTs it to a Cloudflare Worker
relay which creates a GitHub issue. The relay holds the GitHub PAT so it never
ships to a tester's machine.

## Architecture

```
[ user clicks bug button ]
        │
        ▼
[ React dialog ]
  description + url + console buffer + viewport + screenshot
        │  POST /api/v1/bug-reports
        ▼
[ Backend Fastify route ]
  inserts row into bug_reports (status=pending)
  enqueues BullMQ job
        │
        ▼
[ Backend BullMQ worker ]
  POST → BUG_REPORT_WEBHOOK_URL
  retries: 5 attempts, exponential backoff starting at 30s
        │
        ▼
[ Cloudflare Worker relay ]  (worker/bug-report-relay/)
  validates x-bug-report-secret
  formats markdown body
  POST → GitHub Issues API with stored PAT
        │
        ▼
[ GitHub Issue ]  on sam-dashboard/homemanager-bugs (configurable)
```

## What's where

| Layer | Files |
|---|---|
| DB schema | `backend/src/db/schema/bug-reports.ts` (`bug_reports` table + `bug_report_status` enum) |
| DB migration | `backend/scripts/create-bug-reports-schema.sql` (already applied to dev) |
| API routes | `backend/src/modules/bug-reports/bug-reports.routes.ts` — POST (auth) + list/retry/delete (admin) |
| Queue + worker | `backend/src/jobs/index.ts` (`bugReportQueue`, `queueBugReportDelivery`) + `backend/src/jobs/bug-report.worker.ts` |
| App version helper | `backend/src/lib/app-version.ts` |
| Backend env | `BUG_REPORT_WEBHOOK_URL`, `BUG_REPORT_WEBHOOK_SECRET` (both optional; configured in `backend/src/config/index.ts` + `dev.sh`) |
| Cloudflare Worker | `worker/bug-report-relay/` — `src/index.ts`, `wrangler.toml`, `README.md` |
| Frontend console buffer | `frontend/src/lib/consoleBuffer.ts` (installed first in `main.tsx`) |
| Frontend API client | `frontend/src/api/bug-reports.ts` |
| Floating button + dialog | `frontend/src/components/shared/BugReportButton.tsx` (lazy-loads `html2canvas`, draggable, position persisted to `localStorage`); mounted in `AppShell.tsx` |
| Admin settings page | `frontend/src/pages/settings/BugReportsSettingsPage.tsx` — table with status, GitHub link, retry/delete; wired in `SettingsPage.tsx` + `lib/constants.ts` (`SETTINGS_NAV` + `ADMIN_ONLY_SETTINGS`) |

## Status: ready to deploy, requires three actions

1. **Create the bugs repo on GitHub.** Default: `sam-dashboard/homemanager-bugs`.
   Change `GITHUB_REPO` in `worker/bug-report-relay/wrangler.toml` if you want a
   different name/owner.

2. **Deploy the Worker.**
   ```bash
   cd worker/bug-report-relay
   npm install
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN       # fine-grained PAT, Issues: read+write
   npx wrangler secret put SHARED_SECRET      # `openssl rand -hex 32`
   npx wrangler deploy
   ```
   Wrangler prints the deployed URL like `https://homemanager-bug-relay.<account>.workers.dev`.

3. **Configure each deployment's `backend/.env`:**
   ```
   BUG_REPORT_WEBHOOK_URL=https://homemanager-bug-relay.<account>.workers.dev
   BUG_REPORT_WEBHOOK_SECRET=<same value as SHARED_SECRET>
   ```
   Then restart the backend.

Without these set, reports still save locally with `status=pending` (no retry
attempts burned) and admins can retry them from `/settings/bug-reports` once
the relay is configured.

## Known limitations / follow-ups

- **Screenshots are not transferred to GitHub.** The Worker drops them with a
  note in the issue body. GitHub issue bodies cap around 65 KB and a realistic
  JPEG screenshot blows past that. The screenshot stays in the deployment's
  local DB and the admin can view it from `/settings/bug-reports`.
  - To fix: have the Worker upload screenshots to Cloudflare R2 (free tier) or
    Imgur, then embed the URL in the issue body.
- **The `SHARED_SECRET` is not real auth.** It only blocks casual crawlers —
  anyone who exfiltrates a tester's `.env` can spoof reports. Rotate by
  re-running `wrangler secret put SHARED_SECRET` and updating deployments.
- **Drizzle-kit push is broken on this codebase pre-existing.** New schema was
  applied via hand-rolled SQL in `backend/scripts/create-bug-reports-schema.sql`
  (matches the pattern set by `reset-tasks-schema.sql`). For production
  installs, run that SQL against the target database.
- **Backend typecheck has ~1141 pre-existing errors** (1144 on main before this
  work — net negative). None of my new files add new errors beyond the
  codebase's existing broken Drizzle typing pattern.
- **The running dev backend may need a restart** to pick up the new routes —
  `./dev.sh restart` (or kill the tsx watch process and rerun).
- **No drag handle on mobile yet.** The button uses pointer events so it works
  on touch, but the click-vs-drag heuristic is simple (4px threshold). If
  testers find the button hard to dismiss/move on phones, revisit.

## How a report looks once delivered

GitHub issue title: `[<HouseholdName>] <first 80 chars of description>`

Body:
- `## Description` — user's text
- `## Context` — household name + UUID, user name + email, page URL, app version,
  viewport, user agent, submitted timestamp
- `## Screenshot` (only if one was captured) — note that screenshot exists
  locally with size
- `<details>` collapsible block with the last 100 console-log entries
  (console.log/info/warn/error + window.onerror + unhandledrejection)

Labels: `bug-report`, `app:<version>`.
