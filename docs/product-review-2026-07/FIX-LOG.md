# Fix Log — July 2026 Product Review Remediation

Branch: `fix/product-review-remediation`. One line per finding: `[done|skipped|blocked] <area> <desc> — <sha/reason>`.

## P0

- [done] inventory: cross-tenant write/read holes (deplete, reconcile, out-of-stock, confidence, stock create/patch, relink, linked-recipes, areas/reorder) — household scoping in service + routes, 9 route-level tenancy tests in `test/inventory/tenancy.test.ts`, new shared route-test harness `test/helpers/route-harness.ts`
