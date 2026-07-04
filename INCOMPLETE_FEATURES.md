# Incomplete / WIP features

Tracks half-built subsystems that are wired into the codebase but **not
functional**. They are the sole remaining source of `tsc --noEmit` errors in the
backend (107 as of this writing), so the backend typecheck can't be a required
CI gate until each is either completed or removed. None of these run today, so
leaving them in place changes no working behavior — but they should not be
mistaken for finished features.

## 1. Household federation ("connections") — ~68 type errors
- **Backend:** `backend/src/modules/connections/connections.routes.ts` (+ schema
  `backend/src/db/schema/connections.ts`, registered at `/api/v1/connections`).
- **Frontend:** `frontend/src/api/connections.ts`, a Sharing tab in
  `frontend/src/pages/settings/SettingsPage.tsx`, `frontend/src/lib/constants.ts`.
- **Status:** Non-functional. Handlers reference columns that no longer exist on
  the schema (they throw at runtime), and the sharing pipeline it feeds (see #2)
  never runs.
- **Security note (from review):** `connections.ourPrivateKey` and
  `pairingToken` are stored as plaintext; invite-accept has no single-use guard.
  Must be addressed before this ships.
- **To complete:** reconcile routes with the current schema, encrypt secrets at
  rest, make invite-accept single-use/transactional, and wire the sync worker
  (#2). To remove instead: delete the module + its registration + the frontend
  Sharing tab/api.

## 2. Household-to-household sync worker — ~19 type errors
- **Backend:** `backend/src/jobs/sync.worker.ts`, `queueSync()` /
  `SyncJobData` in `backend/src/jobs/index.ts`.
- **Status:** Never scheduled — `queueSync()` has no callers, and the worker is
  schema-drifted (references `fromHouseholdId`/`toHouseholdId`; the
  `shared_resources`/`sync_queue` tables use `householdId`/`sharedWithHouseholdId`
  /`targetHouseholdId`). Sharing a resource writes a `sync_queue` row that
  nothing consumes.
- **To complete:** align with the schema, have `connections` sharing enqueue
  jobs, and make emits reach browsers (the worker→API Redis bridge already
  exists in `backend/src/websocket/index.ts`).

## 3. Inventory alerts worker — ~20 type errors
- **Backend:** `backend/src/jobs/inventory.worker.ts`, `queueInventoryCheck()` /
  `InventoryJobData` in `backend/src/jobs/index.ts`.
- **Status:** Never scheduled (`queueInventoryCheck()` has no callers,
  `scheduleRecurringJobs()` doesn't schedule it) and schema-drifted (reads
  `item.quantity`/`minQuantity`/`expiryDate`, which no longer exist on
  `inventory_items` — stock lives in `inventory_stock`).
- **To complete:** rewrite against the current inventory schema (stock is
  tranche-based in `inventory_stock`), then schedule a recurring check in
  `scheduleRecurringJobs()` and enqueue low-stock/expiry notifications.

## Removed (superseded, not a TODO)
- **JSON per-household backup** (`modules/backup/*`, `jobs/backup.worker.ts`,
  `frontend/src/api/backup.ts`) was removed. It exported empty skeletons and its
  restore was a no-op. It is fully replaced by the full-database pg_dump backup
  with real, atomic restore and a daily schedule under `/api/v1/system/backups`
  (`modules/system/system-backup.{routes,service}.ts`, `jobs/system-backup.worker.ts`).
- The `backups` / `backup_schedules` DB tables are now unused by code but left in
  place (dropping them needs a migration). A future scheduled-backup-config
  feature could reuse `backup_schedules`.

## CI note
Once #1–#3 are completed or removed, add backend `tsc --noEmit` to
`.github/workflows/ci.yml` and make it (plus the existing checks) required in
branch protection.
