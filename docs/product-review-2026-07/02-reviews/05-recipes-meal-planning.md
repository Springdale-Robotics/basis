# Area review — Recipes & meal planning

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

**Backend** (`modules/recipes/`):
- **URL import** (`url-parser.service.ts`, 598 ln): 4-strategy ladder — JSON-LD Schema.org → `@julianpoy/recipe-clipper` (ML) → microdata → CSS heuristics — each with a completeness-based confidence score; extractors emit raw ingredient strings only.
- **Import pipeline** (`recipe-import.service.ts`, 946 ln): import sessions (24h expiry), text/PDF/image(OCR)/`.recipe`-file parsing, CRF ingredient parsing via Python sidecar (`services/ingredient-parser`), LLM fallback when confidence < 0.6, inventory matching + alias learning on confirm.
- **LLM usage** (`services/llm-recipe-parser.ts`): returns `null` when no provider configured; recipes treat null/throw as "keep the non-LLM result" — correct graceful degradation. Explicit `POST /import/:sessionId/reparse-llm` + `GET /import/status`.
- **Matching** (`ingredient-matching.service.ts`): normalization + plural stemming, ~100-entry synonym table, containment/token/Levenshtein scoring, household alias table, auto-match at ≥0.85.
- **Routes** (`recipes.routes.ts`, 2042 ln): CRUD, tags, availability, cost estimate, image upload (sharp→WebP base64 in-row), cook start/finish with FIFO stock deduction (transaction + `FOR UPDATE`), meal plans, two shopping-list generators.
- **SSRF guard** (`lib/ssrf.ts`): DNS-resolving public-address check.

**Frontend** (`pages/recipes/`): RecipesPage, RecipeDetailPage (inline edit, NL quick-add, display-only serving scaler), ImportRecipeDialog (5-step wizard with plain-English status), BulkImport, MealPlanPage, MealActionDialog, GenerateShoppingListDialog, CookModePage, FinishCookingDialog. Leftovers CRUD lives only in the inventory module — nothing in the cook flow references it.

## Usability findings

1. **Serving scaling is display-only and doesn't survive any handoff.** The +/− scaler (`RecipeDetailPage.tsx:576-611`) rescales visually, but "Start Cooking", "Add to Shopping List" (`:302-336` uses raw `ing.amount`), and cook mode's ingredient sheet all use 1×. MealActionDialog awaits a multiplier save "so the cook session reads the current servings" but CookModePage never reads it — the cook session is a client-side zustand store; the backend `POST /:id/cook` session (which carries `servingsMultiplier`) is never called.
2. **The meal-plan "cooked" checkmark is unreachable.** `cookedAt` is only set by `POST /:id/finish` with `mealPlanId`, but FinishCookingDialog never sends `sessionId`/`mealPlanId`. MealPlanPage renders cooked styling for a state no flow can produce.
3. **No cook → leftovers handoff.** Finishing offers deduction only; saving leftovers requires manually opening Inventory's LeftoverForm, despite `leftovers.sourceRecipeId` existing.
4. **"Add to Shopping List" from a recipe bypasses all merging** — fires N parallel plain inserts (no dedupe), while the meal-plan generator has careful unit-converting merge logic. Inconsistent behavior for the same intent.
5. **"Re-parse with AI" gives no feedback and shows when no LLM exists.** Failure is `console.error` only; the button renders regardless of `GET /import/status`. A family without an LLM clicks it and nothing happens.
6. **Good:** import wizard's plain-language status ("Looks complete" / "Review carefully"), the honest degraded-CRF warning, dirty-close guards, NL quick-add. URL success rate is high for mainstream sites (JSON-LD).
7. Minor: tag filtering happens in memory after pagination (acknowledged TODO); GenerateShoppingListDialog default inconsistency across opens.

## Reliability findings

1. **HIGH — SSRF guard is bypassable via redirect.** `assertPublicUrl` validates only the initial URL; both fetches use default `redirect: 'follow'` (`url-parser.service.ts:36`, `recipe-image.service.ts:84`). A public URL that 302s to `169.254.169.254` or `127.0.0.1:11434` is followed freely. Fix: `redirect: 'manual'` loop re-asserting each hop.
2. **HIGH — cook-flow deduction always runs at 1× and meal plans never complete** (frontend never sends `sessionId`/`mealPlanId` — see usability #1/#2). A recipe scaled to 2× under-deducts inventory by half. The deduction transaction itself (`FOR UPDATE`, FIFO, conversion-bail) is well done.
3. **HIGH — user-modified units during import are silently discarded.** Frontend sends `modifiedUnit` but the route schema omits it (`recipes.routes.ts:1203-1209`) so Zod strips it; `updateIngredientMatches` then writes `undefined`, also clobbering any stored value. The whole feature is dead through this endpoint.
4. **MEDIUM — meal-plan shopping list drops the last day of the week for UTC+ timezones.** `GenerateShoppingListDialog.tsx:43-44` uses `toISOString().split('T')[0]` on local-midnight Dates → Sat–Fri instead of Sun–Sat. MealPlanPage's correct `formatLocalDate` exists two files away.
5. **MEDIUM — "Re-parse with AI" on URL imports feeds the LLM the URL string, not page text** (`recipes.routes.ts:1231` uses `session.sourceData` = the URL; `pageText` is never persisted). Garbage/failure on the most common import type.
6. **MEDIUM — non-transactional multi-step writes.** Recipe PATCH deletes all ingredients then inserts (`:462-474`); `confirmImportSession` does recipe→ingredients→aliases→session with no transaction; create-recipe similarly.
7. **MEDIUM — editing a recipe wipes ingredient groups.** Create/update schemas carry no `groupName`; the PATCH re-insert doesn't set it, while the inline editor always resubmits ingredients. Cook mode's grouped sheet depends on this field.
8. **MEDIUM — `/import/start` and `/import/start-batch` do server-side URL fetches with no rate limit** (guarded only on `parse-url`); batch accepts an unbounded `entries` array processed sequentially in one request.
9. **MEDIUM — URL-import fetch has no timeout or response-size cap** (the image fetcher has 30s abort + 10MB check, but its body read is unbounded when `content-length` is absent).
10. **LOW — cost estimate uses the oldest price, not newest** (`.orderBy(inventoryStock.addedAt)` asc). **LOW — `POST /:id/cook` and `GET /cooking/:sessionId` have no household scoping** (low impact; UI never uses them). **LOW — LLM fallback erases warnings and hardcodes confidence 0.85.**
11. Positive: the "no silent regex fallback" decision (CRF failure returns raw lines + explicit warning) is a sound reliability posture.

## Test coverage

Effectively absent. `crf-ingredient-parser.test.ts` (10 edge cases) hits the *live* sidecar and `skipIf` when unreachable → zero run in CI without the Python service. `lib/units.test.ts` (16 tests) is valuable for deduction/merge math. **Zero tests** for URL parser strategies, import service (sectioning/confidence/lifecycle), ingredient matching (pure functions, ideal targets), shopping-list merging, `lib/ssrf.ts`, finish-cooking deduction, all routes, and all frontend. Several bugs above are exactly the class a thin unit/route layer would catch.

## Top 5 recommendations

1. **Wire the cook flow end-to-end** — pass `mealPlanId` + servings multiplier from MealActionDialog → CookModePage → FinishCookingDialog → `/finish` (or delete the unused backend session endpoints). Fixes 1× under-deduction, the unreachable "cooked" state, and unscaled cook-mode ingredients at once.
2. **Close the SSRF redirect hole and bound URL fetches** — `redirect: 'manual'` with per-hop `assertPublicUrl`, a timeout + size cap, and rate limiting (+ entries cap) on `/import/start` and `/import/start-batch`.
3. **Fix the silent data-loss trio** — add `modifiedUnit` to the match schema (preserving stored values), add `groupName` to recipe ingredient schemas, and wrap create/update/confirm in transactions.
4. **Fix date serialization in GenerateShoppingListDialog** (reuse `formatLocalDate`), and persist `pageText` on URL import sessions so `reparse-llm` re-parses the page.
5. **Add tests for the pure core** — text sectioning/confidence, ingredient normalization/similarity, URL-parser helpers against fixtures, shopping-list merge math, `assertPublicUrl`; mock the CRF service so its suite runs in CI. Unify recipe-detail "Add to Shopping List" with the merge-aware generator.
