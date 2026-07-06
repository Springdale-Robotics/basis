# Area review — Inventory (usability pass)

> A separate, deeper technical walkthrough lives in `../05-inventory-deep-dive.md`.
> This is the lighter usability/reliability pass.

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

**Backend**
- `inventory/inventory.routes.ts` (1840 ln, single file): areas CRUD + reorder, items CRUD + quick/batch create/update/delete, per-item container-size ("quantity-weight") conversion with cycle detection, stock CRUD, `/expiring`, `/low-stock`, `/keep-in-stock`, shopping list CRUD + check-off with partial-acquisition/unit-conversion/remainder, `/to-inventory` and batch `/put-away`, leftovers CRUD + `/finish`, and advanced-tier confidence endpoints (`/confidence`, `/deplete`, `/reconcile`, `/out-of-stock`).
- `services/inventory-confidence.service.ts`: tranche confidence (time-decay by location type), FIFO `depleteTranches`, `reconcileItem`, `markOutOfStock`.
- `lib/units.ts` + `unit-conversions.ts`: unit registry, weight↔volume via density, count units via per-item `quantityUnitSizes`.
- `jobs/inventory.worker.ts`: three daily crons (low stock 8AM, expiring 9AM, leftovers 9AM server time) emitting WS alerts + DB notifications.
- Recipe integration: `recipes.routes.ts:824-981` cook-finish deducts stock FIFO in a transaction with `SELECT ... FOR UPDATE`.

**Frontend**
- `InventoryPage.tsx` (1803 ln): By Location / All Items / Leftovers tabs, basic-vs-advanced tier (household setting, default basic), fuzzy search, expiring filter, bulk mode, ~10 dialogs.
- `ShoppingListPage.tsx`: category-grouped list, check-off with acquired qty/unit + remainder, Put Away flow, source badges.

## Usability findings

1. **Expiry notifications are noise with no cutoff or dedup** (`inventory.worker.ts:139-173`). Every daily run re-notifies every tranche whose expiry is ≤ 7 days out, no lower bound and no dedup: an item expiring in a week generates 8+ notifications, and after it expires keeps generating "X has expired" **every day forever** until deleted. Per-*tranche*, so 3 milk tranches = 3 notifications the same morning. This trains a family to ignore all notifications.
2. **No fast "log groceries" path outside the shopping list.** The good flow (check off → Put Away → stock created) only works for items that went through the list. Direct restock needs find item → Manage Stock dialog → entry per item, and in basic mode the Manage Stock affordance is hidden entirely (`InventoryPage.tsx:910-937`). Receipt-scan tables exist in the schema with no UI entry point.
3. **Basic-mode expiry editing silently invents stock** (`InventoryPage.tsx:727-766`): setting "Expires On" creates a quantity-1 tranche or overwrites only the first tranche's expiry. Switching to advanced later inherits phantom "1 pieces" tranches.
4. **Leftovers tracking is disconnected from cooking.** Cook-finish never offers "save leftovers" despite `leftovers.sourceRecipeId`. Portion decrement is a client read-modify-write (`InventoryPage.tsx:1572-1581`) — two taps lose a decrement — and expired leftovers keep nagging with no "toss it" quick action.
5. **Low stock → shopping list is manual-only.** `keepInStock` + `minStockQuantity` exist and the worker detects low stock, but nothing auto-adds. The banner requires clicking each item name individually — no "add all".
6. **Mobile ergonomics:** row tap = open edit dialog (accidental edits easy); three fixed `w-[180px]` filters wrap awkwardly on narrow screens; 32px menu triggers below comfortable touch size; shopping-list delete fires immediately with no confirm/undo.
7. **Basic/advanced split is otherwise well done** (basic hides confidence/quantities, defaults sort to expiry). One glitch: `useState(isAdvanced ? 'name-asc' : 'expiry')` (`:142`) captures tier at first render only — SUSPECTED wrong default if settings hydrate after mount.

## Reliability findings

> The most serious findings (cross-tenant writes, non-transactional depletion, worker timezone math) are detailed in the deep dive. Summary here.

1. **HIGH — Cross-tenant writes: several routes never verify household ownership** (`POST /stock`, `/items/:id/reconcile` which *deletes all stock*, `/out-of-stock`, `/deplete`, `/confidence`, `/relink`, `/linked-recipes`). Combined with the fact that RLS is never actually registered (see auth review), application-level `where householdId` is the only isolation and these routes skip it. A destructive cross-tenant surface.
2. **HIGH — `depleteTranches` (ad-hoc route path) has no transaction or locking** (`inventory-confidence.service.ts:225-330`) — two concurrent depletes plan against the same snapshot and double-deduct. The correct pattern (`db.transaction` + `.for('update')`) already exists in cook-finish.
3. **MEDIUM — Multi-step flows lack transactions**: `reconcileItem` (delete-all then insert), `/to-inventory`, `/put-away`, check-off remainder, batch create.
4. **MEDIUM — Check-off destroys the requested quantity on uncheck** (overwrites `quantity`/`unit` with acquired amount; uncheck only flips the flag; `originalFullQuantity` exists but is never written).
5. **MEDIUM — Worker timezone/date math is inconsistent** (7-day threshold as UTC string vs `daysUntilExpiry` parsing server-local midnight); at the 9AM run an item expiring *today* reports "has expired".
6. **LOW — Low-stock semantics disagree between worker (`<=`, requires min set) and API (`<`, defaults min to 1)** → banner and notifications show different sets.
7. **LOW — Unconvertible tranches counted at face value** (masks true low stock); SUSPECTED over/under-deduction for unit-less tranches in cook flow.
8. **LOW — Performance**: `/expiring` scans all households then filters in JS; `/low-stock` and `/keep-in-stock` are N+1; `GET /items` runs a 3-query reconcile pass on every fetch.
9. **LOW — Decrement-below-zero is generally guarded** (deletes tranche at ≤0, `Math.max(0, …)`); cycle detection protects the sizes map.

## Test coverage

**Covered (pure libs only):** `lib/units.test.ts` (18 cases) and `lib/confidence.test.ts` (~35 cases) — both good. **Zero coverage:** all 40+ routes (scoping, check-off/remainder math, put-away, batch), the confidence-service DB layer (deplete/reconcile/concurrency), the worker (date windows, content), the cook-finish transaction, and the entire frontend. The two worst reliability areas (missing scoping, non-transactional depletion) are exactly the untested layers.

## Top 5 recommendations

1. **Close the cross-tenant holes now** — household ownership checks on `POST /stock`, `deplete`, `reconcile`, `out-of-stock`, `confidence`, `relink`, `linked-recipes` (or register real RLS). Priority given prod + a paid multi-tenant cloud.
2. **Add notification dedup and a floor to the expiry/low-stock workers** — notify once per item per state transition, skip items expired > 1 day, collapse per-item not per-tranche. The single biggest "family actually uses it" fix.
3. **Wrap `depleteTranches`, `reconcileItem`, `to-inventory`, `put-away` in transactions**, reusing the `FOR UPDATE` pattern from cook-finish.
4. **Auto-add `keepInStock` items to the shopping list when low** (worker already computes it) + an "Add all" button.
5. **Build a first-class restock flow** — "Add stock" in basic mode, a batch "just shopped" screen, and stop conflating item-form expiry with stock creation; then backfill route tests for check-off and put-away math.
