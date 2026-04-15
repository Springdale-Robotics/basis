# Recipe Parsing System — Deep Analysis & Improvement Plan

**Date:** 2026-04-14

## Current System Summary

We have a 4-strategy URL parser (JSON-LD → RecipeClipper → Microdata → Heuristic) and a regex-based text parser. The text parser looks for section headers ("Ingredients", "Instructions"), falls back to inferring ingredients from lines starting with numbers, and parses individual ingredient lines with regex for quantity/unit/name extraction.

**What works well:**
- JSON-LD extraction from recipe websites (most reliable path)
- Unicode fraction handling (½, ¼, ¾)
- Ingredient grouping detection ("For the sauce:")
- Multi-strategy fallback for URLs
- Synonym-based ingredient matching (150+ synonyms)

**What doesn't work well:**
- **Text parsing is fragile** — regex-based section detection breaks on non-standard formatting
- **No LLM fallback** — when regex fails, we get garbage output instead of asking an AI to interpret
- **Ingredient line parsing is naive** — single regex pattern, no NLP, struggles with:
  - "2 (14.5 oz) cans diced tomatoes" (parenthetical sizes)
  - "1 bunch fresh cilantro, roughly chopped" (descriptors mixed with name)
  - "Salt and pepper to taste" (negligible/descriptive ingredients)
  - "4-5 boneless skinless chicken breasts (about 2 lbs)" (weight notes)
- **PDF parsing is a shell** — backend expects pre-extracted text from frontend, no actual PDF parsing
- **No structured data for pasted URLs** — if someone pastes a URL into the text field, we don't detect and redirect

## How Others Solve This

### URL Import
- **Mealie & Tandoor** use Python's `recipe-scrapers` (631+ sites, JSON-LD + custom per-site scrapers)
- **We use** `@julianpoy/recipe-clipper` (ML-based) + our own JSON-LD/Microdata/Heuristic cascade
- Our approach is comparable but `recipe-scrapers` has much broader site coverage

### Ingredient Line Parsing
- **ingredient-parser-nlp** (Python) — NLP-trained model, high accuracy
- **recipe-ingredient-parser-v2** (npm) — Uses Natural NLP library
- **We use** regex only — lowest accuracy approach

### LLM-Based Parsing
- **GPT-4**: 98% accuracy on recipe text extraction
- **Claude**: 97-98.7% accuracy, superior JSON format consistency
- No major recipe app uses LLM as primary parser (too slow/expensive), but it's the ideal fallback

## Proposed Architecture: Tiered Parsing

The key insight: **use the fastest/cheapest method that works, escalate to more expensive methods only when needed.**

```
Input Text/URL/PDF
       │
       ▼
  ┌─────────────┐
  │ Tier 1:     │  JSON-LD extraction (URLs only)
  │ Structured  │  .recipe file format
  │ Data        │  Schema.org microdata
  │ (instant)   │  → Confidence ≥ 0.8? Done.
  └──────┬──────┘
         │ No structured data or low confidence
         ▼
  ┌─────────────┐
  │ Tier 2:     │  Regex section detection
  │ Rule-Based  │  Ingredient line parsing (improved)
  │ Parsing     │  Heuristic HTML extraction
  │ (instant)   │  → Confidence ≥ 0.7? Done.
  └──────┬──────┘
         │ Still low confidence
         ▼
  ┌─────────────┐
  │ Tier 3:     │  Send raw text to Claude API
  │ LLM         │  Structured JSON output
  │ Parsing     │  High accuracy, handles anything
  │ (2-5 sec)   │  → Always produces result
  └─────────────┘
```

## Specific Improvements

### 1. Add LLM Fallback Parser (Tier 3)

When regex parsing produces confidence < 0.7, send the text to Claude with a structured prompt:

```
Parse this recipe text into JSON with these fields:
- title: string
- description: string (optional)
- prepTimeMinutes: number (optional)
- cookTimeMinutes: number (optional)  
- servings: number (optional)
- ingredientGroups: array of {name?: string, ingredients: [{name, quantity?, unit?, notes?}]}
- instructions: string[]

Rules:
- For ingredients, separate quantity (number), unit (cups/tsp/etc), ingredient name, and notes
- Convert fractions to decimals (1/2 = 0.5)
- If no explicit groups, use a single group with no name
- Instructions should be individual steps, not paragraphs
- If information is missing, omit the field rather than guessing

Recipe text:
"""
{text}
"""
```

This handles every edge case that regex can't:
- Conversational recipe formats ("First, preheat your oven...")
- Non-English recipes
- Recipes without clear section headers
- Complex ingredient descriptions

**Cost:** ~$0.01-0.03 per recipe with Claude Haiku. Acceptable since it's only used as fallback.

### 2. Improve Ingredient Line Parsing

Replace the single-regex approach with a multi-pattern parser:

**Pattern priority:**
1. Quantity + parenthetical size + unit + name: `2 (14.5 oz) cans diced tomatoes`
2. Quantity + unit + name + comma-notes: `1 cup flour, sifted`
3. Quantity + name (no unit): `3 eggs`
4. Descriptive (no quantity): `Salt and pepper to taste`
5. Negligible: detect "to taste", "pinch", "dash" etc. and mark as negligible

**Descriptor stripping improvement:**
Currently strips too aggressively. Instead:
- Move descriptors to `notes` field rather than deleting
- "2 cups fresh basil, roughly chopped" → `{name: "basil", quantity: 2, unit: "cup", notes: "fresh, roughly chopped"}`

### 3. URL Detection in Text Input

If the user pastes a URL into the text input, detect it and automatically switch to URL parsing:

```typescript
const URL_PATTERN = /^https?:\/\/[^\s]+$/;
if (URL_PATTERN.test(text.trim())) {
  return parseRecipeFromUrl(text.trim());
}
```

### 4. PDF Text Extraction (Server-Side)

Currently PDF import requires the frontend to extract text. Add server-side PDF text extraction:

- Use `pdf-parse` npm package (lightweight, no native deps)
- Extract text → feed into Tier 2/3 parser
- This makes PDF import actually work end-to-end

### 5. Smarter Confidence Scoring

Current scoring is formulaic (has title = +10%, has ingredients = +15%, etc.). Better approach:

- **Ingredient quality score**: % of ingredients with valid quantity + recognized unit
- **Instruction quality score**: avg instruction length > 20 chars, has actionable verbs
- **Structure score**: clear separation between ingredients and instructions
- **Completeness score**: has title + servings + timing

### 6. Import Session UX Improvements

- **Auto-detect input type**: URL vs text vs JSON
- **Show parse confidence prominently**: color-coded badge with explanation
- **Inline editing during review**: let users fix parsing errors before confirmation
- **"Re-parse with AI" button**: if regex parse is bad, one-click LLM re-parse

## Implementation Priority

1. **LLM fallback parser** — Biggest accuracy improvement, handles all edge cases
2. **Improved ingredient line parsing** — Better regex patterns, descriptor → notes
3. **URL detection in text input** — Quick UX win
4. **PDF server-side extraction** — Completes the PDF import story
5. **Confidence scoring improvements** — Better user feedback
6. **Import UX improvements** — Polish

## Dependencies

- LLM fallback needs Anthropic API key configured (we already have this for the VLM-LLM service)
- PDF extraction needs `pdf-parse` npm package
- No other new dependencies needed

## File Changes

| Improvement | Files |
|-------------|-------|
| LLM fallback | New: `backend/src/modules/recipes/llm-recipe-parser.ts`, Update: `recipe-import.service.ts` |
| Ingredient parsing | Update: `recipe-import.service.ts` (parseIngredientLine) |
| URL detection | Update: `recipe-import.service.ts` (processImportSession) |
| PDF extraction | New: `backend/src/modules/recipes/pdf-parser.ts`, Update: `recipes.routes.ts` |
| Confidence scoring | Update: `recipe-import.service.ts` (calculateTextParseConfidence) |
| Import UX | Update: `frontend/src/pages/recipes/ImportRecipeDialog.tsx` |
