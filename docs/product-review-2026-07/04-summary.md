# Basis Product Review — Executive Summary (July 2026)

Full feature inventory in `01-feature-inventory.md`; per-area reviews in `02-reviews/`;
local-AI deep dive in `03-ai-deep-dive.md`; inventory deep dive in `05-inventory-deep-dive.md`.

Basis is genuinely ambitious and, in places, well-engineered — the CalDAV server, the
image-parse review-before-commit flow, the confidence/units libraries, the offline lists
layer, the connect-device UX, and the update watchdog all show real care. The problems
cluster in three themes, and they're consistent enough across ten independent reviews that
they read as systemic, not incidental.

## The three systemic themes

### 1. Multi-tenant isolation is not what CLAUDE.md claims — and it leaks
CLAUDE.md advertises "row-level security via `app.household_id`." **It does not exist.**
`setRlsContext` is imported nowhere, no migration creates a policy, and `set_config(...,
true)` would be a no-op on the pooled non-transactional client anyway (auth review). The
*only* isolation is application-level `where householdId` filters — and multiple reviews
found routes that forget them:
- **Inventory (CRITICAL):** `deplete` / `reconcile` / `out-of-stock` / `POST /stock` /
  `relink` / `areas/reorder` let any logged-in user **delete or inject another household's
  stock**. (inventory deep dive)
- **Permissions (HIGH):** update/delete filter on `permissionId` alone — admin on one
  resource can edit/delete any permission row in the DB. (auth)
- **Media (MEDIUM):** album-add and music genres/listen skip household checks; bulk
  delete/move bypass per-file permissions. (media)
- **Devices, calendar linked-recipes, recipe cook-sessions** — same class.

This is the single most important finding. It matters more now because there's a **paid
multi-tenant cloud product** (Basis Remote) and remote access makes these endpoints
internet-reachable. **Recommendation:** decide RLS in or out. If in, wire `setRlsContext`
into per-request transactions + real policies as a DB backstop. Either way, add
household-ownership checks to the specific routes listed and correct CLAUDE.md.

### 2. Almost nothing is transactional, and concurrency corrupts family flows
The app is built for multiple people touching the same data at once, but the write paths
mostly aren't safe for it:
- **Task completion is replayable and re-awards points every click** (CRITICAL, tasks) —
  no status check; a kid can farm rewards; bulk-complete fires N parallel replays.
- **Offline list toggle replays as a *toggle*, not a target state** (HIGH, lists) — phone A
  offline + phone B online → A's reconnect *unchecks* what B checked. The exact two-phones-
  in-a-store scenario.
- **Wishlist claim race** (HIGH, lists) → two relatives both "claim" → duplicate gifts.
- **Inventory depletion is unlocked read-modify-write** (HIGH) → concurrent consume double-
  deducts or resurrects stock.
- **Rewards, invite acceptance, recipe import/edit, list duplicate/reorder, backup restore,
  put-away** — all multi-statement, none transactional. The correct pattern (`db.transaction`
  + `FOR UPDATE`) *exists* in exactly one place (recipe cook-finish) and should be the model.

### 3. Realtime and features silently don't do what the UI says
A recurring "the code claims X, the behavior is Y" pattern that erodes trust:
- **Task completion never reaches other devices** (HIGH) — backend emits `task:completed`,
  frontend listens only for `task:update`. The core "kid checks off chore, parent sees it"
  demo is broken. Many other WS events are emitted with no listener.
- **Password reset tells the user an email was sent; no mailer exists** (CRITICAL, auth) —
  a locked-out family member has no recovery but an admin with DB access.
- **Task-due reminders**: enum, prefs toggle, and worker mapping all exist; **no job ever
  scans task due dates** (HIGH). A dead feature users can "enable."
- **`ENABLE_AI_FEATURES` is dead config**; **local AI is never installed by the installer**
  (AI deep dive) — on a real box, scan just fails.
- **Recurring event reminders fire once (often immediately for past events) and CalDAV
  reminders notify the whole household** (HIGH, calendar).
- **Two-way external calendar sync is one-way with silent clobbering; windowed sync deletes
  events older than 3 months every run** (HIGH, calendar).
- **Cook flow ignores serving scaling** → inventory under-deducted by half at 2× (HIGH,
  recipes); the meal-plan "cooked" state is unreachable.
- **Library scanner has an FK bug that fails every scanned file silently; movies have no
  transcoding so most real rips won't play; HEIC photos likely break tiles** (media).
- **Inventory:** the schema promises ~2× the product (dead tables/columns), five different
  "total quantity" computations disagree, and Basic mode fabricates phantom stock (inventory
  deep dive — this is the concrete source of your low confidence in it).

## Cross-cutting: test coverage is near zero where risk is highest
13 backend test files, all passing (119 passed / 10 skipped — the skips are CRF tests where
the Python sidecar was down). Coverage is concentrated on CalDAV + pure libs (units,
confidence, semver, tailscale). **Zero tests** exist for: auth/permissions/invites, tasks
(completion, rewards, recurrence, the ~660-line parser), lists + the offline layer,
inventory routes (all 40+, including every tenancy hole), recipes routes/import, media/files
entirely, and the entire frontend (no test tooling at all). Every CRITICAL/HIGH above is in
untested code; most would be caught by a thin route-level or pure-function test. This is the
highest-leverage process fix.

## Local AI: real potential, currently unrealized (see `03-ai-deep-dive.md`)
AI today is an input funnel (scan + recipe parsing) that never reads any household data.
The sophisticated local VLM pipeline is effectively dev-only (installer doesn't provision
it). The opportunity: Basis sits on the exact private, permission-scoped dataset a family
assistant needs. The path — off by default throughout — is (0) make the foundation real
(gate the dead flag, ship the installer components, add an AI settings page), (1) "Ask
Basis" read-only Q&A via **permission-scoped tool calling over the existing service layer**,
(2) confirm-gated AI writes reusing the image-parse review pattern, (3) proactive weekly
briefs. The deep dive also covers your two follow-ups: **the "MCP server per feature" idea**
(verdict: build an in-process tool registry over the service layer first; a *single* MCP
gateway later for external clients — not 12 servers; and service-layer hardening is a
prerequisite because AI write tools amplify exactly the tenancy/transaction gaps above),
and **household model-switching + context management** (very feasible — mostly product work:
a hardware-honest model catalog, guided pull, capability-based feature gating, and a
**model-agnostic** context/history store so switches are lossless, with embeddings pinned
separately and re-indexed in the background since vectors don't transfer).

## Recommended priority order

**P0 — correctness/security, do before more features or any paid-cloud growth**
1. Close the inventory cross-tenant write holes; decide RLS in/out and fix CLAUDE.md.
2. Scope permission mutations to the authorized resource.
3. Make task completion idempotent + atomic (transaction, unique rewards constraint).
4. Fix or remove password reset (an admin "reset member password" fits a self-hosted box).
5. Close `/auth/register` (open registration → kid self-escalation).

**P1 — the family flows that visibly break**
6. Offline list toggle → explicit target state; wishlist claim → conditional UPDATE; classify
   offline-drain errors by status (stop discarding on 5xx).
7. Fix task-completion websocket sync (one-line-ish) + add the WS event contract test.
8. Wire the recipe cook flow end-to-end (serving scale → deduction → cooked state).
9. Inventory notification dedupe + floor (stop the daily "expired forever" spam) and the
   single-`totalQuantity` refactor.
10. Calendar: recurrence timezone-awareness, exception-scope fixes, reminder overhaul,
    non-destructive external sync, and the malformed sync-collection XML.

**P2 — reliability debt & platform**
11. Transactions across all multi-statement writes (copy the cook-finish pattern).
12. Media: scanner FK bug, streaming range/memory hardening, transcode + HEIC story.
13. Update path: unify release resolution, prune version dirs, separate rollback snapshots,
    include media in backups + verify restores.
14. Stand up frontend testing + backend route tests, starting with the P0/P1 code.

**P3 — the AI opportunity** (after the service layer is safe enough to expose)
15. AI Stage 0 → 1 per `03-ai-deep-dive.md`: gate the flag, ship installer components,
    build the in-process tool registry + "Ask Basis" read-only, all off by default.

## What's genuinely good (keep / build on)
CalDAV server test coverage and connect-device UX; the image-parse review-before-commit
flow (the template for all AI writes); `lib/units` + `lib/confidence` (well-tested pure
cores); the offline-lists architecture (best offline story in the app — just needs the
replay-semantics fixes); the `useNavItems` single-source navigation; the update watchdog's
documented rollback design; the "no silent regex fallback" posture in recipe parsing; and
the honest hardware-expectation UX in the scan dialog.
