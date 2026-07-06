# Area review — Platform & ops

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

- **First-run setup** — `setup/setup.routes.ts` (unauthenticated pre-setup endpoints); wizard `SetupPage.tsx` + `components/setup/*` (household → admin → remote access → complete).
- **Self-update** — `install/install.routes.ts` (host info, installer list, `/version` GitHub release check with semver compare); `installer-commands.ts` (allowlisted PTY commands: `update-self`, tailscale/cloudflared/frpc installers); `install.ws.ts` (admin-only PTY namespace); `GuidedInstallDialog.tsx` (xterm); `deploy/native/post-update-watchdog.sh` (detached health-check + code-only rollback); `deploy/native/install.sh` (versioned dirs, symlink swap, sudoers NOPASSWD for restarts, sharp smoke test).
- **Backups** — `system-backup.service.ts` (gzipped pg_dump `--clean --if-exists`, atomic tmp rename; restore via `psql --single-transaction ON_ERROR_STOP`; `safeFilename` guard; optional `BACKUP_REMOTE_CMD`; prune), worker (daily 02:00, keep 14), `BackupSettingsPage.tsx`.
- **System/health** — `system.routes.ts` (systemd probes, disk, DB size, last backup), `health.routes.ts` (live/ready/detailed/metrics).
- **Tailscale/connect** — `lib/tailscale.ts` (CLI wrapper + test seam), `tailscale-health.worker.ts` (daily log-only), `connect.routes.ts` + `mobileconfig.service.ts` (QR → iOS CalDAV profile), `RemoteAccessSettingsPage.tsx` (1,455 ln).
- **Bug reports** — `bug-reports.routes.ts` → BullMQ worker → Cloudflare Worker relay (holds GitHub PAT); `BugReportButton.tsx`.
- **Devices** — `devices.routes.ts` (CRUD + rules + heartbeat).
- **Cloud (brief)** — `cloud/` control plane + frps relay + Caddy; nightly `deploy/backup.sh`; box-side `lib/basis-remote.ts` supervises frpc.

## Usability findings

1. **Wizard remote-access step is a silent no-op** — `setup.routes.ts:277-291` just echoes the mode back; nothing is saved. A family that picks "Tailscale"/"Cloudflare" believes it's configured; only `basis_remote` gets a follow-up instruction. Other modes get no "finish in Settings → Remote Access" pointer.
2. **Double login after setup** — `POST /setup/admin` sets a session cookie, but the wizard ends with "Go to Login". The new admin signs in twice in their first five minutes.
3. **"Running…" button silently kills the update** — `GuidedInstallDialog.tsx:263-272`: the only visible footer control while running looks like a status indicator but emits `stop` (SIGTERM) with no confirmation. Clicking it mid-`update-self` can abort between `db:migrate` and the symlink swap → migrated DB on old code.
4. **Update failure surfaces as raw shell output + exit code** — actionable detail buried in scrollback (mitigated by watchdog auto-rollback).
5. **Tailscale breakage is invisible to the family** — `tailscale-health.worker.ts:52-77` logs journald warnings only. A household whose CalDAV URL went stale never sees journald. No in-app notification despite a notifications system existing.
6. **Prerelease updates default ON** — `install.routes.ts:100` (`prerelease !== 'false'`). Fine while everything is `-alpha`; the default will push alpha builds at families once stable releases exist.
7. **Good:** BackupSettingsPage's destructive-restore copy; the iOS connect landing page with reusable-within-TTL token; pg_dump-missing preflight with a copy-pasteable apt command; the human bug-report toast. Non-admin submitters can't see their report's status afterward (minor).

## Reliability findings

1. **HIGH — `update-self` resolves the release differently from the update check.** `installer-commands.ts:101-104` greps the *first* `basis-*.tar.gz` (`head -1`), trusting GitHub array order and ignoring both semver and the UI's prerelease toggle — while `install.routes.ts:33-38` explicitly sorts by semver *because* "Don't trust GitHub's array order". The button can say "Update to v0.1.14" and install a different tarball. No downgrade guard in the script.
2. **MEDIUM — unbounded `/opt/basis/versions` growth.** Neither the staging code nor `install.sh` prunes old version dirs; each carries a full `node_modules`. On small appliance boxes, updates eventually fill the disk — which then breaks backups and pg.
3. **MEDIUM — restore runs against a live, serving app.** `--clean` drops stream through one transaction while the backend pool stays open and workers keep writing: DROP TABLE queues behind live queries (long lock waits inside the HTTP request), concurrent writes are lost, BullMQ jobs reference vanished rows, and the synchronous request can hit proxy timeouts. No maintenance mode / worker pause / `pg_terminate_backend`.
4. **MEDIUM — backups are DB-only and unverified.** Uploaded media under `STORAGE_PATH` is never backed up locally — only *exposed* to an optional `BACKUP_REMOTE_CMD` (no UI, lives in `.env`). No encryption, no restore-verification (not even `gzip -t`), offsite opt-in-by-hand. For family photos this is the actual data-loss surface.
5. **MEDIUM — pre-update rollback snapshots share retention with nightly backups** (`pre-update-*.sql.gz` in the same dir/suffix that `pruneBackups(14)` trims by recency). The documented rollback point silently ages out in ≤14 days; a burst of updates crowds out nightly backups.
6. **MEDIUM — devices rules ignore tenancy** — `GET /:id/rules` reads rules for any device ID with no household check; `DELETE .../rules/:ruleId` deletes any rule by id alone.
7. **MEDIUM — `/health/ready` 503s when the *optional* CRF parser is down** (`health.routes.ts:53-63`), but `install.sh` treats the parser as degradable. Any monitor using `/ready` reports the box unhealthy over a cosmetic sidecar. (The watchdog correctly uses `/live`.)
8. **LOW — watchdog rollback is code-only and self-admittedly untested**; its `/health/live` probe can't detect a boots-but-broken migration.
9. **LOW — disconnect-implies-success heuristic** — any non-client disconnect during `update-self` renders as success; a backend crash mid-update (OOM during `npm ci` on 1–2 GB boxes) shows "Install completed".
10. **LOW — setup TOCTOU + missing timezone** — concurrent `POST /setup/household` both pass the exists-check; the wizard household is created without `timezone` (unlike the one-step path). SUSPECTED downstream calendar/reminder oddities.
11. **LOW — cloudflared installed without checksum verification** while frpc and update-self verify sha256 — inconsistent.
12. **LOW — dead code**: `system.routes.ts:163` `process.uptime() * 0 + …` makes `systemUptimeSec` a duplicate of `backendUptimeSec`.
13. **LOW/SUSPECTED — PII in bug relay**: user email + household name shipped to GitHub issues; fine while the repo is private, a leak the day it isn't.
14. **Cloud (brief):** architecture sound (frps `Wants=` not `Requires=`; nightly `-Fc` dumps keep 14; box-side frpc capped backoff, keeps running when `suspended` with relay as enforcement point). Nothing alarming at skim depth.

## Test coverage

- **In-scope backend routes/workers: zero tests** (setup, install incl. the allowlist/`buildArgv`, system, system-backup incl. `safeFilename`/`runPgDump`/`runPgRestore`/`pruneBackups`, health, bug-reports, devices, connect, cleanup).
- **Tested (lib only):** `tailscale.test.ts`, `basis-remote.test.ts`, `basis-cloud.test.ts`, `semver.test.ts` (which is why `/version`'s compare is trustworthy while the shell updater's grep is not), + caldav.
- **Shell:** `update-self` (a 130-line bash program in a TS template literal), `post-update-watchdog.sh`, both `install.sh` variants — no tests despite the watchdog exposing env seams for a harness.
- **Frontend:** zero. GuidedInstallDialog state machine (trickiest client code in scope) untested.
- **Cloud:** best-covered — 6 suites.

## Top 5 recommendations

1. **Unify release resolution for `update-self`** — pass the semver-resolved tarball URL from `/version` into the update, keep the checksum step, add an in-script downgrade guard. Closes the highest-impact gap (installing a different version than promised).
2. **Add disk hygiene + snapshot separation to the update path** — prune `/opt/basis/versions` to the last 2–3 post-watchdog-success; write `pre-update-*` snapshots to a dir/suffix excluded from `pruneBackups` with their own retention.
3. **Close the family data-loss gap in backups** — include `STORAGE_PATH` media (tar alongside the dump, or a loud UI warning that photos aren't backed up), add `gunzip -t`/scratch-DB restore verification, surface off-site config in the UI.
4. **Fix the small correctness bugs** — household-scope device rules; drop the CRF parser from `/health/ready`; persist (or clearly defer) the wizard's remote-access choice with a "finish in Settings" nudge for all non-local modes; auto-login after setup.
5. **Buy tests where the blast radius is** — setup idempotency/races, backup `safeFilename`/restore error paths, a bats test for the watchdog using its env seams, a CI `bash -n` on the extracted `update-self` script, and a GuidedInstallDialog state-machine test.
