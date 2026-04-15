# Inventory & Shopping System Architecture

## Overview

Two-tier system for managing the shopping -> inventory -> usage -> drift -> shopping list lifecycle. Users choose their level of engagement. The items library (catalog of ingredients the user has interacted with) is shared across both tiers and builds up passively through normal app usage.

---

## Tier 1: Basic

- Recipe adds ingredients to shopping list
- User manually removes items they already have
  - **If the system has low/no confidence in that item's stock (or believes there is no stock), prompt: "Do you already have this?"** — a gentle bridge toward Tier 2 awareness without requiring Tier 2 commitment
- User checks items off at the store
- System suggests expiration dates, storage tips, etc.
- Items library builds passively through recipe usage and shopping list activity

## Tier 2: Advanced

- Full inventory with quantities, locations, confidence scores
- Depletion on cooking (confirmed, low-friction)
- Receipt OCR for prices, matched against shopping list context
- Confidence-aware shopping list generation
- Reconciliation prompts for low-confidence items

## Migration (Basic -> Advanced)

- Items library carries over (ingredient names, categories, any metadata accumulated through usage)
- All current inventory quantities/prices start at confidence 0
- User builds real inventory organically through shopping and cooking cycles — no "audit your whole kitchen" gate required
- A "quick stock" onboarding flow can optionally pull from recent shopping list check-offs ("you bought these recently — are they still in your kitchen?")

## Downgrade (Advanced -> Basic)

- Inventory data persists in the database but stops being used for shopping list generation
- User returns to manual "remove what you have" workflow
- If they switch back to Advanced, their inventory is still there (with degraded confidence scores from the time elapsed)

---

## Confidence Score System

### Per-Quantity-Layer Model

Confidence is tracked per-quantity-layer (tranche), not per-item as a whole. Each purchase or manual entry creates a new tranche with its own confidence and timestamp.

Example: You have 0.5 gallons of milk at confidence 30. You buy 1 gallon (confidence 100). The item's total is 1.5 gallons, but with mixed confidence across two tranches.

**Depletion order:** FIFO — oldest/lowest-confidence quantity is consumed first. This aligns with how people actually use perishables.

**Frontend display:** Users don't see tranche math. They see a simplified confidence band (green/yellow/red) or a plain-language indicator ("mostly confident", "check stock"). The tranche arithmetic lives in the backend.

### What Drives Confidence Down

- Time since last manual verification or purchase
- Decay rate is **location-aware**: fridge items decay faster than freezer items, which decay faster than pantry staples
- Confidence drops faster as an item approaches its expected expiration date
- v1: location-level decay rates. Future: per-category decay curves (ketchup in fridge decays slower than leftover rice in fridge)

### What Drives Confidence Up

- Manual verification / reconciliation ("yes, I still have this, here's how much")
- Purchase (adds a new tranche at 100, does NOT reset the whole item to 100)
- Implicit signals: if a Tier 1 user checks off "milk" on a shopping list, that's an implicit purchase — could create/refresh an inventory entry

---

## Shopping List Generation

### Confidence-Tiered Behavior

| Inventory Confidence | Shopping List Behavior |
|---|---|
| High (>80%) | Show delta only ("you need 2 more cups") |
| Medium (40-80%) | Show full amount + note: "you may have some — reconcile to update" |
| Low/None (<40%) | Show full amount, no assumption about existing stock |

### Shopping List Item Removal UX

When a user removes an item from the shopping list, prompt:

- **"I already have this"** — Tier 1: stored as weak inventory signal (feeds future "do you already have this?" prompts and quick-stock onboarding on tier upgrade). Tier 2: triggers reconciliation prompt ("How much do you currently have?").
- **"Skipping this item"** — just remove, no inventory signal.

If the user has some-but-not-enough, they edit the quantity on the shopping list rather than removing the item. The quantity edit screen includes a calculator with unit conversion (e.g., "I have 200g" when the list says cups, with density math built in).

### Shopping List Item Check-Off (at the store)

Checked-off items are stored as weak purchase signals for Tier 1 users. For Tier 2, checking off can trigger a quick "add to inventory" flow.

### Consolidation Order of Operations

1. Aggregate all ingredients across all recipes on the shopping list
2. Consolidate duplicates (sum quantities where ingredient + unit match, convert units where possible)
3. Subtract inventory (confidence-tiered: only subtract high-confidence stock as a delta)
4. Present final list

### Look-Ahead / Efficiency Suggestions

When a user adds a planned recipe for (e.g.) Monday to the shopping list, the system does a look-ahead across the next ~7 days of planned meals. If upcoming meals share ingredients in common with what's already on the list, the system suggests:
- "Thursday's Chicken Stir Fry shares 4 ingredients with your current list — add just those ingredients, or add the whole recipe?"
- User can: add shared ingredients only, add the full recipe's ingredients, or dismiss

This is a suggestion, not automatic. The user decides whether to shop for the day or the week.

---

## Depletion Mechanics

### Trigger

Marking a meal as cooked on the planner triggers a depletion confirmation prompt.

### Confirmation UX (Low-Friction)

- Show the ingredient list **pre-checked** (assume everything was used as the recipe specifies)
- User unchecks anything they skipped, or adjusts quantities for partial use
- One tap to confirm
- This is opt-out, not opt-in — optimized for the 90% case where the recipe was followed as written
- The pre-checked quantities use the **planned serving count** for that specific planner instance

### Edge Cases

- **Ad-hoc cooking** (not on the planner): User can manually trigger depletion from any recipe, or directly edit inventory quantities
- **Substitutions**: If the user substituted an ingredient, they uncheck the original and can optionally note what they used instead (which depletes the substitute from inventory)
- **Partial batch**: If user scaled to 8 servings but only cooked 4, they need to adjust quantities at confirmation time. The pre-checked list should allow inline quantity editing.

---

## Inventory Data Model

### Per-Item

- Ingredient (linked to items library / ingredient ontology)
- Location (user-defined: Pantry, Fridge, Freezer, Garage Freezer, etc.)
- Quantity (numeric, in a canonical storage unit)
- Unit (canonical unit for this ingredient category)
- Confidence score (computed from tranches)
- Expected expiration date (system-suggested, user-editable)
- Notes (optional, free text)

### Per-Tranche (backend)

- Quantity added
- Unit
- Confidence (starts at 100 for purchases, 0 for migration/unknown)
- Timestamp (created)
- Source (purchase, manual entry, migration, implicit from shopping list check-off)
- Price (optional, per-unit cost at time of purchase)

### Locations

User-defined, standardized across the app. Locations affect:
- Expiration rate expectations
- Confidence decay rate
- Audit grouping ("check your fridge" is actionable; "check your inventory" is not)
- Display grouping in the inventory UI

---

## Price System

### Data Entry

- **Receipt OCR**: User photographs a receipt. The system matches line items against the filled-out shopping list (fuzzy matching "BNLS CHKN BRST 2.3LB" against "Chicken Breast" from the list). Quantities from the receipt are suggested but require user confirmation.
- **Manual entry**: User enters price per item when adding to inventory
- Receipt OCR uses the shopping list as a prior — this is fuzzy matching against a known set, not open-ended extraction

### Display Threshold

Recipe cost ("This recipe costs $X") only displays when most ingredients have recent price data (within ~30 days). Options:
- If sufficient data: show estimated cost
- If partial data: show "estimated $X (3 of 8 ingredients missing price data)" or don't show at all
- Avoid false precision — partial data should not masquerade as complete data

### Price Storage

Price is stored per-tranche (what you paid for this specific purchase). Historical prices accumulate over time, enabling:
- Price-per-serving on recipes
- Price trends ("chicken breast is cheaper this month")
- Meal plan cost estimation

---

## Mid-Cook Discovery Flow

"I thought I had garlic but I don't":

1. From cooking mode, user marks an ingredient as out-of-stock
2. Inventory is updated immediately (quantity -> 0, confidence -> 100 for "I definitely don't have this")
3. Prompt: "Add to shopping list?"
4. Optionally: show AI substitution suggestion ("you could use garlic powder instead — you have some in your pantry")

Fast path, no ceremony.

---

## Ingredient Matching & Ontology

### Directional Alias Matching

Aliases are one-way: "whole milk" IS-A "milk", but "milk" is NOT "whole milk."

- Recipe says **"milk"** (generic) -> matches any alias: "whole milk", "2% milk", "skim milk"
- Recipe says **"whole milk"** (specific) -> exact match only, does not match "skim milk"

This gives the 90% case (generic matches broadly) without breaking the 10% case (specific matches narrowly).

### Equivalence vs. Substitution

- **Equivalence** (automated — affects depletion, shopping list, matching): Same ingredient at different specificity or form. "whole milk" = "milk", "frozen spinach" = "spinach", "all-purpose flour" = "flour".
- **Substitution** (suggestion only — never auto-depletes): Different ingredient that works in the same role. "Greek yogurt" for "sour cream", "garlic powder" for "garlic".

### Alias Learning

When a user manually matches a recipe ingredient to an inventory item during import (e.g., matches "flour" to "all-purpose flour"), the system auto-creates an alias if the names differ. This builds the ontology organically over time.

---

## Unit System

### Canonical Storage

- Weight base unit: **grams** (g)
- Volume base unit: **cups** (cup)
- Density stored as **g/cup** — directly bridges the two base units with no intermediate conversion
- All backend math (depletion, consolidation, shopping deltas) operates in canonical units
- Display-convert to user-preferred units at the frontend

### Unit Categories

**Weight (locked, 8 units):** mg, g, dag, hg, kg, oz, lb, st
**Volume (locked, 18 units):** mL, cL, dL, L, tsp, tbsp, dsp, fl oz, gi, cup, pt, qt, gal, jig, metric cup, au tbsp, jp cup, go
**Imperial UK (locked, 4 units):** imp fl oz, imp pt, imp qt, imp gal
**Negligible (locked, skip in math):** to taste, pinch, dash, drop, drizzle, splash, handful, smidgen, garnish, as needed
**Count (built-in + household-expandable):** each, dozen, piece, slice, portion, serving, can, jar, bottle, bag, box, pack, case, bunch, head, clove, sprig, stalk, stick, strip, fillet, breast, thigh, drumstick, wing, patty, link, ear, bulb, leaf, sheet, block, wedge, scoop, rasher, floret, rib, spear, knob, pat, cube, sachet, tube, pouch, tray
**No unit (null):** Bare quantities like "2 apples" — treated as implicit "each" for math, displayed without unit text.

Households configure which units are enabled. Defaults: mg, g, kg, oz, lb (weight); mL, L, tsp, tbsp, fl oz, cup, pt, qt, gal (volume). All count units enabled by default.

### Conversion Tiers (priority order)

1. **Same-category standard conversion** (cups -> mL, lb -> g) — pure math, always works
2. **Per-item conversion table** (user-defined: "1 egg = 50g", "1 chicken breast = 170g") — covers count-to-weight
3. **Density-based cross-category** (weight <-> volume via `density_g_per_cup`) — covers flour-in-cups vs flour-in-grams. Density directly bridges the two base units (grams and cups) with no intermediate conversion. User-friendly for experimental measurement: "scoop a cup, weigh it."
4. **Negligible units** — skip entirely in all math

Custom count units are household-scoped. Users create them during recipe import or from inventory settings. Without a per-item conversion defined, a count unit is unconvertible for that item and the system prompts the user.

Existing codebase: `backend/src/lib/unit-conversions.ts` and `backend/src/lib/ingredient-densities.ts`.

---

## Remaining Holes / Open Questions

### 1. Multi-User Depletion Conflicts

The app is multi-tenant with households. If two people cook different meals simultaneously, both get depletion prompts. If both meals use eggs, the second person to confirm sees stale inventory (the first person's depletion hasn't been confirmed yet). Needs optimistic locking or a "someone else is also confirming inventory changes" indicator.

### 2. Ingredient Ontology Scope

How deep does the equivalence hierarchy go? "Whole milk" = "milk" is straightforward. But does "Greek yogurt" satisfy "sour cream" in a recipe? Does "frozen spinach" satisfy "spinach"? The system needs clear boundaries on what's an equivalence vs. what's a substitution suggestion. Equivalences affect automated behavior (depletion, shopping list). Substitutions are suggestions only.

### 3. Confidence Threshold Tuning

The exact confidence percentages (>80% = high, 40-80% = medium, <40% = low) are placeholders. These may need to be tuned based on real usage data, or even made user-configurable ("I want the system to be more/less aggressive about assuming I have things").

### 4. Reconciliation UX

The shopping list references reconciliation ("reconcile to update") but the specific UX is not yet defined. At minimum need:
- A per-item "I checked, I have X amount" action
- Possibly a batch flow for auditing a whole location ("check your fridge")
- Trigger strategy (when to prompt) to be fleshed out later

### 5. Canonical Storage Units

Need to decide: does each ingredient category have one canonical unit (grams for flour, mL for milk), or can the user choose? Enforcing canonical units simplifies backend math but may frustrate users who think in cups/pounds. Display conversion handles this, but the data model choice matters.

### 6. Receipt OCR Accuracy Expectations

Even with shopping list priors, receipt parsing will have a meaningful error rate. Need to define the UX for:
- Unmatched receipt items (bought something not on the list)
- Ambiguous quantity parsing ("2/$5" — is that 2 items or a price?)
- Confidence display on parsed results so users know what to double-check

### 7. Shopping List as Implicit Purchase Record

If a Tier 1 user checks off items on a shopping list, that's an implicit signal they bought those items. How aggressively should this update inventory state? Options:
- Create inventory entries automatically (aggressive — may be wrong if user checked off items they decided to skip)
- Only use as a weak signal for the "do you already have this?" prompt
- Ask once: "would you like checked-off items to update your inventory?"

### 8. Items Library / Ontology Data Source

The items library builds passively, but the ingredient ontology (equivalences, categories, canonical units) needs seed data. Options:
- Curate manually (high quality, limited scope)
- Source from USDA database or Open Food Facts
- Build incrementally as users add recipes and correct matches
- LLM-assisted: use AI to suggest equivalences and categories, user confirms
