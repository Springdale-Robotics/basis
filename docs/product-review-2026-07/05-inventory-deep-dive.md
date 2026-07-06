# Inventory System — Deep Dive (July 2026)

> You said inventory is the system you understand and trust least. This document exists to
> make it fully legible and to catalogue every reliability risk. It is longer and more
> internal than the other reviews on purpose. The lighter usability pass is in
> `02-reviews/06-inventory.md`.

All paths relative to repo root. Line numbers verified against `main` (clean, 2026-07-05).

## TL;DR — why it feels untrustworthy

The distrust is well-founded and has concrete causes:

1. **There are five different "total quantity" computations** across the codebase, no shared
   function — so the number you see on a card, the number the expiry worker uses, the
   number the confidence service reports, and the two numbers the shopping generators use
   can all disagree.
2. **The schema promises about twice the product that exists.** Whole tables (`receipt_scans`,
   `custom_units`) and many columns (`pricePerUnit`, `defaultShelfLifeDays`, `internalId`,
   half the shopping-list columns) are dead — read but never written, or written but never
   read. `defaultShelfLifeDays` literally does not default shelf life.
3. **"Basic mode" is a frontend costume.** The backend is always in advanced/tranche mode;
   basic mode just hides columns — and to store an expiry date in basic mode it fabricates a
   phantom "quantity 1" stock tranche that becomes visible if you ever switch to advanced.
4. **`needsConversion` (the "needs conversion" badge) has five writers plus an auto-reconciler**
   and one of them has a bug that makes it flicker on correctly-configured items.
5. **Cross-tenant write holes**: several endpoints let any logged-in user delete or inject
   another household's stock. Combined with the fact that RLS is never actually enabled
   (see the auth review), this is the most serious class of finding in the whole app.

---

## Data model walkthrough

All tables in `backend/src/db/schema/inventory.ts`, all created in the initial migration
(`drizzle/0000_jazzy_rawhide_kid.sql`) — no migration history to explain evolution.

**`inventory_areas`** — storage locations (Fridge/Pantry/…), household-scoped. Carries
`locationType` + nullable `confidenceDecayRate` (falls back to per-type defaults in
`lib/confidence.ts:46-51`). **Deleting an area cascade-deletes all stock in it** (FK
`onDelete: 'cascade'`) — a silent data-loss lever the UI warns about (`InventoryPage.tsx:1698`).

**`inventory_items`** — the *catalog*, not on-hand stock. Notable columns:
- `defaultShelfLifeDays` — stored and displayed but **never used to default an expiry** anywhere.
- `density` (g/cup) for weight↔volume bridging; `quantityUnitSizes` jsonb for per-item container sizes.
- `needsConversion` — a derived flag maintained by ~5 different writers (see State machine).
- `keepInStock` + `minStockQuantity` — low-stock config.
- `barcode`; `internalId` (random `HM-XXXXXX`, generated at create, **no unique constraint, never read** — vestigial).

**`inventory_stock`** — "tranches", one row per acquisition. `quantity` decimal **NOT NULL but no `>= 0` CHECK**; `unit` nullable (null = item default/each); `expiryDate` is a `date`; plus `confidence`, `source`, `pricePerUnit`/`priceCurrency`, `verifiedAt`, `originalQuantity`, `addedAt`. **No `householdId` column** — tenancy is always indirect via `itemId → inventory_items.householdId`, the root cause of several isolation gaps.

**`shopping_list`** — household-scoped, either linked (`itemId`, set-null on item delete) or free-text (`customName`). "At least one present" is enforced only in POST, not the DB; item deletion can leave a row with *neither* (renders name-less). Has both `source` (single) **and** `sources[]` (accumulating array) — deliberate redundancy for a "Mixed" badge, but every reader must do the `sources.length > 0 ? sources : [source]` dance. `isDelta`/`originalFullQuantity`/`confidenceNote`/`recipeId`/`mealPlanId` exist for the v2 generator **but the persisting endpoint never writes them** — only the non-persisting preview computes them.

**`ingredient_aliases`** — directional "alias IS-A canonical item" map. Written only by recipe-import confirm, read only in `ingredient-matching.service.ts`.

**`receipt_scans`** (+ related types) — **completely dead**. No route/service/worker references it. The `receipt_scan_status` enum is dead with it.

**`custom_units`** — household count units. **Also dead**: the unit registry in `lib/units.ts` is entirely static; the "household-expandable" comment describes an unbuilt feature.

**`leftovers`** — standalone tracker (name, source, optional `sourceRecipeId`, `areaId`, `portions`, `preparedAt`, `expiryDate`, `finishedAt` soft-finish). Cleanup worker hard-deletes 30 days after finish.

**Dead enum values:** `stock_source` has 5 values; only `'manual'` is ever written in production. `shopping_list_source.'recipe'` never written. `pricePerUnit` is **read** by the recipe cost-estimate endpoint but **never written** → cost estimates are permanently "insufficient data".

---

## Lifecycle & flows

### 1) Adding an item (Basic vs Advanced)
Tier = `household.settings.inventory.tier` (default `'basic'`). **The backend inventory routes are tier-agnostic** — Basic/Advanced is almost entirely a frontend rendering switch; the only backend read of tier is in `shopping-preview`.
Create paths: `POST /items`, `/items/quick-create`, `/items/batch` (max 50, **no transaction**).
**Basic-mode expiry hack:** the item form has an expiry field; since expiry lives on stock, the frontend fabricates a **quantity-1** tranche to carry the date (`InventoryPage.tsx:738-765`), or overwrites the *first* tranche's expiry when entries exist ("first" = arbitrary array order). Switching to Advanced later surfaces these phantom "1 pieces" tranches as real stock.

### 2) Editing quantity / consuming
- Advanced UI → `POST/PATCH/DELETE /stock`. PATCH writes whatever fields arrive, incl. `itemId`/`areaId` via `...input` spread.
- Ad-hoc consume: `POST /items/:id/deplete` → `depleteTranches` — converts all tranches to the requested unit, plans FIFO **by `addedAt`**, deletes rows at ≤0. Unconvertible tranches silently **skipped** (no shortfall attributed).
- "Verify Stock" → `reconcileItem`: **deletes all tranches, inserts one fresh tranche** at confidence 100 — collapsing multi-area stock into one area, no transaction around delete+insert.
- "Out of stock" → `markOutOfStock` just deletes all tranches (docstring says "sets to 0" — stale).

### 3) Expiry tracking
Dates set manually or via the Basic-mode hack; **`defaultShelfLifeDays` never auto-populates anything**, and batch put-away inserts stock with **no expiry at all**.
Worker `check_expiring` daily 09:00 server time, all households. Window: `expiryDate <= today(UTC)+7d` (worker uses UTC date at one line, re-parses as server-local midnight at another — **mixed time frames**).
**Duplicate-notification protection: none.** No lower bound, no "already notified" marker → every expiring *and every long-expired* tranche produces a fresh notification + WS emit **every day forever** until the row is deleted. Same for low stock and leftovers. WS events `inventory:low_stock`/`expiring` have **no frontend listener** — users only see persisted notifications.

### 4) Leftovers
**There is no cook-flow leftover creation** — creation is exclusively the manual LeftoverForm. Expiry worker: 3-day window, same UTC/local mixing, same daily re-notification. "Use portion" is a client read-modify-write (two taps lose a decrement). Finished leftovers hard-deleted after 30 days; unfinished live forever.

### 5) Cook flow decrementing stock (`POST /recipes/:id/finish`)
- Matching is purely `recipeIngredients.inventoryItemId` (set at import or manual link). **Unlinked ingredients silently skipped** — no warning.
- Quantity = `actualQuantityUsed ?? ingredient.quantity × servingsMultiplier`.
- Runs in a transaction with `SELECT ... FOR UPDATE` — **the only locked/transactional depletion path**. FIFO here is **earliest-expiry-first** (`ORDER BY expiryDate ASC, addedAt ASC`) — a *different* FIFO than `depleteTranches`' addedAt-first.
- Per-tranche conversion via `convertWithDensity`; on failure the row is left untouched, `needsConversion` flagged, loop continues → **cook "succeeds" with silently under-deducted inventory** (shortfall only partially reported).

### 6) Low stock → shopping list
**No automatic add exists** — the worker only notifies. Manual paths: the banner's per-item "add" (writes `source:'manual'`, not `'low_stock'`), and `/items/:id/out-of-stock` with `addToShoppingList` (the only writer of `source:'low_stock'`).
Threshold semantics **disagree**: worker requires `minStockQuantity` set and alerts on `total <= min`; `GET /low-stock` defaults missing thresholds to 1 and alerts on `total < min`. An item exactly at threshold: worker notifies, UI doesn't list it.

### 7) Deletion / archival
No soft delete (except leftovers' `finishedAt`). Single item-delete is blocked while recipe links exist (→ RelinkDialog) — **but batch-delete has no such guard**, so the single-delete guard is cosmetic. Area delete cascades stock away. Shopping rows survive item deletion as name-less husks.

---

## State machine & invariants

| Invariant | Enforced? |
|---|---|
| `stock.quantity ≥ 0` | Zod `positive()` on writes; delete-at-≤0 in depletion. **No DB CHECK**; `toFixed(3)` can leave `0.000`/`0.001` dust rows. |
| Stock belongs to caller's household | **Not enforced on create/move** (CRITICAL below). Enforced on PATCH/DELETE via item-subquery. |
| `stock.areaId` household == `stock.itemId` household | **Never enforced** — cross-household (item, area) pairs are constructible, invisible to the area's owner, and pollute confidence math. |
| One stock row per item+area | Not an invariant — repeated put-aways create ever more tranches; only reconcile collapses them. |
| ShoppingList: itemId OR customName | POST-only; PATCH allows nulling both. |
| `needsConversion` reflects reality | Eventually-consistent: recomputed as a **write-on-read side effect of every `GET /items`**; five writers can set it, the GET can immediately overwrite them (flag flapping). |
| Confidence 0–100 | Clamped at compute; DB column unconstrained. |

**Drift vectors:** worker low-stock math differs from the UI's (app and notifications disagree about "low"); `/deplete`, `/reconcile`, `/out-of-stock`, `/check`, `to-inventory`, `put-away` are **unlocked** — a deplete racing a cook-finish plans against stale reads → lost update / resurrected tranches.

---

## Integration map

**Inbound:** recipe cook-finish (locks/depletes stock, flags `needsConversion`); recipe availability (existence-only, ignores qty/unit); recipe cost-estimate (reads `pricePerUnit` — dead); recipe import (fuzzy-matches items, writes aliases); meal-plan shopping v1 persisting (reads stock, writes list); meal-plan shopping v2 preview (confidence-tiered); permission middleware (gates `inventory`/`shopping_list`); cleanup worker (old leftovers).
**Outbound:** worker → notification queue + WS alerts; WS emits (many emit-only); `/linked-recipes` + `/relink` reach into `recipe_ingredients`.
**Image-parse: no inventory touchpoint** (despite `receipt_scans` suggesting one was planned).

---

## Reliability findings

**CRITICAL — Cross-tenant writes via unscoped confidence endpoints.** `POST /items/:id/deplete`, `/reconcile`, `/out-of-stock` (`inventory.routes.ts:1769-1839`) gate only on `requireMember()` and pass `params.id` straight to services that never check `householdId` (`inventory-confidence.service.ts:225-375`). Any logged-in user of household A can **delete all stock of any item in household B** (`markOutOfStock`), replace it (`reconcileItem`, which also accepts an arbitrary `areaId`), or deplete it. `GET /items/:id/confidence` is the matching cross-tenant read. Same class: `POST /items/:id/relink` and `GET /items/:id/linked-recipes` leak/rewrite `recipe_ingredients` across households.

**CRITICAL — `POST /stock` and `PATCH /stock/:id` accept foreign `itemId`/`areaId`.** Create inserts whatever UUIDs the caller sends — no household verification, so a user can inject stock into another household's inventory. PATCH scopes the target row but spreads `...input`, letting a caller re-point their row at a foreign `itemId`. `POST /areas/reorder` updates areas **by id only** — cross-tenant write of any area's `sortOrder`.

**HIGH — Confidence `totalQuantity` sums mixed-unit tranches raw.** `getItemConfidence`/`getInventoryConfidenceMap` do `totalQuantity += parseFloat(quantity)` with **no unit conversion**, then label the sum with `defaultUnit`. 500 g + 1 kg → "501 g". This drives the v2 shopping-list delta subtraction, so Advanced-tier lists under/over-buy whenever tranches are mixed-unit.

**HIGH — v2 inventory subtraction converts without density/sizes.** `applyInventorySubtraction` calls `convert(total, confidence.unit, item.unit)` with **no density and no quantityUnitSizes** (`shopping-list-generation.service.ts:420`), so weight↔volume/container bridges always fail here even when the item has the metadata — then flags `needsConversion`. The next `GET /items` reconcile (which *does* use density/sizes) clears it → **flag flapping**, which plausibly reads as "the system randomly says items need conversion". The v1 generator passes density/sizes correctly; v2 doesn't.

**HIGH — No duplicate-notification suppression in the daily worker.** Every day, every low item, every tranche within (or past, unboundedly) the window, and every expiring leftover generates a new notification. An expired tranche notifies *forever*. Worse: the worker processes all households in one job and `throw`s on first error → BullMQ retries the whole job 3×, **re-notifying households that already succeeded**.

**HIGH — Unlocked read-modify-write depletion paths.** `depleteTranches` reads/plans/writes with no transaction or locks; concurrent cook-finish (locked) or another deplete → lost updates/resurrections. `reconcileItem`'s delete-all-then-insert is non-atomic — a crash between statements silently zeroes an item.

**MEDIUM — Non-atomic multi-statement flows:** `to-inventory`, `put-away` loop, batch create/delete/update, area reorder — none transactional.

**MEDIUM — `quantityUnitSizes` key normalization mismatch (SUSPECTED).** The endpoint stores keys as `input.unit.toLowerCase()` while the conversion engine looks them up by `resolveUnit(unit)` (canonical singular). Saving a size under "bottles"/an alias produces an entry the engine never finds → conversion keeps failing after the user "fixed" it. `sizesEntryWouldCycle` has the same mismatch.

**MEDIUM — Timezone frame mixing** (UTC thresholds vs server-local day counts; confidence zeroes at UTC-midnight of the expiry date). For a US household, "expires today" counts as already-expired in several paths.

**MEDIUM — Two divergent FIFO policies** (cook-finish earliest-expiry-first; `depleteTranches` oldest-addedAt-first, and it evaluates all tranches against `stockEntries[0]`'s area decay regardless of each tranche's actual area). Same user action consumes different tranches depending on the entry point.

**LOW —** write-on-read in `GET /items` (3-query + up-to-2-update reconcile on every list fetch); `GET /expiring` scans all households then filters in JS (`parseInt(days)` → `NaN` → empty rather than error); orphan rows (name-less shopping rows, leaked `activeCookingSessions`, 0.000 tranches).

---

## Confusing design decisions (the distrust, itemized)

1. **Three loosely-coupled models wearing one name** — catalog + tranches + read-time confidence. The single "quantity" badge is a lossy conversion-sum; **five different total-quantity computations exist**, no shared function.
2. **`needsConversion` has five writers + an auto-reconciler** and (via the v2 bug) visibly flickers — nobody can model when the badge appears.
3. **Basic-mode phantom quantity-1 stock** — the data model actively lies in Basic mode, and the lie surfaces on tier upgrade.
4. **Tier is a frontend costume, not a backend mode.**
5. **Dead schema mass** — `receipt_scans`, `custom_units`, 4/5 `stock_source` values, `pricePerUnit` (→ cost estimate silently inert), `internalId`, half the shopping-list columns, emit-only WS events. The schema promises ~2× the product.
6. **`defaultShelfLifeDays` doesn't default shelf life** — it's a label.
7. **Two shopping-list generators** with different aggregation, conversion, and subtraction policies.
8. **`source` vs `sources[]`** with a "meaningful edit adds 'manual'" heuristic — the single `source` column stays stale forever.
9. **Depletion warnings that don't block**; unconvertible tranches under-deduct silently by design.
10. **`markOutOfStock` docstring says "sets to 0", code deletes** — erasing price/expiry history the tranche model implies you keep.

---

## Test coverage

**Tested (pure functions only):** `lib/units.test.ts` (~18 cases, solid) and `lib/confidence.test.ts` (~30 cases, solid — but only the *pure* `planDepletion`, not the DB wrapping around it).
**Untested:** the entire 1,840-line routes module (no tenancy tests — which would have caught every CRITICAL), `inventory-confidence.service.ts` DB layer, cook-finish deduction, both shopping generators + `applyInventorySubtraction`, the worker, and all frontend.
**Riskiest untested paths, in order:** (1) tenancy scoping on every route, (2) cook-finish unit-converting depletion, (3) `applyInventorySubtraction` + confidence totals feeding purchase decisions, (4) shopping check-off remainder math, (5) worker notification dedupe/retry.

---

## If you fix inventory in one sprint, do these

1. **Scope every route to the household** (deplete/reconcile/out-of-stock/confidence/relink/linked-recipes/stock-create/stock-patch/areas-reorder) — or land real RLS. This is the security priority.
2. **One `totalQuantity(item, tranches)` function** used by cards, worker, confidence, and both generators — with density/sizes — deleting the other four implementations. Fixes the mixed-unit sum and the v2 subtraction bug together.
3. **Notification dedupe + floor** in the worker; make it per-household jobs so a retry doesn't re-notify everyone.
4. **Wrap `depleteTranches`/`reconcileItem`/`to-inventory`/`put-away` in transactions** with `FOR UPDATE` (copy the cook-finish pattern).
5. **Delete the dead schema** (`receipt_scans`, `custom_units`, unused columns/enum values) or build it — either way, stop the schema lying about the product. Make `defaultShelfLifeDays` actually default expiry on put-away while you're there.
6. **Kill the Basic-mode phantom tranche** — store an item-level expiry, or make Basic a real backend mode.
