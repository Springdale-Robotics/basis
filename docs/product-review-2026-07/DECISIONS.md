# Decisions — July 2026 Review Remediation

Small reversible calls made autonomously during the fix pass, per the fix-prompt decision rule.

## Pre-made (from the fix prompt)

- **RLS**: not wiring Postgres RLS this pass. Explicit household-ownership checks added to every flagged route + tests proving cross-household denial. CLAUDE.md's "row-level security" claim to be corrected to match reality.
- **Password reset**: no SMTP. Admin "reset member password" action instead; fix the misleading "email sent" UI copy.
- **/auth/register**: require a valid invite code; keep first-admin setup.

## Made during the pass

1. **Inventory confidence/deplete/reconcile/out-of-stock routes upgraded from `requireMember()` to `requireInventoryAccess('view'|'edit')`** (2026-07-05). The rest of the inventory module gates on the feature permission; these four bypassing it looked like an oversight, and depleting/zeroing stock is clearly an "edit". Reversible by swapping the preHandler back. Admins are unaffected; members/kids are affected only if their `inventory` feature permission is below `edit`.
2. **Tenancy failures return 404 (`Errors.notFound`), not 403** (2026-07-05). Matches the existing convention in household-scoped queries (e.g. PATCH /items/:id) and avoids confirming a foreign resource exists.
3. **`/items/:id/relink` and `/items/:id/linked-recipes` additionally scope the `recipe_ingredients` join to the caller's household's recipes** — defense in depth in case a foreign recipe was ever linked to a local item by earlier unscoped writes.
4. **Tenancy denial returns 404 for direct id lookups but the lists item routes accept either 403 or 404** (2026-07-06). The lists item routes are fronted by `requireListAccess` (feature permission middleware) which throws 403 before the handler's 404 ownership check runs; both are correct denials, so the test asserts `[403, 404]`. Not worth reworking the middleware ordering for a uniform code.
5. **CalDAV VALARM reminders are owned by the PUTting user, and only that user's rows (plus legacy ownerless rows) are replaced on re-sync** (2026-07-06). A phone syncing its own alarms shouldn't wipe another member's alarms on the same shared event. Legacy ownerless rows get claimed by whoever syncs next — the pragmatic migration path without a data backfill.
6. **Synced (Google/Outlook) calendars set to read-only** (2026-07-06, migration 0006). They advertised two-way sync but no push path exists, so local edits were clobbered on the next pull. Read-only is the honest, reversible state until real push sync ships. Reversible by flipping `is_read_only` and building the push path.
7. **Update-self release-resolution rewrite deferred** (2026-07-06). The highest-impact platform finding (button installs a different tarball than promised) lives in a bash program embedded in a TS template literal that only executes on the prod box; it can't be exercised in this environment and the fix-prompt forbids touching deploys/the box. Did the adjacent low-risk items (snapshot retention). Flagged in FIX-LOG for your attention — recommend passing the semver-resolved URL from `/version` into the updater and keeping the checksum step.
8. **Media scanner attributes scanned files to the household's oldest admin** (2026-07-06). `files.uploaded_by` needs a real user id (the FK is why the old `householdId` value failed); there's no system user, so the oldest admin is the sensible owner. Reversible if a dedicated system user is later introduced.
