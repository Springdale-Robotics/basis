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
