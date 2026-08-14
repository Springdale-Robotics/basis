# Recipe Import Pipelines — Robustness & Foundation Review

**Date:** 2026-08-14
**Scope:** every import path — text, URL, PDF, image/OCR, `.recipe` file, bulk/batch, and the manual `RecipeForm` path — plus the ingredient→inventory matching and item-creation machinery behind them.
**Frame:** a non-technical user creating a brand-new household and importing their whole recipe collection on day one. Those imports are where most inventory links originate, so a mistake here becomes the permanent shape of their data.

## Method

This is not a read-only review. Findings below were verified by running the code:

- **Unit probes** against `ingredient-matching.service.ts` (normalization + similarity tables, synonym-table reachability).
- **Route-level end-to-end probes** through the real Fastify app + real Postgres + the live CRF parser service (`homemanager-vlm-llm-dev` on :8000) — 16 scenarios covering both bulk and single import paths, alias learning, cross-household links, override edits, batch failure.
- **A locally served JSON-LD recipe page** to exercise the URL pipeline (recipe sites are blocked by the sandbox proxy).
- **A real browser walkthrough (Playwright)** of a freshly created empty household, driving the actual import dialog — including a full image/OCR import of `working/testrecipe7-printed.jpg` against the live VLM, compared line by line against the source image.
- **Not tested:** PDF text extraction (`services/pdf-extraction.ts`). The PDF path was reviewed from the extracted-text handoff onward, where it merges into the text pipeline.

The console-log probes written for this review have since been replaced by an
asserting regression suite in `backend/test/recipes/` (see §4), so they are no
longer kept separately. A `Day One Household` was left in the dev DB as
evidence.

**Status: every finding below has been fixed on the `recipe-import-hardening`
branch.** The text is left in the past tense as the record of what was wrong
and why; each fix carries the reasoning in its commit message.

---

## 0. Verdict

The parsing layer is genuinely good. CRF extraction is accurate, the "no silent regex fallback" policy is the right call, the synonym table carries real weight on pantry staples, and the SSRF guard is in place. **The problem is everything downstream of parsing.**

For the stated scenario — non-technical user, day one, whole collection — the pipeline currently produces:

| | Result |
|---|---|
| Default (Basic tier) | **Zero** inventory links, **zero** catalog items, from any number of recipes |
| Advanced tier, "Create all unmatched" | Catalog items named `boneless, skinless chicken breasts`, `extra-virgin olive oil`, with default units `cloves` / `can` / `tablespoon` and no categories |
| Bulk URL import | Catalog items named `2 tablespoons extra-virgin olive oil`, presented as **100% confidence, "Looks complete"** |
| Learned corrections | Written to the DB, then **never read back** |
| Corrections the user never made | Written permanently, invisibly, with no UI to inspect or undo |

Each of these is fixable, and several are one-line fixes. But shipped as-is to heavy use, the first few hundred recipes will produce a catalog that has to be manually rebuilt.

---

## 1. Foundation blockers

### 1.1 A brand-new household never sees the linking step at all

`frontend/src/hooks/useInventoryTier.ts:19` — `tier = inventorySettings?.tier ?? 'basic'`. A new household has no `settings.inventory`, so it is Basic. `ImportRecipeDialog.tsx:637-648` then builds the step list **without** the `Link` step, and `:1298-1302` routes Review → Save directly.

Verified in the browser on a fresh household: the dialog header reads `Source → Review → Save`. After importing a full recipe:

```
recipe_ingredients:  6 rows, all with inventory_item_id = NULL
inventory_items:     0
```

This is the default configuration. The user described in the brief — importing their collection to seed their household — gets no foundation whatsoever unless they first discover a settings toggle they have no reason to look for.

**Recommendation.** Either default new households to Advanced, or make the first import offer the choice in-flow ("Track what's in your kitchen? We'll build your item list as you import"). Basic tier skipping linking is a defensible product decision; silently defaulting the foundation-building flow to "build no foundation" is not.

### 1.2 Bulk URL import skips ingredient parsing entirely and reports 100% confidence

The highest-severity defect, and it sits on the path a user importing 40 bookmarked recipes will take.

`BulkImportRecipeDialog.tsx:141-146` calls `recipesApi.parseUrl()` per URL, then wraps the result in a `.recipe` envelope:

```js
const fileData = { version: '1.0', type: 'recipe', recipe: result.parsedRecipe };
```

But `/import/parse-url` (`recipes.routes.ts:1105-1115`) returns `parseRecipeFromUrl()` output verbatim, and that function deliberately emits **raw unparsed strings** (`url-parser.service.ts:9-11`, `rawIngredient()`); CRF normally runs later inside `processUrlImportSession`. When the envelope hits `processImportSession`, `parseRecipeFileFormat` matches (`recipe-import.service.ts:576-580`), sets `confidence = 1.0` / `parseMethod = 'json-ld'`, and **returns before the CRF step**, which lives in the `else` branch.

Measured, same page, both paths:

```
[PROBE 18] SINGLE-URL path (CRF runs):
    "extra-virgin olive oil"   qty=2  unit=tablespoon
    "ground beef"              qty=2  unit=pound
    "crushed tomatoes"         qty=1  unit=can

[PROBE 18] BULK-URL path (.recipe envelope, CRF skipped):
    "2 tablespoons extra-virgin olive oil"   qty=-  unit=-
    "2 pounds ground beef"                   qty=-  unit=-
    "1 (28 ounce) can crushed tomatoes"      qty=-  unit=-
```

And the session the user reviews:

```
[PROBE 1] parseMethod=json-ld confidence=1.0000 warnings=[]
[PROBE 1] matches: all unmatched
```

`getParseStatus` (`ImportRecipeDialog.tsx:63-83`) renders that as **"Looks complete"**. The user is then offered *"Create all unmatched as items"* — which will create inventory items literally named `2 tablespoons extra-virgin olive oil`. Every quantity in the recipe is also lost, so shopping-list generation and cook-mode deduction have nothing to work with.

**Fix.** Two options, both small: (a) have bulk URL mode call `startBatchImport` with `sourceType: 'url'` and let `processUrlImportSession` do its job — the envelope wrapper exists only to reuse the text path; or (b) run `parseIngredientLinesViaCRF` on `.recipe` imports whose ingredients arrive with no `quantity`/`unit`. (a) is correct; (b) is the safety net, since hand-authored `.recipe` files hit the same hole.

### 1.3 Nothing anywhere prevents duplicate catalog items

`POST /inventory/items/quick-create` (`inventory.routes.ts:753-781`) and `POST /inventory/items/batch` (`:784-...`) insert unconditionally. There is no per-household unique index on `inventory_items.name` — `backend/src/db/schema/inventory.ts` declares unique indexes for custom units and ingredient aliases, but not item names. `handleCreateAllUnmatched` (`ImportRecipeDialog.tsx:613-627`, `BulkImportRecipeDialog.tsx:277-289`) loops `quick-create` over every unmatched row.

Measured — four calls, four items, no warning, no error:

```
[PROBE 3] items now in catalog: [ 'Olive Oil', 'olive oil', 'Olive oil', 'extra virgin olive oil' ]
```

The duplicate warning is **not missing from the codebase** — it is unreachable. `POST /recipes/ingredients/suggest-items` (`recipes.routes.ts:334-372`) already returns `similarExisting` via `findSimilarItemName`, and the `quick-catalog` step in `ImportRecipeDialog.tsx:1373-1500` renders it as a *"Similar to: X"* badge with create/link buttons. But `setStep('quick-catalog')` is **never called** — the only reference sets `catalogSuggestions` to `[]` and jumps to `confirm` (`:1298-1302`). ~200 lines of the right solution are dead code.

Worse, duplicates get created *within a single sitting*. `IngredientMatchRow` caches per-name suggestions with `staleTime: 60000` (`IngredientMatchRow.tsx:105-109`) and prefers the query result over the session's `match.suggestions`, so an item created for row 3 is not visible to row 12. And across recipes, the 0.85 auto-match threshold is too tight for this:

```
[PROBE 15] second recipe, matched against the catalog the first recipe just built:
   "unsalted butter" -> matched (1.00)
   "garlic"          -> matched (1.00)
   "olive oil"       -> unmatched   top suggestion: extra-virgin olive oil @0.80
```

That third row is a duplicate about to be born, three minutes after the original.

### 1.4 Item names and units are taken raw from recipe text — while a canonicalizer sits unused

`handleCreateNewItem` passes `match.parsedName` and `match.parsedUnit` straight through. Actual catalog after one "Create all unmatched", measured:

```
[PROBE 14] "unsalted butter"                     defaultUnit="tablespoon"  category=null
           "boneless, skinless chicken breasts"  defaultUnit=null          category=null
           "crushed tomatoes"                    defaultUnit="can"         category=null
           "garlic"                              defaultUnit="cloves"      category=null
           "extra-virgin olive oil"              defaultUnit="cup"         category=null
```

`/recipes/ingredients/suggest-items` — same input, same request, already implemented, already wired into the manual `RecipeForm` path — returns:

```
[PROBE 14] "unsalted butter"                     -> "Butter"          cat="Dairy & Eggs"
           "boneless, skinless chicken breasts"  -> "Chicken Breast"  cat="Meat"
           "crushed tomatoes"                    -> "Crushed Tomato"  cat="Canned Goods"
           "garlic"                              -> "Garlic"          cat="Produce"
           "extra-virgin olive oil"              -> "Olive Oil"       cat=undefined
```

Confirmed in the browser too: one click on "Create all unmatched as items" produced `unsalted butter/tablespoon`, `garlic/cloves`, `olive oil/tablespoon`, `crusty bread/loaf`, `Salt/(none)`.

Two separate problems:
1. **Names.** Recipe phrasing is not catalog phrasing. `simplifyIngredientNames` (`services/ingredient-name-utils.ts:72-83`) already does CRF + descriptor stripping + singularize + title-case.
2. **Units.** A recipe unit is a *usage* unit; an item's `defaultUnit` is a *stocking* unit. Butter is not stocked in tablespoons, garlic is not stocked in cloves, tomatoes are not stocked in cans-as-a-unit-of-measure. The other creation path is no better — the quick-catalog step hardcodes `defaultUnit: 'pieces'` (`ImportRecipeDialog.tsx:282`). Recipe units belong in `quantityUnitSizes`, not `defaultUnit`; better to leave `defaultUnit` unset than to guess wrong, since a wrong default silently corrupts every later conversion.

**Recommendation.** Route every import item-creation through `suggest-items`, and surface it as a reviewable list before creating — which is exactly what the dead `quick-catalog` step was built to do. `RecipeForm.tsx:490-535` already demonstrates the pattern working end to end; the import dialog should reuse it rather than re-implement a worse version.

### 1.5 Learned aliases are stored in a form that can never be looked up

`confirmImportSession` writes `aliasName: normalizeIngredientName(match.parsedName)` (`recipe-import.service.ts:892, 909-914`). `findAliasCandidates` looks up with `ingredientName.toLowerCase().trim()` and nothing else (`ingredient-matching.service.ts:21, 31-34`). Whenever normalization changes the string — which is the entire point of normalization — the write and the read disagree.

Measured round-trip:

```
[PROBE 12] first import parsed names: [ 'capers', 'chili flakes' ]
           user links "capers" -> item "Caper Berry"
           alias row stored as: "caper"
           name it will be looked up by next time: "capers"
[PROBE 12] second import matches: [ 'capers -> unmatched', 'cream -> unmatched' ]
```

The user taught the system something and the system did not learn it. This is the single mechanism by which the catalog is supposed to get smarter as more recipes are imported, and it is inert. It hides behind the synonym table for common staples (a `scallions` probe *did* match — via `INGREDIENT_SYNONYMS`, not via the alias), which is why it has gone unnoticed.

**Fix.** Normalize on read: `eq(ingredientAliases.aliasName, normalizeIngredientName(ingredientName))`. One line. Add a test that stores an alias and reads it back.

### 1.6 Auto-matches the user never touched become permanent, invisible aliases

`handleSaveMatches` (`ImportRecipeDialog.tsx:584-593`) posts **every** row back, including untouched auto-matched ones. `updateIngredientMatches` (`recipe-import.service.ts:790-803`) stamps `matchStatus: 'manual'` on anything with a `matchedItemId`. `confirmImportSession` then treats `matchStatus === 'manual'` as user intent and writes an alias (`:890-919`).

Verified through the actual browser flow — the user clicked "Continue to Save" and "Create Recipe", nothing else:

```
alias_name             | canonical        | alias_type
-----------------------+------------------+-----------
 butter                | unsalted butter  | exact
 extra virgin olive oil| olive oil        | exact
 kosher salt           | Salt             | exact
```

`butter → unsalted butter` is a real semantic error for any household that stocks both, and it is now permanent. There is **no UI anywhere in the frontend to view, edit, or delete ingredient aliases** (grep confirms: no component references them). Every wrong fuzzy auto-match the user clicks past is silently promoted to a permanent rule they cannot see or undo.

**Fix.** Distinguish "user explicitly chose this" from "the matcher guessed and the user didn't object": either keep `matchStatus: 'matched'` for untouched rows in `updateIngredientMatches`, or add an explicit `userConfirmed` flag and gate alias creation on it. Then add alias management to inventory settings — learned data the user can't inspect is a liability.

### 1.7 Normalization strips the words that distinguish different items

`normalizeIngredientName` (`ingredient-matching.service.ts:189`) removes `fresh|dried|canned|cooked|ground|whole|crushed|diced|…`. Two ingredients that differ *only* by such a word normalize to the same string and score **1.0 "exact"**, which is above the 0.85 auto-link threshold.

Measured:

```
canned chickpeas    | dried chickpeas   | 1.000 | exact | AUTO-LINK
dried oregano       | fresh oregano     | 1.000 | exact | AUTO-LINK
crushed tomatoes    | canned tomatoes   | 1.000 | exact | AUTO-LINK
cooked rice         | rice              | 1.000 | exact | AUTO-LINK
```

Confirmed live: a recipe calling for `canned chickpeas` auto-linked at 100% "Exact match" to an item named `Chickpeas (dried)`. For a household tracking stock, these are different items with different units, different shelf lives, and a 3× weight difference.

Two related defects in the same function:

**Plural stemming corrupts words.** `.replace(/ves$/i, 'f')` is meant for `halves→half`, `leaves→leaf`. It also produces:

```
"olives"        -> "olif"
"cloves"        -> "clof"
"garlic cloves" -> "garlic clof"
"knives"        -> "knif"
```

So `olives` never matches `olive` (0.33 fuzzy) and `garlic cloves` is mangled.

**13 of 99 synonym-table entries are unreachable**, because lookup happens *after* normalization and normalization rewrites the key:

```
'ground beef'   -> 'beef'          'crushed tomato' -> 'tomato'
'minced beef'   -> 'beef'          'diced tomato'   -> 'tomato'
'ground pork'   -> 'pork'          'garlic cloves'  -> 'garlic clof'
'ground turkey' -> 'turkey'        'shallots'       -> 'shallot'
'ground chicken'-> 'chicken'       'onions'         -> 'onion'
'minced pork'   -> 'pork'          'eggs'           -> 'egg'
'whole milk'    -> 'milk'
```

**Recommendation.** Split normalization into two levels: an *identity* normalization (case, punctuation, plurals) used for matching, and a *descriptor* normalization used only for display/canonical naming. Preservation state (`fresh`/`dried`/`canned`/`frozen`) should be a distinguishing attribute, not noise. At minimum: require ≥0.95 *plus* preservation-state agreement to auto-link, replace the `ves$` rule with a small exception list, and normalize the synonym table keys at module load with an assertion that catches drift.

---

## 2. Correctness and data integrity

### 2.1 `parsedName` is the join key between ingredients and matches — and it is not stable

`confirmImportSession:870` finds the match with `ingredientMatches.find(m => m.parsedName === ing.name)`. If the user edits an ingredient name on the confirm screen (the review step's name fields are editable, and `confirm` accepts an `ingredients` override), the join fails silently:

```
[PROBE 8] matches before:  'basmati rice -> Basmati Rice'   (auto-matched)
          user renames to  'basmati rice (rinsed)'
          stored rows:     'basmati rice (rinsed) -> item NULL'
```

The link is gone with no warning. The same key collapses two identical ingredient lines in one recipe onto a single match. **Fix:** carry a stable index or id from parse through match to confirm.

### 2.2 Ingredient groups are lost on every text/image import

`parseRecipeTextWithConfidence` pushes the *same object references* into both `ingredients` and `ingredientGroups` (`recipe-import.service.ts:226-230`). `processImportSession:594` then **replaces** `parsedRecipe.ingredients` with fresh CRF objects but leaves `ingredientGroups` pointing at the old raw-line objects. `confirmImportSession` keys `ingredientGroupMap` by name (`:855-864`), so every lookup misses.

```
[PROBE 4] parsed ingredientGroups: [{name:"the sauce", ingredients:[{name:"2 cups tomato puree"}, …]}]
[PROBE 4] parsed ingredients:      [{name:"tomato puree", quantity:2, unit:"cup"}, …]
[PROBE 4] stored rows:
   tomato puree | qty=2 | unit=cup        | group=null
   oregano      | qty=1 | unit=teaspoon   | group=null
   breadcrumbs  | qty=1 | unit=cup        | group=null
   butter       | qty=2 | unit=tablespoon | group=null
```

"For the sauce / For the topping" — visible in the source, parsed correctly, detected correctly, discarded at the last step. (The LLM path happens to work, since it rebuilds both arrays consistently.)

### 2.3 `sourceUrl` is dropped on import

`confirmImportSession:839-852` inserts `title, description, instructions, prep/cook, servings, imageUrl` — and not `sourceUrl`, `author`, `cuisine`, or `tags`, all of which the parsers populate and the schema has columns for.

```
[PROBE 9] stored sourceUrl=null  imageUrl="https://example.com/pic.jpg"  tags=[]
```

Import 200 recipes from the web and none of them remember where they came from. For a foundational data set that is a meaningful loss — no way to re-import, re-check, or attribute.

### 2.4 A match update accepts an inventory item from another household

`updateIngredientMatches` never validates that `matchedItemId` belongs to the caller's household, and `confirmImportSession` writes it straight into `recipe_ingredients.inventory_item_id`. The RLS policy on `recipe_ingredients` scopes by the parent recipe's household, so it does not block a foreign FK value.

```
[PROBE 7] match update status: 200
          confirm status: 200
          stored links: 'saffron -> item 43108cde-…'
          foreign item id was:   43108cde-…
```

This is the same class as the `defaultAreaId` bug fixed in PR #65 — a caller-supplied id written without an ownership check, with no RLS backstop on that specific column. Requires a guessed UUID, so severity is low, but the fix is the established one: verify the id against `householdId` in `updateIngredientMatches` (and in `PATCH /:id/ingredients/:ingredientId/link`, `recipes.routes.ts:384-392`, which also filters only by `ingredientId + recipeId`).

### 2.5 Confirm is not transactional; batch confirm fails half-done

`confirmImportSession` runs recipe insert → ingredients insert → alias loop (an N+1 query per match) → status update as separate statements. A failure between them leaves a recipe with no ingredients, or a confirmed recipe whose session still says `pending_review`.

`confirm-batch` loops sequentially and throws on the first failure, keeping everything already committed:

```
[PROBE 11] confirm-batch status: 400 "Session is not in pending_review status"
           recipes actually created: [ 'Batch Recipe One' ]
           session statuses: [ 'confirmed', 'cancelled', 'pending_review' ]
```

One of three saved, one skipped, and the client got a flat error with no per-item results. For a 40-recipe batch this is the difference between "retry" and "figure out which 17 of my 40 saved". `start-batch` and `rematch-batch` have the same shape.

**Fix.** Wrap `confirmImportSession` in a transaction; make the batch endpoints return per-session `{sessionId, status, recipeId|error}` and never abort the whole batch on one bad item.

### 2.6 The Basic-tier confirm screen reports "0 ingredients total"

`ImportRecipeDialog.tsx:1531` renders `{ingredientMatches.length} ingredients total`, but `ingredientMatches` is only populated by `handleProceedToIngredients`, which Basic tier skips. Observed in the browser on a 6-ingredient recipe:

```
Ready to Import
Grandma's Tomato Pasta
0 ingredients total
```

The recipe saves correctly with all 6. But the last screen before the commit button tells the default user their import found nothing — the single most discouraging possible message at that moment.

---

## 3. Robustness

### 3.1 Outbound URL fetch has no timeout, no size cap, no post-redirect revalidation

`url-parser.service.ts:36-41` calls bare `fetch(url)` — no `AbortSignal`, no `content-length` check, no `content-type` check. Measured against a server that accepts the connection and never responds:

```
[PROBE 19] after 7999ms: STILL HANGING after 8s
```

The sibling image fetcher gets this right (`recipe-image.service.ts:79-104`: 30s abort, content-type check, size cap) — the URL parser should match it. Note also that `assertPublicUrl` validates only the *initial* URL; `fetch` follows redirects by default, so a public host redirecting to `169.254.169.254` is not re-checked. `lib/ssrf.ts:14-18` already acknowledges the DNS-rebind TOCTOU limit; the redirect case is more practical and is closable with `redirect: 'manual'` plus a re-validating loop.

### 3.2 The expensive endpoints are the unthrottled ones

`importRateLimiter` (20/min) is applied to `/import/parse-url` and the image route only (`recipes.routes.ts:26, 504, 1097`). **`/import/start` and `/import/start-batch` — which perform the same outbound fetch, plus CRF, plus a possible LLM call — have no limiter.** `start-batch`'s `entries` array has no `.max()` (`:1367-1372`), and the handler loops sequentially inside one HTTP request. Paste 200 URLs and the server does 200 serial unbounded fetches while the request hangs.

Measured LLM cost on the fallback path: a single low-confidence text import took **10,091 ms** inside `/import/start`. Serially, across a batch, that is minutes of one held connection.

**Fix.** Apply the limiter to `start`/`start-batch`, cap `entries` (25 is consistent with the 50-item cap on `/items/batch`), and move batch processing to a job with progress reporting — `image-parse.worker.ts` and `receipts.worker.ts` already establish the pattern.

### 3.3 Failed imports leave unusable sessions with no recovery path

`import_status` has no `failed` state (`db/schema/recipes.ts:127-132`). When processing throws, the route 500s and the row stays `parsing` forever:

```
[PROBE 10] bad-url start status: 500 {"code":"SYS_5004","message":"Internal server error"}
[PROBE 10] session statuses: [ …, 'url:parsing' ]
```

The user sees "Internal server error" for what is usually "that page isn't a recipe" — `parseRecipeFromUrl`'s useful message is swallowed. There is no retry, no resume, no way back to that session.

Conversely, garbage input succeeds:

```
[PROBE 10] status=pending_review confidence=0.1000 warnings=["No ingredients found","No instructions found"]
           parsedRecipe: {"title":"aaaa","ingredients":[],"instructions":[]}
```

`confirm` will happily create an empty recipe. Nothing blocks committing a recipe with zero ingredients and zero instructions.

**Fix.** Add a `failed` status with the error message stored, catch-and-record instead of throwing out of `/import/start`, surface the real parser message, and refuse (or hard-warn on) confirming an empty recipe.

### 3.4 Import sessions are never cleaned up

`cleanup.worker.ts` prunes auth sessions, notifications, audit log, leftovers, and receipt scans — but not `recipe_import_sessions`. `expiresAt` is set at creation (`recipe-import.service.ts:410-411`) and only ever checked on read (`:772`). Rows persist forever, each holding the full `source_data` — for PDFs, a base64 blob up to 10 MB. A bulk import of 40 recipes leaves 40 permanent rows carrying their full source. Receipts already solved this (`cleanup.worker.ts:136`); recipes should reuse it.

Related: the 24-hour expiry is short for the target scenario. A user reviewing 40 imported recipes over an evening and finishing the next morning gets `Import session has expired` on a session they were mid-way through.

### 3.5 The LLM fallback is trusted unconditionally and erases the warnings

`recipe-import.service.ts:605-619` (and the URL twin at `:695-708`): on any non-null LLM result it replaces the parsed recipe, hardcodes `confidence = 0.85`, sets `parseMethod = 'llm'`, and **`warnings = []`**. `parseRecipeWithLLM` (`services/llm-recipe-parser.ts:82-89`) validates only that `title`, `ingredientGroups`, and `instructions` are present — no check that quantities are numbers, that units are known, that names are non-empty, or that ingredient count is plausible.

So the least reliable path produces the second-highest confidence score and discards the very warnings that would tell the user to look closely. `/import/:sessionId/reparse-llm` (`recipes.routes.ts:1252-1294`) does the same. At minimum: validate shape and unit vocabulary, keep pre-existing structural warnings, and add an explicit "AI-generated — please check quantities" warning rather than clearing the list.

### 3.6 The confidence signal is inverted in practice

`CRF_CONFIDENCE_FLOOR = 0.75` (`recipe-import.service.ts:494`) sits just under the 0.8 "Looks complete" cutoff in `getParseStatus`. Result, observed in the browser on a cleanly-parsed recipe where CRF got every field right:

> **Review carefully** — *Parsed via ingredient parser (75% confidence)*

Meanwhile the bulk-URL path from §1.2, whose output is unusable, shows **"Looks complete" at 100%**. The badge is worse than no badge: it cries wolf on good imports and reassures on the broken one. Either raise the CRF floor above 0.8 when CRF returns high per-line confidence (the service returns ~0.99 per line — that data is discarded today, `recipe-import.service.ts:529-534`), or derive the badge from concrete signals (how many ingredients have quantities, are any names longer than ~40 chars) rather than a synthetic score.

### 3.7 The image path paraphrases instead of transcribing, and says nothing about it

Tested end to end in the browser with `working/testrecipe7-printed.jpg` (a clean, printed, high-contrast recipe card — the easy case). Wall clock ~90s for one photo. Ingredient extraction was largely good, but comparing the result against the source image:

| Source image | What the user gets |
|---|---|
| `2 1/2 cups half and half` | ingredient named **`and half milk`**, qty 2.5, unit cup |
| `4 cups shredded medium cheddar cheese` | `cheddar cheese` — "medium" dropped; OCR text carried `((shredded, divided, (measured after shredding)))` with nested parens |
| Prep 20 mins / Cook 15 mins / Servings 8–10 | **all three fields empty** |
| 8 instruction steps | **7 steps** |
| Step 3: "shred cheeses and toss together, then divide into three piles" | **step absent entirely** |
| Step 5: "…consistency of a semi thinned out condensed soup" | "…thickened to a very smooth consistency" |
| Step 6: "stir in another 1 1/2 cups of cheese" | "stir in 1.5 cups of **remaining shredded cheddar** cheese" |
| Step 8: "the last 1 1/2 cups of cheese" | "the last 1.5 cups of shredded **Gruyere**" |

The instructions were *rewritten*, not transcribed. Someone cooking from this recipe divides their cheese wrong and tops with the wrong cheese. `and half milk` becomes a catalog item. And the badge read the same **"Review carefully (75%)"** as a text import where CRF got every field perfect — nothing distinguishes them.

The OCR-review textarea (`ImportRecipeDialog.tsx:495-536`, `formatOcrForEditing`) is the right mitigation and is well built: the user *can* fix all of this before parsing. But the flow gives no reason to suspect anything needs fixing, and a non-technical user will not diff seven paragraphs against the photo. At minimum the OCR review step should say plainly that the text was AI-transcribed and may have been reworded — the one place in the flow where "read this carefully" is genuinely warranted is the one place it isn't said.

Also note the throughput: ~90s per photo, foreground-polled with a 3-minute per-image timeout (`ImportRecipeDialog.tsx:506`). Forty recipe-card photos is roughly an hour with the dialog open — another argument for moving batch work to a job (§3.2).

### 3.8 Per-row match requests scale badly

Each `IngredientMatchRow` issues its own `POST /ingredients/match` (`IngredientMatchRow.tsx:105-109`), and each such call re-queries the household's entire inventory (`matchSingleIngredient`, `ingredient-matching.service.ts:472-474`). A bulk review with 200 deduped ingredients is 200 requests, each doing a full catalog scan and an O(n·m) Levenshtein sweep. The session already carries `match.suggestions` from the server — the row should prefer it and refetch only on demand. `matchSingleIngredient` already accepts a pre-fetched catalog; the batch path should use it.

Also, `matchIngredients` re-fetches the full inventory once per session, so `start-batch` over 40 recipes performs 40 identical catalog loads.

### 3.9 Frontend and backend normalization have diverged

`frontend/src/lib/recipe-utils.ts:83-93` says it "mirrors the backend's `normalizeIngredientName()`", and does not: it strips everything after a comma (backend doesn't) and does **no plural stemming** (backend does). Since bulk import dedupes with the frontend version (`BulkImportRecipeDialog.tsx:235`), `onions` and `onion` appear as two separate rows to review, and the fan-out in `handleMatchUpdate` only reaches one of them. Two implementations of a matching rule will keep drifting — move it to a shared module or expose it as an endpoint.

---

## 4. Test coverage

There is effectively none for this subsystem:

- `backend/test/recipes/` contains exactly one file, `cook-finish.test.ts`.
- `backend/src/services/crf-ingredient-parser.test.ts` covers the CRF client and skips when the service is down.
- **Zero tests** for `ingredient-matching.service.ts`, `recipe-import.service.ts`, `url-parser.service.ts`, or any import route.

Compare `backend/test/receipts/` — eleven files including a dedicated line-matcher, line-normalizer, structurer, confirm, links, cleanup, and tenancy suite. The receipt pipeline solves a near-identical problem (noisy text → canonical item → learned link) and is thoroughly tested; the recipe pipeline, which the brief says will carry more load, is not tested at all. Several findings above (§1.5, §1.7, §2.2) are exactly what a first round of unit tests would have caught.

**Since fixed.** `backend/test/recipes/` now holds 68 asserting tests across
matching, normalization, alias learning, parsing, confirm, batch behaviour,
item creation, parse quality and tenancy, plus `backend/test/lib/safe-fetch.test.ts`
for the outbound-fetch guards. Tests needing the CRF service skip cleanly when
it's unreachable, following the pattern already used by
`crf-ingredient-parser.test.ts`.

---

## 5. What's working well

Worth stating, because the fixes should not disturb it:

- **CRF extraction quality is high.** `2 cups all-purpose flour, sifted` → `{name: "all-purpose flour", quantity: 2, unit: "cup", notes: "sifted"}`, ~0.99 confidence, ~1.2s for a full recipe.
- **The "no silent regex fallback" policy is right** (`recipe-import.service.ts:508-518`) and the reasoning in the comment is sound. Degrading loudly beats guessing.
- **The synonym table pulls real weight.** Live: `extra virgin olive oil → olive oil`, `butter → unsalted butter`, `Kosher salt → Salt` all auto-linked correctly on a second recipe.
- **`RecipeForm`'s parse→suggest→link/create flow** (`RecipeForm.tsx:474-560`) is the best implementation in the codebase — CRF parse, `suggest-items` canonicalization, `similarExisting` duplicate warning, auto-link at ≥0.8, per-row create/link choice. The import dialog should adopt it wholesale rather than each surface reinventing this.
- The SSRF guard, the dirty-close confirmation, and the cross-recipe ingredient dedup in bulk review are all thoughtful.

---

## 6. Suggested order of work

**Before heavy use — these change what data gets created:**

1. Fix the bulk-URL CRF bypass (§1.2). Highest damage, smallest fix.
2. Normalize alias lookups (§1.5). One line.
3. Stop promoting untouched auto-matches to aliases (§1.6).
4. Decide the default-tier question (§1.1) and fix the "0 ingredients" counter (§2.6).
5. Route import item-creation through `suggest-items`, and un-orphan the `quick-catalog` step so the duplicate warning is reachable (§1.3, §1.4).
6. Stop seeding `defaultUnit` from recipe units (§1.4).

**Next — correctness:**

7. Stable ingredient↔match keys (§2.1); groups (§2.2); `sourceUrl` (§2.3).
8. Transaction around confirm; per-item results from batch endpoints (§2.5).
9. Tighten normalization: preservation-state guard, `ves$` fix, synonym-key assertion (§1.7).
10. Validate `matchedItemId` ownership (§2.4).

**Then — robustness:**

11. Fetch timeout + size cap + redirect revalidation (§3.1).
12. Rate-limit and cap the batch endpoints; move batch work to a job (§3.2).
13. `failed` session status with real error messages; block empty-recipe confirm (§3.3).
14. Import-session cleanup; longer expiry (§3.4).
15. Validate LLM output; keep warnings (§3.5); fix the confidence badge (§3.6); warn that OCR text is AI-transcribed (§3.7).

**Throughout:** add tests as each is fixed. `backend/test/receipts/` is the model to copy.
