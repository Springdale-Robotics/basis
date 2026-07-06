# Fix Log — July 2026 Product Review Remediation

Branch: `fix/product-review-remediation` (off `main`, linear history, unmerged).
One line per finding: `[done|skipped|blocked] <area> <desc> — <sha/reason>`.

---

## SUMMARY

**Status: P0 + P1 complete and verified; P2 substantially complete (incl. the
platform HIGH #1 update-resolution fix).** Backend test suite grew from 119
passing (review baseline) to **233 passing / 10 skipped** (the skips are the
pre-existing CRF tests needing the Python sidecar). Backend `typecheck` + `lint` clean (0 errors; 119 pre-existing
warnings, none in new code). Frontend `tsc` clean. Two hand-authored migrations
(0005 rewards-unique, 0006 synced-calendars-readonly) applied to the dev DB.

### Fixed and verified (safe to merge after your review)

Every item below has a test that fails without the fix (or, for pure wiring/UI,
a typecheck + the behavior traced end-to-end). Highlights:

- **All flagged cross-tenant holes closed** with route-level denial tests:
  inventory (8 routes), permissions mutation scoping, lists item routes, recipe
  cook-sessions, media album/genre/listen, device rules. New shared
  session-cookie route-test harness (`backend/test/helpers/route-harness.ts`)
  makes these cheap to write.
- **Task completion** idempotent + atomic rewards (unique constraint, upsert).
- **`/auth/register` closed** (invite-only), **fake password reset replaced**
  with an admin action (backend + Members UI + honest forgot-password page).
- **Offline lists** replay-safe (explicit target state, race-safe claim, 5xx
  transient classification).
- **WebSocket** task:completed and other emit-only events now wired, guarded by
  a contract test.
- **Recipe cook flow** scales deductions and reaches the cooked state.
- **Inventory** notification spam fixed; one shared conversion-aware total.
- **Calendar**: timezone-aware recurrence, reminder overhaul, non-destructive
  external sync, exception-scope fixes, malformed sync XML.
- **Media**: scanner FK bug, range-request hardening (416/suffix/streaming),
  bulk + album + music permission/tenancy scoping.
- **Transactions** wrapped around the multi-statement writes (cook-finish
  pattern).

### Awaiting your review (decisions logged in DECISIONS.md)

- **RLS: left out this pass** per your pre-made call — replaced with explicit
  household checks + tests, and CLAUDE.md corrected. The architectural in/out
  call is still yours.
- Small autonomous calls (permission gate on inventory confidence routes; 404
  vs 403 for tenancy; admin-reset UX) — all in DECISIONS.md.

### Still open (deliberately not done — see "Left for you" and P3)

- **Version-dir pruning** (platform MEDIUM #2): belongs in `post-update-watchdog.sh`
  (prune only *after* the watchdog confirms the new version is healthy, so the
  rollback target survives), which runs only on the box and can't be exercised
  here. The release-resolution HIGH #1 it was paired with is now DONE.
- **Video transcoding / HLS, HEIC conversion** — explicitly your call (net-new).
- **Backup media inclusion + restore verification + maintenance-mode restore**
  (platform MEDIUM #3, #4) — touches the backup/restore path that runs on the
  box; left for you.
- **Dead inventory schema deletion**, the **AI roadmap** — per your instructions.
- Numerous MEDIUM/LOW usability items (touch drag-and-drop, virtualized photo
  grid, reminder/attendee UI, upload chunking, etc.) — not correctness bugs;
  left for a UX pass.

---

## P0

- [done] inventory: cross-tenant write/read holes (deplete, reconcile, out-of-stock, confidence, stock create/patch, relink, linked-recipes, areas/reorder) — 073087d; household scoping in service + routes, 9 tenancy tests, new shared route-test harness `test/helpers/route-harness.ts`
- [done] permissions: update/delete scoped to (id, resourceType, resourceId) instead of id alone — cb6c83d; 3 tests
- [done] tasks: completion idempotent (FOR UPDATE + status/same-day guard) + atomic rewards upsert with unique(household_id, user_id) (migration 0005) — 7618c66; 5 tests
- [done] auth: /auth/register removed (invite-only + setup first-admin); fake email password reset removed; admin reset-member-password added (backend + Members UI) — ecb8501; 6 tests
- [done] docs: CLAUDE.md RLS claim corrected (decision: no Postgres RLS this pass) — 3c6651b

## P1

- [done] lists: toggle → explicit target state end-to-end; wishlist claim → guarded conditional UPDATE (409 on race); offline drain classifies 5xx as transient w/ 30s retry; subtask cascade on delete; claim-mask on PATCH/toggle responses; handler-level household checks — 853e486; 7 tests
- [done] websocket: task:completed/assigned/reward:earned + other emit-only events now have listeners; event-contract test prevents recurrence — 8b7f5ac; 32 tests
- [done] recipes: cook flow wired end-to-end (scaler → cook mode → finish deduction at Nx; mealPlanId → cookedAt); /cook + /cooking/:id household-scoped — adeb74c; 4 tests
- [done] inventory: worker notification dedupe (weekly low-stock, per-tranche-per-urgency expiry, -7d floor) + per-household error isolation; single sumStock() total computation (fixes "501 g" confidence bug + v2 subtraction density/sizes + flag flapping) — 4306472; 9 tests
- [done] caldav: sync-collection sync-token inside multistatus (RFC 6578) + XML-parsing test
- [done] calendar: timezone-aware recurrence expansion + exact-instant EXDATE/exception matching — 8 unit tests
- [done] calendar: reminder overhaul (per-occurrence recurring, stale skip, per-user CalDAV VALARMs) — 3 tests
- [done] calendar: pull sync non-destructive (window-scoped deletes) + no-op update skip; synced calendars read-only (migration 0006) — 6 tests
- [done] calendar: exception-row scope anchoring to master; exception upsert (no more drag 409) — 5 tests
- [done] calendar FE: location sent on create; 'all' scope applies time deltas

## P2

- [done] transactions: deplete (FOR UPDATE) + reconcile (atomic delete+insert) + shopping to-inventory/put-away + lists duplicate + lists/areas reorder + invite acceptance (conditional claim) — depletion concurrency test
- [done] media: scanner FK bug (uploadedBy → admin user) + music/musics dir & breakdown-key mismatch; shared RFC 7233 range parser (suffix ranges, 416, streaming download, filename sanitize); bulk delete/move per-file permission checks; album add/remove + music genres/listen household scoping — 6 range tests
- [done] platform: device-rules tenancy (GET/DELETE); /health/ready decoupled from optional CRF sidecar; pre-update rollback snapshots retained separately from nightly (own prune) — device-rules tenancy test
- [done] platform: update-self release resolution unified (shared resolveLatestRelease; buildArgv injects the semver-resolved tarball URL server-side; no-op/downgrade guard) — verified via bash -n + guard logic test + 7 unit tests (platform HIGH #1)
- [skipped] platform: version-dir prune to last 2-3 — belongs in post-update-watchdog.sh (post-success), which runs only on the box; left for review
- [skipped] platform: backup media inclusion + restore verification + maintenance-mode restore — box/deploy backup path; left for review

## P3 (not started — per instructions)

- [skipped] AI roadmap (Stage 0→1), video transcoding/HLS, HEIC conversion, dead inventory schema deletion, RLS wire-in — explicitly left for you
