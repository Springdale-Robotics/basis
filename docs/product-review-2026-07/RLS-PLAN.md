# RLS Implementation Plan

Decision + rationale: [DECISIONS.md](DECISIONS.md) → "RLS: IN". This is the
staged plan for wiring Postgres row-level security as a defense-in-depth
backstop under the existing application-level `where householdId` checks (which
stay in place).

## The model

- **Two effective roles on one physical connection pool.**
  - The login role (`homemanager` — superuser + table owner in dev; a normal
    owner in prod) **bypasses RLS**. Used for: migrations, background workers,
    backups, and the pre-auth session lookup (which runs before we know the
    household).
  - `basis_rls` — a plain `NOLOGIN` role, not a table owner, no `BYPASSRLS`.
    RLS **applies** to it. Each authenticated request does `SET ROLE basis_rls`
    + sets the `app.household_id` GUC, runs the handler, then resets on release.
- **Policies** read the household from a session GUC:
  `USING (household_id = current_setting('app.household_id', true)::uuid)`.
  The `, true` makes an unset GUC return NULL (row-invisible) rather than error.
  Child tables without a `household_id` column use a join policy through their
  parent (e.g. `inventory_stock.item_id IN (SELECT id FROM inventory_items
  WHERE household_id = ...)`).
- **Why owner-bypass matters:** workers query across all households (the
  expiry/low-stock jobs, backups). They run as the owner and see everything.
  Only request handlers assume `basis_rls` and get filtered.

## Request plumbing (stage 2)

- An `AsyncLocalStorage` holds the request's reserved connection (`sql.reserve()`).
- After `authMiddleware` resolves `request.user`, a step reserves a connection,
  runs `SET ROLE basis_rls; SET app.household_id = <hh>`, and `als.enterWith()`s
  it so the handler's queries use it. Fastify runs a request's hooks+handler in
  one async context, so `enterWith` propagates without a wrapping callback.
- The global `db` becomes a Proxy: if an ALS connection is present, queries run
  on it (RLS-enforced); otherwise they fall back to the base pool (workers,
  startup) — owner, RLS-bypassed.
- `onResponse` + `onError` hooks `RESET ROLE; RESET app.household_id` and
  release the reserved connection exactly once (tracked on `request`).

### Known wrinkles (documented, addressed per-stage)

- **Pre-auth queries** (`resolveSession`) must run on the base pool (no household
  yet) — they do, because they run before the reserve step.
- **Streaming/download endpoints** hold their reserved connection for the whole
  response (including disk streaming). At family scale (small pool, few
  concurrent large streams) this is acceptable for v1; if it bites, release the
  connection right after the DB read and stream without it. Documented, not
  blocking.
- **Nested `db.transaction()`** (recipe cook-finish, the transactions added in
  P2) run on the request's reserved connection — fine, they nest as normal
  transactions on that connection.
- **Deploy prerequisite:** the role-creation migration needs `CREATEROLE`/
  superuser on the migration DB user. Confirm prod's DATABASE_URL user has it,
  or create `basis_rls` out-of-band first. The migration's role creation is
  idempotent (guards on `pg_roles`).

## Stages

- [x] **Stage 1 — prove the DB mechanism (this checkpoint).** Migration creates
  `basis_rls` + grants, enables RLS + policies on `inventory_items` (direct) and
  `inventory_stock` (join policy). A test opens a connection, `SET ROLE
  basis_rls` + `SET app.household_id`, and asserts: same-household rows visible,
  other-household rows invisible, cross-household INSERT blocked by `WITH CHECK`.
  **No app plumbing yet** — the running app connects as owner and is unaffected.
- [x] **Stage 2 — request plumbing (done).** `db` is now a proxy over an
  AsyncLocalStorage-scoped connection. An `onRequest` hook establishes a mutable
  context holder (enterWith only propagates reliably from onRequest, not a
  per-route preHandler); `authMiddleware` reserves a connection, `SET ROLE
  basis_rls` + sets the GUC, and points the holder at it; an `onResponse` hook
  resets + releases it. Two reserved-connection quirks were backfilled so
  drizzle works transparently on it: `.options` (parsers, read at construction)
  and `.begin` (drizzle's `.transaction()` calls it; emulated as BEGIN/COMMIT on
  the pinned connection — the app never nests db.transaction). Verified: the
  /auth/db-context diagnostic reports role=basis_rls + the caller's household,
  no cross-request leak across pool reuse, and the **full suite (241 passing)**
  runs green with every route under the RLS context — including all the
  FOR-UPDATE transaction paths. Dead `rls.middleware.ts` deleted.
- [x] **Stage 3 — policies across the core data tables (done).** Migration
  0008: 30 direct + 18 join policies (49 tables incl. `households` on its own
  id). Full suite green — enabling RLS on the whole data model broke no
  legitimate write (app inserts already set the right household, so `WITH CHECK`
  passes). DB-level proof for a direct table (`tasks`) and a join table
  (`list_items`) in `test/rls/stage3-policies.test.ts`. Deliberate app-level-only
  exclusions (documented in the migration header): user-scoped/personal tables
  (sessions, app_passwords, user_settings, watch_progress, listen_history,
  favorites, ratings, play_queues, play_queue_items), the polymorphic
  `permissions` table (hardened at the app layer in P0), cloud/remote/integration
  tables (may be cross-household by design), ops/system tables (admin+worker
  only), and the dead `receipt_scans`/`custom_units`.
- [x] **Stage 4 — audit (done).** Confirmed the base handle (no request context)
  bypasses RLS and sees all households — so workers, migrations, backups, seed,
  and the pre-auth session lookup are unaffected (the passing worker/backup/
  caldav suites corroborate). Unauthenticated routes (login, setup, register,
  invite-validate) correctly run as the owner. **CalDAV (`/dav`) is now wired
  into RLS too** — the plugin gets the same onRequest holder + onResponse
  release, and basicAuthMiddleware calls enterRlsContext once it resolves the
  household from the app-password (the app-password + user lookups run first on
  the base handle, like the session lookup). Verified: full caldav suite green
  under RLS + a cross-household isolation test. No authenticated surface remains
  app-level-only.
- [x] **Stage 5 — docs (done).** CLAUDE.md now documents the two-layer model and
  that new household-scoped tables need a policy + a `test/rls/` check.

## Follow-ups (post-merge)

- Optional: denormalize `household_id` onto the hottest join-policied child
  tables only if profiling shows RLS subquery overhead (none expected at family
  scale).
- Revisit the user-scoped media tables if they ever need a household backstop.

## Non-goals (for this effort)

- Removing the app-level `where householdId` checks — they stay as the primary
  guard; RLS is the backstop.
- Denormalizing `household_id` onto child tables — using join policies instead;
  revisit only if profiling shows RLS overhead on a hot path.
