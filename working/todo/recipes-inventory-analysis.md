# Recipes System — Analysis & Inventory Integration Gaps

**Date:** 2026-04-14

## What Exists (Working)

The recipes system is feature-rich:
- Full CRUD with tags, timing, difficulty, images
- Multi-source import (URL, text, PDF, image OCR, .recipe file)
- Confidence-scored text parsing with ingredient group detection
- Ingredient matching (exact, synonym, fuzzy, alias-based)
- Cook mode (step-by-step + checklist with timers)
- Inventory deduction on finish cooking (FIFO by expiry, unit conversion)
- Meal planning (week grid, per-meal-slot)
- Shopping list generation with aggregation
- Advanced tier: confidence-aware shopping with inventory subtraction
- Recipe export as .recipe JSON
- Cost estimation from price history

## Holes & Issues

### Critical — Tier Gating Missing

1. **Cook mode shows inventory deduction in Basic mode** — FinishCookingDialog offers "deduct from inventory" but Basic mode doesn't track quantities. Should either skip the deduction prompt entirely in Basic, or simplify to just "Mark as cooked."

2. **Import ingredient matching assumes Advanced** — The import flow shows inventory item matching, confidence scores, and unit conversion prompts. In Basic mode, users don't care about linking ingredients to inventory items with precise units. Basic import should be simpler: just parse the recipe and save it, with optional loose item linking.

3. **Shopping list generation ignores tier** — GenerateShoppingListDialog has a "Check inventory" toggle that triggers Advanced-tier confidence subtraction. In Basic, this toggle shouldn't exist. Basic should just add all ingredients to the list.

### UX Issues

4. **No "cooked" status on meal plan** — After finishing a recipe via CookModePage, the meal plan entry isn't updated. The user can't see which meals they've already cooked this week.

5. **Ingredient groups parsed but not displayed** — The parser detects "For the sauce:" groups but CookModePage doesn't use them. Ingredients show as a flat list.

6. **No recipe scaling in recipe detail** — Meal plan has servingsMultiplier but recipe detail page doesn't let you adjust servings to see scaled quantities.

7. **Import session expiry not handled** — Sessions expire after 24h in the DB but the frontend doesn't check or warn.

### Simplification Opportunities

8. **Recipe creation form has too many tabs** — Details/Ingredients/Instructions as separate tabs means lots of switching. Could be a single scrollable form with sections (like we did for the ItemForm).

9. **Counsel Mode in image scan** — Novelty feature (10 AI personas debate) is fun but confusing for regular users. Should be hidden or moved to an "experimental" section.

10. **Cost estimation is orphaned** — The endpoint exists but there's no UI showing recipe cost on the detail page.

### Inventory Integration Gaps

11. **No "What can I cook?" view** — Users can't see which recipes they have enough ingredients for based on current inventory. This is high-value for both tiers.

12. **No ingredient availability indicator on recipe detail** — When viewing a recipe, there's no visual showing which ingredients you have vs need to buy.

13. **Shopping list ↔ inventory bridge weak in Basic** — Checked-off shopping items don't create inventory entries. Architecture doc says this should be a "weak signal" in Basic.

14. **No depletion in Basic mode** — Architecture says Basic doesn't track quantities, so cooking shouldn't deduct. But there's no tier check in the finish cooking flow.

15. **Look-ahead suggestions endpoint exists but no UI** — `GET /recipes/meal-plans/look-ahead-suggestions` returns data but GenerateShoppingListDialog doesn't show it.

## Priority Actions

### Quick Wins (1-2 hours each)
- **Gate FinishCookingDialog by tier** — Basic: simple "Done cooking" without deduction. Advanced: current deduction flow.
- **Simplify import for Basic** — Hide confidence scores and unit conversion warnings. Still match ingredients but with less ceremony.
- **Hide "Check inventory" in Basic** shopping list generation.
- **Show ingredient groups in CookModePage** — Data already exists.

### Medium Effort (half day each)
- **Add "cooked" status to meal plan** — Track which meals are done.
- **Add recipe scaling to detail page** — Adjust servings slider, recalculate quantities.
- **Add ingredient availability to recipe detail** — Green/yellow/red indicators per ingredient.

### Larger Efforts (1+ days)
- **"What can I cook?" feature** — Query recipes against inventory, score by ingredient availability.
- **Shopping list ↔ inventory bridge** — Check-off flow that optionally creates inventory entries.
- **Recipe form redesign** — Single-page form with sections instead of tabs.
