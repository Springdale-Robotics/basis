# Fix Log — July 2026 Product Review Remediation

Branch: `fix/product-review-remediation`. One line per finding: `[done|skipped|blocked] <area> <desc> — <sha/reason>`.

## P0

- [done] inventory: cross-tenant write/read holes (deplete, reconcile, out-of-stock, confidence, stock create/patch, relink, linked-recipes, areas/reorder) — 073087d; household scoping in service + routes, 9 tenancy tests, new shared route-test harness `test/helpers/route-harness.ts`
- [done] permissions: update/delete scoped to (id, resourceType, resourceId) instead of id alone — cb6c83d; 3 tests
- [done] tasks: completion idempotent (FOR UPDATE + status/same-day guard) + atomic rewards upsert with unique(household_id, user_id) (migration 0005) — 7618c66; 5 tests
- [done] auth: /auth/register removed (invite-only + setup first-admin); fake email password reset removed; admin reset-member-password added (backend + Members UI) — ecb8501; 6 tests
- [done] docs: CLAUDE.md RLS claim corrected (decision: no Postgres RLS this pass) — 3c6651b

## P1

(in progress)
