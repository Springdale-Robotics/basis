# Recipe System — UX Audit & Remediation Plan

**Date:** 2026-05-31
**Scope:** Add recipe, edit recipe, import, cook mode, meal-plan/shopping-list integration, image input.
**Status:** Audit complete — no code changes made yet.

This document catalogs UX inconsistencies, inefficiencies, and silent-failure bugs found across the
recipe feature, then proposes a batched remediation plan. Findings marked **✓verified** were confirmed
directly against the code; the rest come from close reads of the relevant files. Two subagent claims
were rejected during verification (a "seconds-only timers are blocked" claim — `AddTimerDialog.tsx:149`
`disabled={!minutes && !seconds}` only blocks when *both* are empty; and an over-stated popover
focus-trap claim).

---

## Findings

### 🔴 High severity — silent data loss / dishonest UI

**1. Final Save button bypasses form validation. ✓verified**
`RecipeForm.tsx:1208-1221` — the submit button calls `getValues()` + `handleFormSubmit(data)` directly,
never going through react-hook-form's `handleSubmit(...)` wrapper (destructured at `:578` but unused;
`handleFormError` at `:768` is dead code). The Zod resolver never runs on submit, so the inline
`errors.title` message (`:873`) can never appear and an empty title is shipped to the backend, surfacing
as a generic destructive toast instead of inline validation.

**2. Editing ingredient text on an existing recipe silently discards the edit. ✓verified**
On edit, `hasParsed` is pre-set `true` (`RecipeForm.tsx:695`) and `parseLinkItems` pre-populated. On
submit, `handleFormSubmit` (`:722-763`) unconditionally overwrites `data.ingredients` from
`parseLinkItemsRef` whenever it's non-empty. Editing raw text in the Ingredients step does not re-parse
(Continue only parses `if (... && !hasParsed)`, `:1200`), so edits are thrown away unless the user finds
the small "Re-parse" link (`:1024`). Same trap in the Add path when navigating Back to Ingredients.

**3. If parsing fails, all ingredients vanish. ✓verified**
In the Ingredients step only `rawText` is populated; `name` stays `''` (`RecipeForm.tsx:960`). Names are
filled only by the parse step into `parsedName`. If `parseIngredientLines` throws (`:562` catch),
`hasParsed` stays false and `parseLinkItems` stays empty, so `handleFormSubmit` falls back to the raw
field array where every `name` is `''` — and `createMutation`/`updateMutation` filter with
`.filter(ing => ing.name)`. Result: a recipe saved with zero ingredients, no warning.

**4. "Difficulty" is a phantom field. ✓verified**
The form collects difficulty (`RecipeForm.tsx:918-937`, default `'medium'`) and `Recipe` has the field
(`models.ts:235`), but neither `createMutation` nor `updateMutation` sends it
(`RecipesPage.tsx:49-66`, `RecipeDetailPage.tsx:144-161`), and backend `createRecipeSchema` doesn't
accept it (`recipes.routes.ts:37`). User picks a difficulty, saves, it's silently dropped — and it's
never displayed anywhere anyway.

**16. Cooking progress is silently lost on refresh/navigation. ✓verified**
`stores/cookingStore.ts:43` uses plain `create(...)` with no `persist` middleware, whereas
`stores/timerStore.ts:29` does persist. Timers survive a reload but the cooking session (current step,
checklist `completedSteps`, mode) does not — refresh or back-nav mid-cook drops to step 0. Half the cook
state persists and half doesn't.

**17. `FinishCookingDialog` swallows all errors — no user feedback. ✓verified**
All three finish handlers `console.error` only (`FinishCookingDialog.tsx:82, 121, 142`), no `toast`,
inconsistent with `AddToMealPlanDialog.tsx:60`. If the inventory deduction fails, the spinner just
disappears and the user believes stock was decremented when it wasn't — silent inventory drift.

**18. Image OCR import blocks with no cancel.**
The image-import path polls the parse service up to ~180s behind a blocking spinner
(`ImportRecipeDialog.tsx` image branch) with no Cancel / "enter manually instead" escape. A slow or hung
OCR leaves the user stuck.

---

### 🟠 Medium severity — inconsistency between editors / flows

**5. Two different editing UIs for the same data.**
Inline edit (prominent "Edit" button, `RecipeDetailPage.tsx:386`) edits ingredients as an
amount/unit/name 3-field grid (`:640-681`) with no natural language / parse-link. Modal edit ("More…",
`:374`) uses the natural-language wizard. The way you *add* a recipe doesn't match the primary way you
*edit* it — two mental models for one object.

**6. "More…" opens from server state and drops in-progress inline edits.**
The modal `RecipeForm` is fed `recipe` (server data), not `draft` (`RecipeDetailPage.tsx:830`). Making
inline edits then clicking "More…" opens the modal *without* the unsaved inline changes — two diverging
drafts. "More…" with an image icon is also weak signposting for "full editor".

**7. Image and Tags can only be edited in the modal, not inline.**
Inline mode covers title/description/times/servings/ingredients/instructions but not image or tags,
forcing a context switch to the modal (`RecipeDetailPage.tsx:374`). One entity's fields are split across
two editors.

**8. Keyboard efficiency differs between editors.**
The wizard supports Enter-to-add + focus the next ingredient/instruction row
(`RecipeForm.tsx:963-973, 1136-1144`). The inline editor has no such shortcut — every row needs a click
on "Add ingredient"/"Add step" (`RecipeDetailPage.tsx:683, 589`).

**9. Auto-unlink on rename happens in the wizard but not inline.**
The wizard's `IngredientNameInput` unlinks the inventory item when you type a new name
(`RecipeForm.tsx:110-112`). Inline edit has no link UI and editing a name leaves `inventoryItemId`
attached (`RecipeDetailPage.tsx:662-670`), so name and link can drift. (Linking inline is only possible
from *view* mode via the per-row `Link2Off` popover, `:734-759`.)

**10. Empty-value representation differs.**
Add defaults `prepTime`/`cookTime` to `0`, shown as a literal "0" (`RecipeForm.tsx:589-597`); inline
edit represents unset times as blank (`RecipeDetailPage.tsx:70-72`). Empty title: inline silently coerces
to `'Untitled Recipe'` (`:204`), modal sends empty (and fails server-side).

**19. No servings scaling in Cook mode. ✓verified**
`CookModePage.tsx` has no servings/multiplier logic, yet `RecipeDetailPage.tsx:96` lets you scale
servings before cooking. The scaled amount isn't carried into cook mode and can't be re-scaled mid-cook.

**20. Timers can be created in Cook mode but nowhere else.**
`CookModePage` wires up `AddTimerDialog`, but neither the editor nor the detail page can create/edit
timers (editor-side of finding #11). Timers are display-only until mid-cook.

**21. Import advertises a step count it doesn't always show.**
The import step indicator renders a fixed step set, but the ingredient-linking step is conditional on the
advanced/catalog tier — basic-tier users see a progress bar promising a step that's silently skipped.

**22. Edits are lost on Back-navigation between import steps.**
Editing fields/ingredients in the review step then navigating Back loses those overrides (same class as
#2). Multi-step flows across this feature consistently fail to preserve in-progress edits.

**23. Bulk import has no partial-success / retry.**
A failed recipe in a batch can't be retried individually; a failure forces restarting the batch and
re-doing edits to the recipes that did parse.

**24. `GenerateShoppingListDialog` mutations have no `onError`.**
Preview/generate failures stop the spinner with no message — same missing-error-feedback pattern as #17.

**25. `FinishCookingDialog` is dismissable mid-submission.**
`onOpenChange`/X/Escape can fire `handleClose` while `isSubmitting`, abandoning the inventory write in
flight with no guard.

---

### 🟡 Lower severity — friction & dead fields

**11. `optional`, `notes`, and `timers` are effectively read-only.**
The detail view renders an "optional" badge (`RecipeDetailPage.tsx:717`), ingredient notes (`:713`), and
a Timers card (`:770-788`), and the schemas support all three — but no editor lets you set them. They can
only arrive via import, so users see data they can't change.

**12. Parse step is mandatory and does N sequential network calls.**
`handleParseIngredients` awaits `matchIngredient` once per ingredient sequentially
(`RecipeForm.tsx:526-543`) plus parse + suggest — slow for large recipes, with no "skip linking"
affordance. (Same sequential-loop pattern also exists in the import flow's item creation.)

**13. The step progress bar isn't clickable.**
Purely decorative (`RecipeForm.tsx:813-828`); fixing one instruction means clicking "Continue" three
times (re-triggering parse).

**14. No dirty-guard on dismiss.**
`Dialog onOpenChange={handleClose}` (`RecipeForm.tsx:801`) — Escape or overlay click discards the entire
multi-step form with no confirmation.

**15. Schema cruft.**
`recipeFormSchema` carries both `prepTime`/`prepTimeMinutes` (and cook variants) (`forms.ts:72-75`);
mutations defensively do `formData.prepTime || formData.prepTimeMinutes`. Only `prepTime` is registered —
the duplicate pair is legacy noise.

**26. "max 10MB" is advertised but not enforced client-side. ✓verified**
`RecipeImageInput.tsx:154` claims "JPEG, PNG, WebP, or GIF (max 10MB)" but neither `handleFileChange` nor
`handleDrop` checks size. Backend enforces it (`recipe-image.service.ts:5`, `MAX_FILE_SIZE = 10MB`), so
an oversized image is accepted, previewed, and only rejected after the whole form is submitted.

**27. File-browse path skips the image-type check. ✓verified**
`handleDrop` validates `file.type.startsWith('image/')` (`RecipeImageInput.tsx:60`) but `handleFileChange`
(`:69`) does not — it relies solely on the `accept` attribute, bypassable in the OS picker.

**28. Import-vs-manual unit handling diverges.**
The import flow preserves the parsed unit as-is; the manual form funnels units through a normalized
`UnitCombobox`. The same ingredient ("tsp" vs "teaspoon") ends up represented differently depending on
entry path.

**29. Duplicate URL-input JSX in the image control. ✓verified**
`RecipeImageInput.tsx:200-230` and `:259-288` are near-identical URL-input blocks (empty vs replace
state). A fix to one (e.g. the missing `disabled` on the second block's Cancel at `:280`) is easy to miss
in the other.

---

## Two structural themes

1. **In-progress edits/progress are routinely lost** across step transitions and reloads — #2, #3, #16,
   #22, #23, #25. Worth one deliberate pass on draft/session persistence and dirty-guards.
2. **Errors are silently swallowed** — #1 (validation bypass), #17, #24. A consistent toast-on-error
   convention fixes several at once.

---

## Remediation plan (batched)

### Batch A — Silent-error / honesty fixes (small, high-trust-impact)
- [ ] **#1** Route the final Save through `handleSubmit(handleFormSubmit, handleFormError)` so validation
      runs and inline errors render. Removes dead code at `:768`.
- [ ] **#17** Add `toast` error feedback to all three `FinishCookingDialog` handlers.
- [ ] **#24** Add `onError` toasts to `GenerateShoppingListDialog` preview/generate mutations.
- [ ] **#4** Decide difficulty: either persist it end-to-end (form → mutation → `createRecipeSchema` →
      display) or remove the control. (Recommend remove unless it'll be displayed.)
- [ ] **#26 / #27** Enforce image size + type client-side in `RecipeImageInput` before preview/upload;
      surface an inline message instead of a post-submit server rejection.

### Batch B — Persistence & dirty-guards (medium)
- [ ] **#16** Add `persist` middleware to `cookingStore` (mirror `timerStore`), persisting step/mode/
      `completedSteps`.
- [ ] **#2 / #3** Re-parse (or merge) when leaving the Ingredients step if raw text changed, instead of
      gating on `hasParsed`; guard against an empty-name fallback wiping ingredients on parse failure.
- [ ] **#14 / #25** Add dirty-guard confirmation before dismissing `RecipeForm` and block
      `FinishCookingDialog` close while `isSubmitting`.
- [ ] **#22 / #23** Preserve import overrides across Back-navigation; add per-recipe retry in bulk import.

### Batch C — Editor unification (larger, design decision needed)
- [ ] **#5–#10** Decide on a single editor. Cleanest: make inline edit the one fast path (add image/tag
      editing inline) and drop the modal wizard for *editing*, OR make the wizard the single editor for
      both add and edit. Resolves the 3-way split (inline + modal + view-mode link popovers).
- [ ] **#8 / #9** Whichever editor wins: Enter-to-add rows + auto-unlink-on-rename everywhere.
- [ ] **#11** Add editing for `optional` / `notes` / `timers` (or accept they're import-only and hide the
      view affordances).
- [ ] **#19 / #20** Carry scaled servings into cook mode; allow timer setup before cook mode.

### Batch D — Friction & cleanup (low)
- [ ] **#12** Parallelize the per-ingredient `matchIngredient` loop (`Promise.all`); add a "skip linking"
      option.
- [ ] **#13** Make the wizard step bar clickable.
- [ ] **#15** Remove the duplicate `prepTime*`/`cookTime*` schema fields.
- [ ] **#21** Make the import step indicator reflect the actual (tier-dependent) step set.
- [ ] **#28** Normalize units consistently across import and manual paths.
- [ ] **#29** De-duplicate the two URL-input blocks in `RecipeImageInput`.

---

## Notes
- Rejected during verification: "seconds-only timers blocked" (false — `AddTimerDialog.tsx:149`); an
  over-stated popover focus-trap claim.
- Suggested order: Batch A first (cheap, high trust impact), then B, then the Batch C design decision,
  then D.
