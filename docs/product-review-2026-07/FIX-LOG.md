# Fix Log — July 2026 Product Review Remediation

Branch: `fix/product-review-remediation`. One line per finding: `[done|skipped|blocked] <area> <desc> — <sha/reason>`.

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
- [done] caldav: sync-collection sync-token inside multistatus (RFC 6578) + XML-parsing test — (see log)
- [done] calendar: timezone-aware recurrence expansion + exact-instant EXDATE/exception matching — 8 unit tests
- [done] calendar: reminder overhaul (per-occurrence recurring, stale skip, per-user CalDAV VALARMs) — 3 tests
- [done] calendar: pull sync non-destructive (window-scoped deletes) + no-op update skip; synced calendars read-only (migration 0006) — 6 tests
- [done] calendar: exception-row scope anchoring to master; exception upsert (no more drag 409) — 5 tests
- [done] calendar FE: location sent on create; 'all' scope applies time deltas
