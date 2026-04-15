# Inventory & Shopping System — Implementation Plan

**Architecture doc:** `working/todo/inventory-and-shopping-architecture.md`  
**Codebase map:** `working/maps/codebase-map-dfd1906.md`  
**Created:** 2026-04-12

## Status Key

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked / needs decision
- `[—]` Skipped / deferred

---

## Phase 0: Design Decisions (resolve before coding)

All resolved. Decisions documented here for reference.

- [x] **0.1** Canonical storage units: **grams (weight) and cups (volume) internally, display-convert for user.** Density stored as **g/cup** — directly bridges the two base units with no intermediate conversion. User-friendly for experimental measurement ("scoop a cup, weigh it"). Count-to-weight requires user-defined per-item conversions. Null unit treated as implicit "each" for math. See Unit System section below for full unit list.
- [x] **0.2** Ingredient ontology scope: **Equivalences only for v1, directional matching.** "whole milk" IS-A "milk" (alias), but "milk" is NOT "whole milk." Same ingredient at different specificity or form = equivalence. Different ingredient that works in same role = substitution suggestion only. Frozen spinach = spinach is an equivalence. Greek yogurt = sour cream is a substitution.
- [x] **0.3** Shopping list removal behavior: **Prompt on removal with two options.** "I already have this" (weak inventory signal for Tier 1, reconciliation prompt for Tier 2) or "Skipping this item" (just remove, no signal). If user has some-but-not-enough, they edit the quantity on the shopping list instead of removing — the quantity edit screen gets a calculator with unit conversion support. Checked-off items at the store are stored as weak purchase signals for Tier 1 (used for "do you already have this?" prompts and quick-stock onboarding on tier upgrade).
- [x] **0.4** Confidence thresholds: **Hardcode 80/40 for v1.** Make configurable later.
- [x] **0.5** Reconciliation UX: **Per-item only for v1.** "I checked — I have X amount" dialog. Batch-by-location is future work.
- [x] **0.6** Tier toggle: **Household-level setting.** Stored in `HouseholdSettings.inventory.tier`. Everyone in the household sees the same tier.

### Unit System (decided in 0.1)

Three locked categories (users cannot add units) plus expandable count units.

**Household setting:** Users configure which units are enabled for their household. Disabled units still parse during recipe import but are flagged. Defaults marked with `*` below.

**Weight (locked — 8 units, base: grams):**

| Unit | Key | Grams | Default | Aliases |
|---|---|---|---|---|
| milligram | `mg` | 0.001 | * | milligrams |
| gram | `g` | 1 | * | grams, gm, gramme |
| decagram | `dag` | 10 | | dkg |
| hectogram | `hg` | 100 | | |
| kilogram | `kg` | 1000 | * | kilo, kilos |
| ounce | `oz` | 28.3495 | * | ounces |
| pound | `lb` | 453.592 | * | lbs, pounds, # |
| stone | `st` | 6350.29 | | |

**Volume (locked — 18 units, base: cups):**

| Unit | Key | Cups | Default | Aliases |
|---|---|---|---|---|
| milliliter | `mL` | 0.004227 | * | ml, cc |
| centiliter | `cL` | 0.04227 | | cl |
| deciliter | `dL` | 0.4227 | | dl |
| liter | `L` | 4.22675 | * | l, liter, litre |
| teaspoon | `tsp` | 0.02083 | * | t, ts |
| tablespoon | `tbsp` | 0.0625 | * | T, tbs, tbl |
| dessertspoon | `dsp` | 0.05002 | | |
| fluid ounce | `fl oz` | 0.125 | * | floz |
| gill | `gi` | 0.5 | | |
| cup | `cup` | 1 | * | c, C |
| pint | `pt` | 2 | * | pints |
| quart | `qt` | 4 | * | quarts |
| gallon | `gal` | 16 | * | gallons |
| jigger | `jig` | 0.1875 | | |
| metric cup | `metric cup` | 1.057 | | |
| Australian tablespoon | `au tbsp` | 0.08454 | | |
| Japanese cup | `jp cup` | 0.8454 | | |
| Japanese go | `go` | 0.7609 | | |

**Imperial UK (locked — 4 units):**

| Unit | Key | Cups | Default | Aliases |
|---|---|---|---|---|
| imperial fluid ounce | `imp fl oz` | 0.1201 | | |
| imperial pint | `imp pt` | 2.402 | | |
| imperial quart | `imp qt` | 4.804 | | |
| imperial gallon | `imp gal` | 19.215 | | |

**Negligible (locked — skip in all math):**
`to taste`, `pinch`, `dash`, `drop`, `drizzle`, `splash`, `handful`, `smidgen`, `garnish`, `as needed`

**No unit (null):** Represents bare quantities like "2 apples." Internally treated as equivalent to "each" for consolidation/depletion math. Displayed without any unit text.

**Count (built-in + household-expandable):**
each, dozen, piece, slice, portion, serving, can, jar, bottle, bag, box, pack, case, bunch, head, clove, sprig, stalk, stick, strip, fillet, breast, thigh, drumstick, wing, patty, link, ear, bulb, leaf, sheet, block, wedge, scoop, rasher, floret, rib, spear, knob, pat, cube, sachet, tube, pouch, tray

Custom count units: household-scoped. Users create them during recipe import (unknown unit -> "Match existing" or "Create new count unit") or from inventory settings. Custom units become first-class: usable in recipes, with per-item conversions to weight. Without a conversion defined, the unit is unconvertible for that item and the system prompts the user.

**Conversion tiers (priority order):**
1. Same-category standard conversion (cups -> mL, lb -> g) — pure math
2. Per-item conversion table (user-defined: "1 egg = 50g", "1 chicken breast = 170g") — count-to-weight
3. Density-based cross-category (weight <-> volume via `density_g_per_cup`) — flour-in-cups vs flour-in-grams
4. Negligible units — skip entirely

---

## Phase 1: Schema & Data Model Changes

_Goal: Get the database to support the new architecture without breaking existing functionality. All changes are additive — no existing columns removed until migration is verified._

### 1U: Unit System Overhaul

The current `unit-conversions.ts` has a basic set of units. This needs to be expanded to the full locked set and support custom count units.

- [x] **1U.1** Create `units` table (or a comprehensive constants file) for the locked unit registry:
  - `key` (varchar PK — e.g., "g", "cup", "imp pt")
  - `name` (varchar — display name)
  - `category` (enum: `weight`, `volume`, `volume_imperial`, `count`, `negligible`)
  - `base_value` (decimal — grams for weight, mL for volume, null for count/negligible)
  - `aliases` (jsonb — array of alias strings for parsing)
  - `is_default_enabled` (boolean — whether enabled by default for new households)
  - **File:** `backend/src/lib/units.ts` (constants) or `backend/src/db/schema/inventory.ts` (table)
  - _Recommendation: constants file for locked units, DB table only for custom count units_

- [x] **1U.2** Create `custom_units` table for household-defined count units:
  - `id` (uuid PK)
  - `household_id` (uuid FK)
  - `key` (varchar — user-chosen short name, e.g., "tray")
  - `name` (varchar — display name)
  - `aliases` (jsonb — optional alias strings)
  - `created_at` (timestamp)
  - Unique constraint on (household_id, key)
  - **File:** `backend/src/db/schema/inventory.ts`

- [x] **1U.3** Add `enabled_units` field to `HouseholdSettings` interface:
  - `inventory?.enabledUnits?: string[]` (array of unit keys; null = defaults)
  - **File:** `backend/src/db/schema/households.ts`

- [x] **1U.4** Refactor `backend/src/lib/unit-conversions.ts`:
  - Replace hardcoded conversion table with the full unit registry
  - Support all 30 locked units (8 weight + 18 volume + 4 imperial)
  - Handle null unit as implicit "each" in consolidation math
  - Negligible units return `null` from conversion (skip in math)
  - **File:** `backend/src/lib/unit-conversions.ts`

- [x] **1U.5** Refactor `frontend/src/lib/unit-conversions.ts` to match backend changes

- [x] **1U.6** Update `frontend/src/lib/inventory-constants.ts` — expand `unitOptions` and `unitAliases` to match the full set, filtered by household enabled units

- [x] **1U.7** Add unit alias resolution to recipe import parser:
  - Unknown unit during import -> "Match to existing unit" or "Create new count unit"
  - **File:** `backend/src/modules/recipes/recipe-import.service.ts`

- [x] **1U.8** Create migration for `custom_units` table (schema defined in inventory.ts, will apply on next `db push`)

### 1A: Inventory Stock -> Tranches

The current `inventory_stock` table is close to what we need but lacks confidence, source, and price fields.

- [x] **1A.1** Add columns to `inventory_stock` table:
  - `confidence` (integer, 0-100, default 100)
  - `source` (enum: `purchase`, `manual`, `migration`, `implicit_checklist`, `cooking_depletion`)
  - `price_per_unit` (decimal, nullable)
  - `price_currency` (varchar, default 'USD')
  - `verified_at` (timestamp, nullable — last manual verification)
  - `original_quantity` (decimal — quantity at creation, before any depletion)
  - **File:** `backend/src/db/schema/inventory.ts`

- [x] **1A.2** Create Drizzle migration for the stock table changes — applied via `drizzle-kit push --force`

- [x] **1A.3** Backfill existing stock entries — script created at `backend/scripts/backfill-inventory-schema.ts`, runs clean on fresh DB

### 1B: Inventory Areas -> Locations with Decay Rates

The current `inventory_areas` table needs confidence decay metadata.

- [x] **1B.1** Add columns to `inventory_areas`:
  - `location_type` (enum: `pantry`, `fridge`, `freezer`, `other`, default `other`)
  - `confidence_decay_rate` (decimal — percent per day, nullable; if null, derived from `location_type` defaults)
  - **File:** `backend/src/db/schema/inventory.ts`

- [x] **1B.2** Backfill script included in `backend/scripts/backfill-inventory-schema.ts` — guesses location_type from area name

### 1C: Shopping List Enhancements

- [x] **1C.1** Add columns to `shopping_list`:
  - `recipe_id` (uuid FK -> recipes, nullable — which recipe generated this item)
  - `meal_plan_id` (uuid FK -> meal_plans, nullable — which meal plan entry)
  - `confidence_note` (varchar, nullable — e.g., "you may have some — reconcile to update")
  - `is_delta` (boolean, default false — true when quantity represents only the delta needed)
  - `original_full_quantity` (decimal, nullable — the full recipe amount before delta subtraction)
  - **File:** `backend/src/db/schema/inventory.ts`

- [x] **1C.2** Add `recipe` source option to `shopping_list_source` enum (now: `manual`, `meal_plan`, `low_stock`, `recipe`)

- [x] **1C.3** Migration applied via `drizzle-kit push --force`

### 1D: Household Settings for Tier Toggle

- [x] **1D.1** Add to `HouseholdSettings` interface:
  - `inventory?.tier: 'basic' | 'advanced'` (default `'basic'`)
  - `inventory?.confidenceThresholds?: { high: number; medium: number }` (defaults 80/40)
  - `inventory?.enabledUnits?: string[]` (array of unit keys; null = use defaults)
  - **File:** `backend/src/db/schema/households.ts`

### 1E: Ingredient Ontology Table (New)

- [x] **1E.1** Create `ingredient_aliases` table:
  - `id` (uuid PK)
  - `household_id` (uuid FK -> households)
  - `canonical_item_id` (uuid FK -> inventory_items — the "parent" item)
  - `alias_name` (varchar — the alternate name, e.g., "whole milk")
  - `alias_type` (enum: `exact`, `variant`, `brand`)
  - `created_at` (timestamp)
  - **File:** `backend/src/db/schema/inventory.ts`

- [x] **1E.2** Alias matching is directional: aliases point TO a canonical item. "whole milk" is an alias for item "milk", but not the reverse. When a recipe calls for "milk" (generic), any item with "milk" as its name OR any item that has an alias matching "milk" is a candidate. When a recipe calls for "whole milk" (specific), only items named "whole milk" or with an alias "whole milk" match — the canonical "milk" item does NOT match unless it also has an alias for "whole milk". Implement this in the matching service.

- [x] **1E.3** Create migration (schema defined in inventory.ts, will apply on next db push)

### 1F: Price History Table (New)

- [x] **1F.1** Price history: **decided — no separate table.** Stock tranches already have `price_per_unit` + `added_at`, so price history is implicit. Query stock entries by item to get historical prices.

### 1G: Receipt Parsing Table (New)

- [x] **1G.1** Create `receipt_scans` table with `parsed_items` JSONB, `shopping_list_context` JSONB, and status enum.
  - **File:** `backend/src/db/schema/inventory.ts`

- [x] **1G.2** Create migration (schema defined in inventory.ts, will apply on next db push)

### Schema Phase Testing

- [x] **1T.1** Verify all migrations apply cleanly on a fresh database — confirmed via `drizzle-kit push --force` on fresh DB
- [x] **1T.2** Verify existing inventory routes still work with new columns — verified via running app with seeded data, all CRUD operations functional
- [ ] **1T.3** Verify existing shopping list routes still work. _Test when backend is running with data._
- [ ] **1T.4** Verify existing cooking session finish flow still works (FinishCookingDialog). _Test when backend is running with data._
- [ ] **1T.5** Verify existing meal plan -> shopping list generation still works. _Test when backend is running with data._

---

## Phase 2: Confidence Engine (Backend)

_Goal: Build the core confidence calculation and decay system as a standalone service that other features consume._

- [x] **2.1** Create `backend/src/lib/confidence.ts`:
  - `calculateItemConfidence(tranches[], area)` — computes weighted confidence from all tranches for an item
  - `calculateTrancheConfidence(tranche, area)` — applies time-based decay to a single tranche's confidence
  - `getDecayRateForArea(area)` — returns daily decay % based on `location_type` or custom override
  - `getConfidenceBand(score)` — maps numeric score to `'high' | 'medium' | 'low'` using household thresholds
  - Default decay rates: fridge = 3%/day, freezer = 0.5%/day, pantry = 0.3%/day, other = 1%/day

- [x] **2.2** Create `backend/src/lib/confidence.test.ts` — 31 tests, all passing:
  - Decay calculation for fridge/freezer/pantry/other/custom rates
  - Weighted confidence across mixed-confidence tranches
  - FIFO depletion ordering (oldest first, lowest confidence tiebreak)
  - Confidence band thresholds (default and custom)
  - Edge cases: zero tranches, zero quantity, expired items, expiry proximity penalty

- [x] **2.3** Create `backend/src/services/inventory-confidence.service.ts`:
  - `getItemConfidence(itemId)` — per-tranche area-aware decay, quantity-weighted average
  - `getInventoryConfidenceMap(householdId)` — bulk confidence for all items
  - `depleteTranches(itemId, quantity, unit)` — FIFO with unit conversion, deletes empty tranches
  - `reconcileItem(itemId, actualQuantity, unit, areaId, userId)` — replaces all tranches with one at confidence 100
  - `markOutOfStock(itemId)` — deletes all tranches

- [x] **2.4** Confidence decay: **compute on-read** (no worker needed). `calculateTrancheConfidence` applies decay at query time using `addedAt`/`verifiedAt` timestamps and area decay rates. No periodic recalculation, no write amplification.

### Confidence Engine Testing

- [x] **2T.1** Unit tests for `confidence.ts` pure functions — 31 tests passing
- [ ] **2T.2** Integration tests for `inventory-confidence.service.ts` (real DB, create tranches, deplete, verify quantities). _Needs running DB with test data._
- [ ] **2T.3** Test depletion with unit conversion (recipe needs cups, inventory stored in mL). _Needs running DB._
- [ ] **2T.4** Test depletion across multiple tranches with different confidences. _Needs running DB._
- [ ] **2T.5** Test reconciliation resets confidence correctly. _Needs running DB._
- [ ] **2T.6** Test multi-user depletion conflict scenario (two simultaneous depletions on same item). _Needs running DB._

---

## Phase 3: Shopping List Generation Engine (Backend)

_Goal: Replace current simple ingredient-to-list pipeline with confidence-aware, consolidation-first logic._

### 3A: Consolidation Service

- [x] **3A.1** Create `backend/src/services/shopping-list-generation.service.ts`:
  - `generateFromMealPlan(householdId, dateRange, options)`:
    1. Fetch all meal plan entries in range with recipe ingredients
    2. Aggregate ingredients across recipes (sum where name+unit match, convert where possible)
    3. If Tier 2: query inventory confidence map, apply confidence-tiered subtraction
    4. Return consolidated list with source tracking (which recipe needs what)
  - `generateFromRecipe(recipeId, servingsMultiplier, householdId)`: single-recipe variant
  - `previewShoppingList(...)`: dry-run that returns the list without persisting

- [x] **3A.2** Implement look-ahead suggestion logic:
  - `getLookAheadSuggestions(householdId, currentShoppingListItemIds, days=7)`:
    1. Fetch upcoming meal plans in next N days
    2. Compare their ingredients against what's already on the shopping list
    3. Return suggestions: `{ recipe, sharedIngredientCount, totalIngredients, overlappingIngredients[] }`

- [ ] **3A.3** Update existing shopping list generation endpoints in `recipes.routes.ts` to use new service (currently old and new coexist)

- [ ] **3A.4** Update `backend/src/modules/inventory/inventory.routes.ts` shopping list endpoints to populate new fields (recipe_id, confidence_note, is_delta, etc.)

### 3B: Tier-Aware Shopping List API

- [x] **3B.1** Add `POST /api/v1/recipes/meal-plans/shopping-preview` — confidence-aware preview endpoint added to recipes.routes.ts
- [ ] **3B.2** Add `POST /api/v1/recipes/meal-plans/shopping-generate` — persist the confidence-aware list (currently only preview is implemented)
- [x] **3B.3** Add `GET /api/v1/recipes/meal-plans/look-ahead-suggestions` — look-ahead endpoint added to recipes.routes.ts
- [ ] **3B.4** Modify existing shopping list item check-off to optionally prompt "do you already have this?" for Tier 1 with low/no-confidence inventory

### Shopping List Testing

- [ ] **3T.1** Unit tests for consolidation logic (same unit merge, cross-unit merge via conversion, unconvertible units kept separate)
- [ ] **3T.2** Unit tests for confidence-tiered subtraction (high: delta, medium: full+note, low: full)
- [ ] **3T.3** Integration test: generate shopping list from 3 recipes sharing ingredients, verify consolidation
- [ ] **3T.4** Integration test: Tier 2 with inventory — verify delta calculation with high-confidence stock
- [ ] **3T.5** Integration test: Tier 1 — verify no inventory subtraction occurs
- [ ] **3T.6** Test look-ahead suggestions: plan Monday + Thursday recipes sharing 3 ingredients, verify suggestion returned
- [ ] **3T.7** Test order of operations: aggregate -> consolidate -> subtract -> present
- [ ] **3T.8** Test edge case: recipe ingredient has no matching inventory item (passes through unmodified)
- [ ] **3T.9** Test edge case: inventory has item but in unconvertible unit (treated as low confidence for that unit)

---

## Phase 4: Depletion Flow (Backend + Frontend)

_Goal: When a user finishes cooking, deplete inventory via the confidence-aware tranche system._

### 4A: Backend Depletion

- [ ] **4A.1** Refactor existing `POST /api/v1/recipes/:id/finish` to use `depleteTranches` service instead of inline FIFO logic:
  - Accept `adjustments[]` array with `{ ingredientId, actualQuantity, actualUnit, skipped }`
  - For each non-skipped ingredient with a linked inventory item:
    - Call `depleteTranches(itemId, actualQuantity, unit)` from confidence service
    - Record the depletion as a new negative tranche (source: `cooking_depletion`) or reduce existing tranches
  - Emit WebSocket event for real-time inventory update

- [x] **4A.2** Add `POST /api/v1/inventory/items/:id/deplete` — ad-hoc depletion endpoint added to inventory.routes.ts

- [x] **4A.3** Add `POST /api/v1/inventory/items/:id/reconcile` — reconciliation endpoint added to inventory.routes.ts

- [x] **4A.4** Add `POST /api/v1/inventory/items/:id/out-of-stock` — mid-cook out-of-stock endpoint added to inventory.routes.ts (optionally adds to shopping list; AI substitution suggestions deferred)

### 4B: Frontend Depletion UX

- [ ] **4B.1** Update `FinishCookingDialog.tsx`:
  - Pre-check all ingredients (opt-out model instead of current opt-in)
  - Use planned serving count for pre-filled quantities
  - Add inline quantity editing per ingredient
  - Show confidence indicator next to each ingredient's current inventory state
  - **Files:** `frontend/src/pages/recipes/FinishCookingDialog.tsx`

- [ ] **4B.2** Add mid-cook "I don't have this" action to `CookModePage.tsx`:
  - Tap ingredient -> "Mark out of stock" -> confirm -> optionally add to shopping list
  - Show substitution suggestion from inventory (e.g., "you have garlic powder in Pantry")
  - **File:** `frontend/src/pages/recipes/CookModePage.tsx`

- [ ] **4B.3** Add ad-hoc depletion to inventory item detail (direct quantity adjustment from InventoryPage)

### Depletion Testing

- [ ] **4T.1** Integration test: finish cooking session with all ingredients -> verify tranche quantities decreased
- [ ] **4T.2** Integration test: finish cooking with one ingredient skipped -> verify that ingredient's stock unchanged
- [ ] **4T.3** Integration test: finish cooking with adjusted quantity (used less) -> verify correct depletion amount
- [ ] **4T.4** Integration test: depletion requiring unit conversion (recipe: cups, stock: mL) -> verify correct mL amount deducted
- [ ] **4T.5** Integration test: FIFO depletion across multiple tranches (oldest consumed first)
- [ ] **4T.6** Integration test: depletion exceeds available stock -> verify stock goes to 0, no negative quantities
- [ ] **4T.7** Integration test: mark-out-of-stock -> verify confidence=100, quantity=0
- [ ] **4T.8** Integration test: reconcile with different quantity -> verify new quantity and confidence=100
- [ ] **4T.9** E2E test: cook a recipe from CookModePage -> FinishCookingDialog -> verify inventory updated in InventoryPage
- [ ] **4T.10** Test multi-user conflict: two users finish cooking simultaneously using same ingredient -> verify no double-depletion or negative stock

---

## Phase 5: Frontend — Confidence UI & Tier System

_Goal: Surface confidence data in the UI and implement the Basic/Advanced tier toggle._

### 5A: Tier Toggle

- [x] **5A.1** Add inventory tier setting to household settings page
  - **File:** `frontend/src/pages/settings/HouseholdSettingsPage.tsx`
  - Toggle between Basic and Advanced with explanation text, card-style selector
  - Uses `settingsApi.updateHouseholdSettings()` to persist tier choice

- [x] **5A.2** Create `useInventoryTier()` hook that reads household settings
  - **File:** `frontend/src/hooks/useInventoryTier.ts`

- [x] **5A.3** Gate Advanced-only UI behind tier check (confidence indicators, reconciliation prompts, etc.)
  - Confidence query only runs when `isAdvanced` is true
  - Confidence badges, "Verify Stock" menu item, and ReconcileDialog gated behind `isAdvanced`

### 5B: Confidence Display

- [x] **5B.1** Add confidence band indicator component (`ConfidenceBadge`):
  - Green dot / "In stock" for high
  - Yellow dot / "Check stock" for medium
  - Red dot / "Low confidence" for low
  - Gray / "Unknown" for no data
  - **File:** `frontend/src/components/inventory/ConfidenceBadge.tsx`

- [x] **5B.2** Integrate confidence into inventory page — per-item confidence indicator next to name in all views (By Location + All Items)
  - Uses bulk `GET /api/v1/inventory/confidence` endpoint (new)
  - Also added `inventory` field to `HouseholdSettings` type in `frontend/src/types/models.ts`
  - Added confidence/reconcile/deplete/out-of-stock API methods to `frontend/src/api/inventory.ts`
- [ ] **5B.3** Integrate confidence into `ManageStockDialog.tsx` — show per-tranche confidence
- [ ] **5B.4** Integrate confidence into `ShoppingListItem.tsx` — show confidence notes, delta vs. full indicators

### 5C: Reconciliation UI

- [x] **5C.1** Add "Reconcile" action to inventory items (per-item: "I checked, I have X amount")
  - **File:** `frontend/src/components/inventory/ReconcileDialog.tsx`
  - Shows current confidence band, pre-fills with current quantity/unit/area
  - Calls `POST /api/v1/inventory/items/:id/reconcile` to reset confidence to 100%

- [ ] **5C.2** Add batch reconciliation flow for a location ("Check your fridge" — iterate items in that area)
  - **File:** New `frontend/src/components/inventory/LocationAuditDialog.tsx`

- [ ] **5C.3** Add reconciliation prompt on shopping list for medium-confidence items ("reconcile to update" link)

### 5D: Shopping List Enhancements

- [ ] **5D.1** Update `GenerateShoppingListDialog.tsx`:
  - Show confidence-tiered quantities with explanation
  - Show look-ahead suggestions ("Thursday's recipe shares 4 ingredients...")
  - Allow adding shared ingredients only, full recipe, or dismiss
  - **File:** `frontend/src/pages/recipes/GenerateShoppingListDialog.tsx`

- [ ] **5D.2** Update `ShoppingListPage.tsx`:
  - Add "Do you already have this?" prompt when unchecking items in Tier 1 (if system thinks no stock)
  - Show source recipe attribution per item
  - Group by recipe or by category toggle

- [ ] **5D.3** Update shopping list item check-off flow for Tier 2:
  - Checked item -> prompt to add quantity to inventory (quick "Put Away" flow)
  - Pre-fill with the shopping list quantity

### 5E: Migration UX (Basic -> Advanced)

- [ ] **5E.1** Create "quick stock" onboarding dialog:
  - Shows recent shopping list check-offs ("you bought these recently — still in your kitchen?")
  - User taps yes/no per item; "yes" items get added as inventory tranches with confidence 80
  - **File:** New `frontend/src/components/inventory/QuickStockOnboardingDialog.tsx`

### Frontend Testing

- [ ] **5T.1** Visual test: confidence badges render correctly for each band (green/yellow/red/gray)
- [ ] **5T.2** Tier toggle: switch to Advanced -> verify confidence UI appears; switch to Basic -> verify it hides
- [ ] **5T.3** Shopping list: verify delta display for high-confidence items, full amount for low
- [ ] **5T.4** Shopping list: verify look-ahead suggestion appears when adding a single recipe's ingredients
- [ ] **5T.5** Reconciliation: reconcile an item -> verify confidence resets to green in the UI
- [ ] **5T.6** Mid-cook: mark ingredient out of stock -> verify "Add to shopping list?" prompt appears
- [ ] **5T.7** Quick stock onboarding: switch to Advanced -> verify dialog shows recent purchases -> confirm items appear in inventory

---

## Phase 6: Receipt OCR & Price System

_Goal: Enable receipt scanning, price tracking, and recipe cost estimates._

### 6A: Receipt OCR Backend

- [ ] **6A.1** Add receipt processing endpoint: `POST /api/v1/inventory/receipts/scan`
  - Accepts image (base64 or multipart)
  - Runs OCR (via VLM-LLM service or dedicated OCR)
  - Matches against current shopping list items (fuzzy matching with shopping list as prior)
  - Returns parsed items with confidence scores for user review
  - **File:** New `backend/src/modules/inventory/receipt.service.ts`

- [ ] **6A.2** Add receipt confirmation endpoint: `POST /api/v1/inventory/receipts/:id/confirm`
  - User confirms/edits parsed items
  - Creates inventory tranches with price data
  - Marks shopping list items as purchased

- [ ] **6A.3** Add VLM-LLM receipt parsing prompt and endpoint
  - **File:** Update `services/vlm-llm/prompts.py` with receipt-specific prompts
  - **File:** Update `services/vlm-llm/main.py` with `/extract/receipt` endpoint

### 6B: Price Display

- [x] **6B.1** Add `GET /api/v1/recipes/:id/cost-estimate` endpoint:
  - Calculates per-serving cost from ingredient price history
  - Returns cost + completeness (X of Y ingredients have recent price data)
  - Respects the "most ingredients have recent prices" threshold

- [ ] **6B.2** Add price display to `RecipeDetailPage.tsx`:
  - Show estimated cost only when data is sufficiently complete
  - Show "X ingredients missing price data" when partial

- [ ] **6B.3** Add price column to `InventoryPage.tsx` item list (last known price per unit)

### Receipt OCR Testing

- [ ] **6T.1** Unit test: receipt line fuzzy matching against shopping list (exact match, abbreviation match, no match)
- [ ] **6T.2** Integration test: scan receipt -> confirm -> verify inventory tranches created with prices
- [ ] **6T.3** Integration test: recipe cost estimate with full price data -> verify correct per-serving cost
- [ ] **6T.4** Integration test: recipe cost estimate with partial data -> verify completeness indicator
- [ ] **6T.5** Test receipt with items not on shopping list -> verify they appear as "unmatched" for manual assignment

---

## Phase 7: Ingredient Ontology & Matching Improvements

_Goal: Improve ingredient matching for depletion, shopping list, and receipt OCR._

- [x] **7.1** Extend `ingredient-matching.service.ts` to use the `ingredient_aliases` table:
  - Added `findAliasCandidates()` function for directional alias DB lookup
  - Alias matches scored at 0.92 (between exact 1.0 and synonym 0.95)
  - Integrated into `matchIngredients()` loop after name-based similarity scoring

- [ ] **7.2** Build seed data for common ingredient aliases:
  - LLM-assisted: generate initial alias set for top ~200 common ingredients
  - Store in a seed script or migration
  - **File:** New `backend/scripts/seed-ingredient-aliases.ts`

- [ ] **7.3** Add "also known as" field to item edit UI:
  - Users can add/remove aliases for their inventory items
  - **File:** Update `frontend/src/components/inventory/ItemForm.tsx`

- [x] **7.4** Add alias learning from recipe import:
  - When a user manually matches a recipe ingredient to an inventory item during import, auto-create an alias if the names differ
  - **File:** Update `backend/src/modules/recipes/recipe-import.service.ts`

### Ontology Testing

- [ ] **7T.1** Test: recipe says "milk", inventory has "whole milk" with alias -> verify match found
- [ ] **7T.2** Test: recipe says "butter", inventory has "unsalted butter" with alias -> verify match
- [ ] **7T.3** Test: import recipe, manually match "flour" to "all-purpose flour" -> verify alias created
- [ ] **7T.4** Test: alias doesn't override explicit user match preferences

---

## Phase 8: WebSocket & Real-time Updates

_Goal: Ensure all inventory changes propagate in real-time across household devices._

- [x] **8.1** Add WebSocket events for:
  - `inventory:confidence-updated`, `inventory:reconciled`, `inventory:out-of-stock`, `shopping:look-ahead-suggestion`
  - Added event types and emit functions to `backend/src/websocket/events.ts`

- [x] **8.2** Update `WebSocketProvider.tsx` to invalidate relevant React Query caches on new events + update `socket.ts` types
  - **Files:** `frontend/src/providers/WebSocketProvider.tsx`, `frontend/src/types/socket.ts`

- [ ] **8.3** Handle multi-user depletion conflict:
  - When user A is in the FinishCookingDialog and user B depletes the same item, push a WebSocket event to user A
  - User A sees updated quantities before confirming
  - **File:** Backend depletion endpoint + frontend FinishCookingDialog

### Real-time Testing

- [ ] **8T.1** Test: User A depletes item -> User B sees updated quantity without refresh
- [ ] **8T.2** Test: User A in FinishCookingDialog -> User B depletes same item -> User A sees warning/updated data
- [ ] **8T.3** Test: receipt confirmed -> shopping list updates in real-time on another device

---

## Phase 9: Integration & End-to-End Testing

_Goal: Test the full lifecycle flows across the entire system._

### Happy Path Flows

- [ ] **9.1** Full Tier 1 cycle:
  1. Create recipe with ingredients
  2. Add to meal plan
  3. Generate shopping list
  4. Check off items at store
  5. Cook recipe (no inventory deduction in Tier 1)
  6. Verify shopping list is cleared

- [ ] **9.2** Full Tier 2 cycle:
  1. Create recipe with ingredients
  2. Add inventory items with stock (various confidence levels)
  3. Add recipe to meal plan
  4. Generate shopping list -> verify confidence-tiered behavior
  5. Check off items -> verify inventory tranches created
  6. Cook recipe -> finish cooking -> verify depletion
  7. Generate next shopping list -> verify it reflects depleted inventory

- [ ] **9.3** Tier migration flow:
  1. Start on Tier 1, build up items library through recipes + shopping
  2. Switch to Tier 2
  3. Verify items library carries over, quantities at confidence 0
  4. Verify quick stock onboarding shows recent purchases
  5. Run a Tier 2 shopping list generation -> verify all items treated as low confidence

- [ ] **9.4** Receipt OCR flow:
  1. Generate shopping list from meal plan
  2. Scan receipt
  3. Verify items match against shopping list
  4. Confirm -> verify inventory updated with prices
  5. View recipe cost estimate -> verify prices reflected

- [ ] **9.5** Mid-cook discovery flow:
  1. Start cooking session
  2. Mark ingredient as out-of-stock
  3. Verify added to shopping list
  4. Verify substitution suggestion shown (if available)
  5. Finish cooking -> verify depleted amounts correct for remaining ingredients

### Edge Cases & Stress Tests

- [ ] **9.6** Recipe with all ingredients missing from inventory (Tier 2) -> shopping list = full quantities
- [ ] **9.7** Recipe with mixed-unit ingredients (cups + grams + "to taste") -> verify "to taste" passes through, others consolidate
- [ ] **9.8** Two recipes on same day with same ingredient, different units -> verify consolidation with conversion
- [ ] **9.9** Downgrade from Tier 2 to Tier 1 -> verify shopping list generation ignores inventory
- [ ] **9.10** Re-upgrade to Tier 2 -> verify inventory data still present with decayed confidence
- [ ] **9.11** Large household (100+ inventory items, 20+ recipes, 14-day meal plan) -> verify shopping list generation performance < 2s
- [ ] **9.12** Concurrent users: one user shopping, one cooking, one planning -> verify no data corruption

---

## Phase 10: Polish & Documentation

- [ ] **10.1** Add user-facing tooltips/help text explaining confidence indicators
- [ ] **10.2** Add empty states for new features (no inventory yet, no prices yet, etc.)
- [ ] **10.3** Ensure all new API endpoints have Swagger documentation
- [ ] **10.4** Update CLAUDE.md if architecture overview changes significantly
- [ ] **10.5** Performance audit: ensure inventory queries use proper indexes (add composite indexes on `inventory_stock.item_id + added_at`, `shopping_list.household_id + is_checked`, etc.)
- [ ] **10.6** Verify mobile responsiveness for all new dialogs and components

---

## Dependency Graph

```
Phase 0 (Decisions)
  |
  v
Phase 1 (Schema) ──────────────────────────────┐
  |                                             |
  v                                             v
Phase 2 (Confidence Engine)              Phase 1D (Settings)
  |                                             |
  v                                             v
Phase 3 (Shopping List Gen) ◄───── Phase 5A (Tier Toggle)
  |                                             |
  v                                             v
Phase 4 (Depletion) ──────────────► Phase 5B-E (Confidence UI)
  |                                             |
  v                                             v
Phase 7 (Ontology)                   Phase 6 (Receipt OCR)
  |                                             |
  └──────────────┬──────────────────────────────┘
                 v
          Phase 8 (WebSocket)
                 |
                 v
          Phase 9 (E2E Tests)
                 |
                 v
          Phase 10 (Polish)
```

**Critical path:** Phase 0 -> 1 -> 2 -> 3 -> 4 -> 9

**Can be parallelized:**
- Phase 5 (frontend) can start after Phase 2 is done (mock confidence data)
- Phase 6 (receipt OCR) can start after Phase 1 is done (independent backend work)
- Phase 7 (ontology) can start after Phase 1E is done
- Phase 8 (WebSocket) can start after Phase 4 is done
