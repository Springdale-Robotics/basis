# Basic Mode UX Findings — Week Scenario Walkthrough

**Date:** 2026-04-14
**Mode tested:** Basic (Tier 1)
**Scenario:** `working/testing/family-week-scenario.md`

---

## Critical Issues

### 1. Delete dialog shows stock-vs-catalog options in Basic mode
**Severity:** High — confusing for Basic users
**Location:** InventoryPage.tsx delete dialog
**Issue:** When deleting an item in Basic mode, the confirmation dialog presents two options: "Remove from stock only" and "Remove from catalog completely." Basic mode doesn't track stock quantities, so "remove from stock only" is meaningless. Users will be confused about what "catalog" means vs "stock."
**Fix:** In Basic mode, show a simple "Are you sure you want to delete this item?" confirmation. No options needed.

### 2. Shopping list shows "low stock" badge in Basic mode
**Severity:** Medium — leaks Advanced concepts into Basic
**Location:** Shopping list page, item badges
**Issue:** Items on the shopping list show a "low stock" tag. Stock levels aren't tracked in Basic mode, so this label is confusing and suggests functionality that doesn't exist.
**Fix:** Hide stock-related badges/sources on shopping list items when in Basic mode.

### 3. Expiry date silently lost when shelf life is also set on new items
**Severity:** Medium — data loss
**Location:** ItemForm.tsx, create flow
**Issue:** When adding a new item with BOTH an expiry date and a shelf life, only the shelf life persists. The expiry date is silently discarded. The item displays "7d shelf life" instead of the specific expiry the user entered. Re-opening the edit dialog shows the expiry field empty.
**Root cause:** The expiry date is saved via a separate stock entry creation (in `handleItemFormSubmit`), but for NEW items, the `editingItem` is null so the expiry date handling code is skipped entirely — it only runs for edits, not creates.
**Fix:** After creating a new item, also handle `expiryDate` the same way as during edits (create a stock entry with the expiry).

---

## UX Friction Points

### 4. No confirmation on "Finish" leftover
**Severity:** Low
**Location:** LeftoverCard component
**Issue:** Clicking "Finish" immediately marks a leftover as done with no confirmation or undo. One accidental tap and a leftover disappears from the list.
**Suggestion:** Either add a brief confirmation ("Finished all portions?") or show an undo toast for 5 seconds.

### 5. Expiry banner is informational only — not interactive
**Severity:** Medium
**Location:** InventoryPage.tsx, renderAlerts()
**Issue:** The "2 items expiring soon" banner with item badges is not clickable. Users see "Yogurt (3d)" but can't click it to jump to that item or see a filtered view. The banner is passive information.
**Suggestion:** Make item badges in the expiry alert clickable — click opens the edit dialog for that item. Or add a "View all" link that filters the inventory to expiring items only.

### 6. No way to update leftover portions without full edit
**Severity:** Medium
**Location:** Leftovers tab, LeftoverCard
**Issue:** In the scenario, Jordan needs to update leftover portions frequently (e.g., stir-fry goes from 3 → 1 portions over two days). Currently this requires opening the full edit dialog, changing the portions number, and saving. 
**Suggestion:** Add inline +/- buttons or a "Used a portion" quick action on the leftover card. One tap should decrement portions by 1. When portions hit 0, auto-finish.

### 7. No visual distinction between items with and without expiry dates
**Severity:** Low
**Location:** Item rows in By Location view
**Issue:** Items with an expiry show "Expires 4/16/2026" and items with shelf life show "7d shelf life", but items with NEITHER (like Olive Oil, Rice) show nothing. In Basic mode, where expiry tracking is a core feature, it would help to visually distinguish items that need expiry attention from those that don't.
**Suggestion:** Show a subtle "No expiry set" indicator for items without any expiry/shelf-life data, perhaps as a prompt to add one.

### 8. "Shelf Life" field purpose is unclear in Basic mode
**Severity:** Low
**Location:** ItemForm.tsx
**Issue:** Users may not understand the relationship between "Expires On" (a specific date) and "Shelf Life (days)" (a default duration). There's no explanation of how they interact — does shelf life auto-calculate expiry? Does expiry override shelf life?
**Current behavior:** They're independent. Shelf life is informational ("this item typically lasts X days"). Expiry is a specific date stored on the stock entry.
**Suggestion:** Add helper text: "Shelf life is used to suggest expiry dates when you buy this item again." Consider auto-filling the expiry date field based on shelf life when adding a new item (today + shelf life days).

---

## Missing Features for Basic Mode

### 9. No "quick add" flow for common items
**Severity:** Medium
**Issue:** Adding an item requires filling out name, category, area, shelf life — every time. For common items (milk, bread, eggs), this is repetitive.
**Suggestion:** When adding to shopping list and checking off at the store, offer to auto-create inventory items. Or provide a "quick add" with just a name and auto-suggest category/area from the item name.

### 10. No way to see all items sorted by expiry date
**Severity:** Medium
**Issue:** In Basic mode, the primary value is knowing what's expiring. But the "By Location" view groups by area, and the "All Items" view sorts by name. There's no "Expiring Soon" sort or filter that shows everything ordered by urgency.
**Suggestion:** Add an "Expiring" sort option in the All Items tab, or restore a lightweight "Expiring" filter chip that shows items sorted by expiry date (soonest first). This was removed in the 6→3 tab refactor.

### 11. No bulk operations in Basic mode
**Severity:** Low
**Issue:** The "Select Multiple" and "Bulk Add" buttons are in the All Items tab. Bulk Add works (adding multiple items at once), but the bulk selection toolbar shows "Change Category" and "Change Area" which are useful, but also "Keep in Stock" which is an Advanced concept.
**Fix:** Hide "Keep in Stock" from bulk operations in Basic mode.

### 12. Shopping list doesn't know about inventory items
**Severity:** Medium — key Basic mode flow gap
**Issue:** In the scenario, Jordan adds recipe ingredients to the shopping list, then removes items she already has ("I already have this"). But currently in Basic mode:
- There's no "I already have this" prompt when removing items
- Checked-off items at the store don't offer to create/update inventory items
- There's no bridge between shopping list activity and inventory state
**This is the core Tier 1 flow gap** from the architecture doc. Shopping list and inventory are currently disconnected in Basic mode.

---

## What Works Well

- **By Location view** — clean, organized, scannable. Area cards with collapse/expand work great.
- **Expiry alerts** — the warning banner with item badges is informative and shows up at the right time.
- **Leftovers tracking** — the leftover card with portions, source, expiry, and area is well-designed.
- **Add to Shopping List** from inventory dropdown — works, one click.
- **Edit item dialog** in Basic mode — appropriately simplified (no unit, density, keep-in-stock).
- **Shelf life display** — "7d shelf life" vs "Expires 4/20/2026" is clear and contextual.
- **Area management** — creating/editing areas from the Areas dropdown is smooth.

---

## Priority Order for Fixes

1. **#1** Delete dialog — wrong UI for Basic mode (quick fix)
2. **#3** Expiry date lost on new items (bug fix)
3. **#10** Expiring items sort/filter (feature, high value for Basic)
4. **#6** Quick portion update for leftovers (UX improvement)
5. **#5** Clickable expiry alert badges (UX improvement)
6. **#2** Low stock badge on shopping list (Basic mode gating)
7. **#11** Keep in Stock in bulk ops (Basic mode gating)
8. **#12** Shopping list ↔ inventory bridge (architecture gap, larger effort)
9. **#8** Auto-fill expiry from shelf life (UX polish)
10. **#9** Quick add for common items (future)
