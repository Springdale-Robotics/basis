import { db } from '../../config/database.js';
import { recipes, recipeIngredients, recipeImportSessions, ingredientAliases, inventoryItems } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { ParsedRecipe, ParsedIngredient, IngredientMatch, RecipeInstruction, IngredientGroup } from '../../db/schema/recipes.js';
import { matchIngredients } from './ingredient-matching.service.js';
import { normalizeIngredientName } from './ingredient-matching.service.js';
import { Errors } from '../../lib/errors.js';

// Unicode fraction mapping
const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1/3,
  '⅔': 2/3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1/6,
  '⅚': 5/6,
  '⅐': 1/7,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
  '⅑': 1/9,
  '⅒': 0.1,
};

// Ingredient group header patterns (e.g., "For the sauce:", "Filling:", etc.)
const INGREDIENT_GROUP_PATTERNS = [
  /^for\s+(?:the\s+)?(.+?)[:;]?\s*$/i,
  /^(.+?)\s*[:;]\s*$/,  // General pattern: "Sauce:" or "Filling;"
];

/**
 * Convert Unicode fractions in a string to decimal representations
 */
function convertUnicodeFractions(text: string): string {
  let result = text;
  for (const [frac, value] of Object.entries(UNICODE_FRACTIONS)) {
    if (result.includes(frac)) {
      // Check for mixed number like "1½"
      const mixedMatch = result.match(new RegExp(`(\\d+)\\s*${frac}`));
      if (mixedMatch) {
        const whole = parseInt(mixedMatch[1]);
        result = result.replace(new RegExp(`${mixedMatch[1]}\\s*${frac}`), (whole + value).toString());
      } else {
        result = result.replace(frac, value.toString());
      }
    }
  }
  return result;
}

/**
 * Check if a line is an ingredient group header
 */
function isIngredientGroupHeader(line: string): string | null {
  for (const pattern of INGREDIENT_GROUP_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      // Make sure it's not too long (group headers are usually short)
      const groupName = match[1].trim();
      if (groupName.length < 50 && !groupName.match(/^\d/)) {
        return groupName;
      }
    }
  }
  return null;
}

// Enhanced section header patterns
const SECTION_HEADERS = {
  ingredients: [
    /^ingredients?$/i,
    /^what you'?ll need$/i,
    /^you'?ll need$/i,
    /^shopping list$/i,
    /^ingredients?\s*list$/i,
  ],
  instructions: [
    /^instructions?$/i,
    /^directions?$/i,
    /^method$/i,
    /^steps?$/i,
    /^how to make$/i,
    /^preparation$/i,
    /^procedure$/i,
    /^to make$/i,
    /^cooking instructions?$/i,
  ],
  notes: [
    /^notes?$/i,
    /^tips?$/i,
    /^chef'?s? notes?$/i,
    /^cooking tips?$/i,
  ],
};

/**
 * Check if a line matches a section header pattern
 */
function matchesSectionHeader(line: string, patterns: RegExp[]): boolean {
  const trimmed = line.trim().replace(/[:;]$/, '');
  return patterns.some(p => p.test(trimmed));
}

export interface TextParseResult {
  recipe: ParsedRecipe;
  confidence: number;
  warnings: string[];
}

/**
 * Parse raw text to extract recipe structure
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const result = parseRecipeTextWithConfidence(text);
  return result.recipe;
}

/**
 * Parse raw text and return with confidence score and warnings
 */
export function parseRecipeTextWithConfidence(text: string): TextParseResult {
  const warnings: string[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Try to extract title (usually first non-empty line or largest font in PDF)
  let title = 'Untitled Recipe';
  let description: string | undefined;
  let ingredientsStart = -1;
  let ingredientsEnd = -1;
  let instructionsStart = -1;

  // Look for section markers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Title is usually first line (if not a section header)
    if (i === 0 && line.length < 100 &&
        !matchesSectionHeader(line, SECTION_HEADERS.ingredients) &&
        !matchesSectionHeader(line, SECTION_HEADERS.instructions)) {
      title = line;
    }

    // Find ingredients section
    if (matchesSectionHeader(line, SECTION_HEADERS.ingredients) && ingredientsStart === -1) {
      ingredientsStart = i + 1;
    }

    // Find instructions/directions section
    if (matchesSectionHeader(line, SECTION_HEADERS.instructions) && instructionsStart === -1) {
      if (ingredientsStart > -1 && ingredientsEnd === -1) {
        ingredientsEnd = i;
      }
      instructionsStart = i + 1;
    }

    // Notes section ends instructions
    if (matchesSectionHeader(line, SECTION_HEADERS.notes) && instructionsStart > -1) {
      // Don't process beyond notes
      break;
    }
  }

  // If we didn't find explicit section markers, try to infer
  if (ingredientsStart === -1) {
    // Look for lines that look like ingredients (start with number)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^[\d½¼¾⅓⅔⅛]/)) {
        ingredientsStart = i;
        break;
      }
    }
    if (ingredientsStart > -1) {
      warnings.push('Ingredients section inferred from content');
    }
  }

  // If we found ingredients but not end, look for empty line or other section
  if (ingredientsStart > -1 && ingredientsEnd === -1) {
    for (let i = ingredientsStart; i < lines.length; i++) {
      const line = lines[i];
      if (matchesSectionHeader(line, SECTION_HEADERS.instructions) ||
          matchesSectionHeader(line, SECTION_HEADERS.notes)) {
        ingredientsEnd = i;
        break;
      }
    }
    if (ingredientsEnd === -1) {
      ingredientsEnd = instructionsStart > -1 ? instructionsStart - 1 : lines.length;
    }
  }

  // Collect raw ingredient lines (with grouping). Per-line parsing happens
  // downstream via parseIngredientLinesViaCRF — this function only handles
  // structural detection.
  const ingredients: ParsedIngredient[] = [];
  const ingredientGroups: IngredientGroup[] = [];
  let currentGroup: IngredientGroup | null = null;

  if (ingredientsStart > -1 && ingredientsEnd > ingredientsStart) {
    for (let i = ingredientsStart; i < ingredientsEnd; i++) {
      const line = lines[i];

      // Skip section headers and very short lines
      if (matchesSectionHeader(line, SECTION_HEADERS.ingredients) || line.length < 2) continue;

      // Check for ingredient group header
      const groupName = isIngredientGroupHeader(line);
      if (groupName) {
        if (currentGroup && currentGroup.ingredients.length > 0) {
          ingredientGroups.push(currentGroup);
        }
        currentGroup = { name: groupName, ingredients: [] };
        continue;
      }

      // Strip list-prefix markers but otherwise preserve the raw line for
      // the downstream parser to handle.
      const cleaned = line.replace(/^[-•*]\s*/, '').trim();
      if (cleaned.length === 0) continue;
      const raw: ParsedIngredient = { name: cleaned, quantity: undefined, unit: undefined };
      ingredients.push(raw);
      if (currentGroup) {
        currentGroup.ingredients.push(raw);
      }
    }

    // Add last group if exists
    if (currentGroup && currentGroup.ingredients.length > 0) {
      ingredientGroups.push(currentGroup);
    }
  }

  // Parse instructions
  const instructions: string[] = [];
  if (instructionsStart > -1) {
    let currentInstruction = '';

    for (let i = instructionsStart; i < lines.length; i++) {
      const line = lines[i];

      // Skip section headers
      if (matchesSectionHeader(line, SECTION_HEADERS.instructions) ||
          matchesSectionHeader(line, SECTION_HEADERS.notes)) continue;

      // Stop at notes section
      if (matchesSectionHeader(line, SECTION_HEADERS.notes)) break;

      // Check if line starts with a number (step number)
      const stepMatch = line.match(/^(\d+)[.)]\s*(.*)$/);
      if (stepMatch) {
        if (currentInstruction) {
          instructions.push(currentInstruction.trim());
        }
        currentInstruction = stepMatch[2];
      } else if (currentInstruction) {
        currentInstruction += ' ' + line;
      } else {
        currentInstruction = line;
      }
    }

    if (currentInstruction) {
      instructions.push(currentInstruction.trim());
    }
  }

  // Try to extract timing info
  let prepTimeMinutes: number | undefined;
  let cookTimeMinutes: number | undefined;
  let servings: number | undefined;

  for (const line of lines) {
    const lower = convertUnicodeFractions(line.toLowerCase());

    // Prep time (various formats)
    const prepPatterns = [
      /prep(?:aration)?\s*(?:time)?[:\s]+(\d+)\s*(min|minute|hour|hr)/i,
      /prep[:\s]+(\d+)\s*(min|minute|hour|hr|m|h)/i,
    ];
    for (const pattern of prepPatterns) {
      const prepMatch = lower.match(pattern);
      if (prepMatch && !prepTimeMinutes) {
        prepTimeMinutes = parseInt(prepMatch[1]) * (prepMatch[2].startsWith('h') ? 60 : 1);
      }
    }

    // Cook time (various formats)
    const cookPatterns = [
      /cook(?:ing)?\s*(?:time)?[:\s]+(\d+)\s*(min|minute|hour|hr)/i,
      /cook[:\s]+(\d+)\s*(min|minute|hour|hr|m|h)/i,
      /bake(?:ing)?\s*(?:time)?[:\s]+(\d+)\s*(min|minute|hour|hr)/i,
    ];
    for (const pattern of cookPatterns) {
      const cookMatch = lower.match(pattern);
      if (cookMatch && !cookTimeMinutes) {
        cookTimeMinutes = parseInt(cookMatch[1]) * (cookMatch[2].startsWith('h') ? 60 : 1);
      }
    }

    // Servings (various formats)
    const servingsPatterns = [
      /(?:serve|serving|yield|makes)[s]?[:\s]+(\d+)/i,
      /(\d+)\s*(?:serving|portion)/i,
    ];
    for (const pattern of servingsPatterns) {
      const servingsMatch = lower.match(pattern);
      if (servingsMatch && !servings) {
        servings = parseInt(servingsMatch[1]);
      }
    }
  }

  // Generate warnings
  if (ingredients.length === 0) {
    warnings.push('No ingredients found');
  }
  if (instructions.length === 0) {
    warnings.push('No instructions found');
  }
  if (title === 'Untitled Recipe') {
    warnings.push('Could not determine recipe title');
  }

  const recipe: ParsedRecipe = {
    title,
    description,
    instructions,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    ingredients,
    ingredientGroups: ingredientGroups.length > 0 ? ingredientGroups : undefined,
  };

  // Calculate confidence
  const confidence = calculateTextParseConfidence(recipe);

  return { recipe, confidence, warnings };
}

/**
 * Calculate confidence score for text parsing
 */
function calculateTextParseConfidence(recipe: ParsedRecipe): number {
  let score = 0;

  // Title (10%)
  if (recipe.title && recipe.title !== 'Untitled Recipe') {
    score += 0.1;
  }

  // Description (5%)
  if (recipe.description) {
    score += 0.05;
  }

  // Ingredients (35%)
  if (recipe.ingredients.length > 0) {
    // Base score for having ingredients
    score += 0.15;
    // Bonus for having multiple ingredients
    score += Math.min(0.1, recipe.ingredients.length * 0.01);
    // Bonus for ingredients with quantities
    const withQuantity = recipe.ingredients.filter(i => i.quantity).length;
    score += (withQuantity / recipe.ingredients.length) * 0.1;
  }

  // Instructions (30%)
  if (recipe.instructions.length > 0) {
    // Base score for having instructions
    score += 0.15;
    // Bonus for having multiple steps
    score += Math.min(0.1, recipe.instructions.length * 0.02);
    // Bonus for longer instructions (more detailed)
    const avgLength = recipe.instructions.reduce((sum, i) => sum + i.length, 0) / recipe.instructions.length;
    score += Math.min(0.05, avgLength / 500);
  }

  // Timing (10%)
  if (recipe.prepTimeMinutes) score += 0.05;
  if (recipe.cookTimeMinutes) score += 0.05;

  // Servings (5%)
  if (recipe.servings) score += 0.05;

  // Ingredient groups (5% bonus)
  if (recipe.ingredientGroups && recipe.ingredientGroups.length > 0) {
    score += 0.05;
  }

  return Math.min(1, score);
}

/**
 * Create a new import session
 */
export async function createImportSession(
  householdId: string,
  userId: string,
  sourceType: 'url' | 'image' | 'pdf' | 'text',
  sourceData: string
): Promise<string> {
  // Set expiration to 24 hours from now
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const [session] = await db
    .insert(recipeImportSessions)
    .values({
      householdId,
      userId,
      sourceType,
      sourceData,
      status: 'parsing',
      expiresAt,
    })
    .returning();

  return session.id;
}

/**
 * Check if text is a .recipe file format JSON
 */
interface CatalogItemData {
  name: string;
  category?: string;
  defaultUnit?: string;
  density?: number;
}

function parseRecipeFileFormat(text: string): {
  isRecipeFile: boolean;
  parsedRecipe?: ParsedRecipe;
  catalogItems?: Record<string, CatalogItemData>;
} {
  try {
    const data = JSON.parse(text);
    if (data.version && data.type === 'recipe' && data.recipe) {
      const recipe = data.recipe;
      const catalogItems: Record<string, CatalogItemData> = {};

      const parsedRecipe: ParsedRecipe = {
        title: recipe.title || 'Untitled Recipe',
        description: recipe.description,
        instructions: (recipe.instructions || []).map((inst: { text: string } | string) =>
          typeof inst === 'string' ? inst : inst.text
        ),
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        servings: recipe.servings,
        imageUrl: recipe.imageUrl,
        sourceUrl: recipe.sourceUrl,
        ingredients: (recipe.ingredients || []).map((ing: {
          name: string;
          quantity?: number;
          unit?: string;
          notes?: string;
          catalogItem?: CatalogItemData;
        }) => {
          // Store catalog item data including unit conversions
          if (ing.catalogItem) {
            catalogItems[ing.name] = ing.catalogItem;
          }
          return {
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            notes: ing.notes,
          };
        }),
      };

      return { isRecipeFile: true, parsedRecipe, catalogItems };
    }
  } catch {
    // Not JSON or not valid format
  }
  return { isRecipeFile: false };
}

// LLM fallback kicks in when regex/CRF produce confidence below this threshold.
// Applied uniformly across text and URL import paths.
const FALLBACK_CONFIDENCE_THRESHOLD = 0.6;

// Confidence floor applied after a successful CRF re-parse — CRF is more
// reliable than regex for ingredient line structure.
const CRF_CONFIDENCE_FLOOR = 0.75;

export interface IngredientParseOutcome {
  ingredients: ParsedIngredient[];
  /** True when CRF couldn't parse — ingredients are unparsed raw text. */
  degraded: boolean;
}

/** Warning string surfaced when ingredient parsing degrades. */
export const INGREDIENT_PARSER_UNAVAILABLE_WARNING =
  'Ingredient parser unavailable — quantities and units were not extracted. Please review each ingredient before saving.';

/**
 * Parse raw ingredient lines into structured ingredients via CRF.
 *
 * On CRF failure we deliberately do NOT fall back to a regex parser — silent
 * regex output produces confident-looking-but-wrong ingredients, which is
 * worse than knowing parsing failed. Instead we return raw lines as
 * ingredient names with `degraded: true`, and the caller surfaces a warning
 * so the user can fix things by hand or re-import once the parser is back.
 *
 * Optional `fallbackIngredients` (parallel-indexed) lets the caller preserve
 * notes from a prior parser (e.g., a JSON-LD URL parser) when CRF doesn't
 * extract any.
 */
export async function parseIngredientLinesViaCRF(
  rawLines: string[],
  fallbackIngredients?: ParsedIngredient[],
): Promise<IngredientParseOutcome> {
  if (rawLines.length === 0) return { ingredients: [], degraded: false };
  try {
    const { parseIngredientsWithCRF } = await import('../../services/crf-ingredient-parser.js');
    const crfResults = await parseIngredientsWithCRF(rawLines);
    if (crfResults.length > 0) {
      return {
        ingredients: crfResults.map((r, i) => ({
          name: r.name,
          quantity: r.quantity ?? undefined,
          unit: r.unit ?? undefined,
          notes: r.notes ?? fallbackIngredients?.[i]?.notes ?? undefined,
        })),
        degraded: false,
      };
    }
  } catch (err) {
    console.warn('[Recipe Import] CRF unavailable — returning raw lines:', err);
  }
  return {
    ingredients: rawLines.map((line, i) => ({
      name: line,
      quantity: undefined,
      unit: undefined,
      notes: fallbackIngredients?.[i]?.notes ?? undefined,
    })),
    degraded: true,
  };
}

/**
 * Process raw text content for an import session
 */
export async function processImportSession(
  sessionId: string,
  rawText: string,
  householdId: string,
  parseMethod: string = 'text'
): Promise<void> {
  // Auto-detect URL in text input and redirect to URL parsing
  const trimmed = rawText.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) {
    await processUrlImportSession(sessionId, trimmed, householdId);
    return;
  }

  // Check if this is a .recipe file format
  const recipeFileResult = parseRecipeFileFormat(rawText);

  let parsedRecipe: ParsedRecipe;
  let confidence: number;
  let warnings: string[] = [];
  let finalParseMethod = parseMethod;

  if (recipeFileResult.isRecipeFile && recipeFileResult.parsedRecipe) {
    // Use the parsed recipe from .recipe file
    parsedRecipe = recipeFileResult.parsedRecipe;
    confidence = 1.0; // High confidence for structured .recipe files
    finalParseMethod = 'json-ld'; // Treat as structured data
  } else {
    // Step 1: structural parse (sections, metadata, raw ingredient lines).
    const textParseResult = parseRecipeTextWithConfidence(rawText);
    parsedRecipe = textParseResult.recipe;
    confidence = textParseResult.confidence;
    warnings = textParseResult.warnings;

    // Step 2: parse each raw ingredient line via CRF. On degradation, the
    // ingredient names stay as raw text and a warning is added so the user
    // knows quantities/units weren't extracted.
    if (parsedRecipe.ingredients && parsedRecipe.ingredients.length > 0) {
      const rawIngredientLines = parsedRecipe.ingredients.map((i) => i.name);
      const outcome = await parseIngredientLinesViaCRF(rawIngredientLines);
      parsedRecipe.ingredients = outcome.ingredients;
      if (outcome.degraded) {
        warnings.push(INGREDIENT_PARSER_UNAVAILABLE_WARNING);
        // Don't claim CRF parse method when CRF failed.
      } else {
        finalParseMethod = 'crf';
        confidence = Math.max(confidence, CRF_CONFIDENCE_FLOOR);
      }
    }

    // LLM fallback: if parsing still produced low confidence, try AI
    if (confidence < FALLBACK_CONFIDENCE_THRESHOLD) {
      try {
        const { parseRecipeWithLLM, llmResultToImportFormat } = await import('../../services/llm-recipe-parser.js');
        const llmResult = await parseRecipeWithLLM(rawText);
        if (llmResult) {
          const converted = llmResultToImportFormat(llmResult);
          parsedRecipe = converted as ParsedRecipe;
          confidence = 0.85;
          finalParseMethod = 'llm';
          warnings = [];
        }
      } catch (err) {
        console.warn('[Recipe Import] LLM fallback failed, using regex result:', err);
      }
    }
  }

  // Match ingredients against inventory
  const matchResults = await matchIngredients(parsedRecipe.ingredients, householdId);

  // Attach catalogItem data from .recipe file if available
  const ingredientMatches: IngredientMatch[] = matchResults.map(r => {
    const catalogItem = recipeFileResult.catalogItems?.[r.match.parsedName];
    return {
      ...r.match,
      catalogItem,
    };
  });

  // Update the session
  await db
    .update(recipeImportSessions)
    .set({
      parsedRecipe,
      ingredientMatches,
      status: 'pending_review',
      parseMethod: finalParseMethod,
      parseConfidence: confidence.toString(),
      parseWarnings: warnings,
    })
    .where(eq(recipeImportSessions.id, sessionId));
}

/**
 * Process URL content for an import session
 */
export async function processUrlImportSession(
  sessionId: string,
  url: string,
  householdId: string
): Promise<void> {
  // Import URL parser dynamically
  const { parseRecipeFromUrl } = await import('./url-parser.service.js');

  // Parse the URL
  const result = await parseRecipeFromUrl(url);

  // CRF enhancement on URL-parsed ingredients
  // JSON-LD ingredient strings are perfect CRF input (e.g., "4 boneless, skinless chicken breasts")
  if (result.parsedRecipe.ingredients && result.parsedRecipe.ingredients.length > 0) {
    const originalIngredients = result.parsedRecipe.ingredients;
    // Reconstruct strings for CRF — exclude notes (parenthetical/prep info)
    // to avoid polluting the ingredient name (e.g., "about 3 chicken breasts"
    // from "(about 3 chicken breasts)" would otherwise get merged into the name)
    const rawLines = originalIngredients.map(ing => {
      const parts = [];
      if (ing.quantity) parts.push(String(ing.quantity));
      if (ing.unit) parts.push(ing.unit);
      parts.push(ing.name);
      return parts.join(' ');
    });

    const outcome = await parseIngredientLinesViaCRF(rawLines, originalIngredients);
    if (outcome.ingredients.length > 0) {
      // For URL imports we keep the URL-parser ingredients on CRF failure —
      // they're already structured (from JSON-LD/microdata) so the user is
      // better served by what we had than by raw strings. Only swap when
      // CRF actually re-parsed.
      if (!outcome.degraded) {
        result.parsedRecipe.ingredients = outcome.ingredients;
        (result as any).parseMethod = 'crf';
      } else {
        result.warnings = [...(result.warnings || []), INGREDIENT_PARSER_UNAVAILABLE_WARNING];
      }
    }
  }

  // LLM fallback when the URL parser couldn't extract a confident recipe
  // (e.g., heuristic strategy on a non-structured page). Mirrors the text
  // path; uses the visible page text the URL parser already extracted.
  if (result.confidence < FALLBACK_CONFIDENCE_THRESHOLD && result.pageText) {
    try {
      const { parseRecipeWithLLM, llmResultToImportFormat } = await import('../../services/llm-recipe-parser.js');
      const llmResult = await parseRecipeWithLLM(result.pageText);
      if (llmResult) {
        const converted = llmResultToImportFormat(llmResult);
        result.parsedRecipe = converted as ParsedRecipe;
        (result as any).confidence = 0.85;
        (result as any).parseMethod = 'llm';
      }
    } catch (err) {
      console.warn('[Recipe Import] URL-path LLM fallback failed, keeping URL parser result:', err);
    }
  }

  // Match ingredients against inventory
  const matchResults = await matchIngredients(result.parsedRecipe.ingredients, householdId);
  const ingredientMatches: IngredientMatch[] = matchResults.map(r => r.match);

  // Update the session
  await db
    .update(recipeImportSessions)
    .set({
      parsedRecipe: result.parsedRecipe,
      ingredientMatches,
      status: 'pending_review',
      parseMethod: result.parseMethod,
      parseConfidence: result.confidence.toString(),
      parseWarnings: result.warnings,
    })
    .where(eq(recipeImportSessions.id, sessionId));
}

/**
 * Re-match ingredients after creating new items
 */
export async function rematchIngredients(
  sessionId: string,
  householdId: string
): Promise<IngredientMatch[]> {
  const session = await getImportSession(sessionId, householdId);

  if (!session.parsedRecipe) {
    throw Errors.validation('Session has no parsed recipe');
  }

  const parsedRecipe = session.parsedRecipe as ParsedRecipe;

  // Re-match ingredients against inventory
  const matchResults = await matchIngredients(parsedRecipe.ingredients, householdId);
  const ingredientMatches: IngredientMatch[] = matchResults.map(r => r.match);

  // Update the session
  await db
    .update(recipeImportSessions)
    .set({ ingredientMatches })
    .where(eq(recipeImportSessions.id, sessionId));

  return ingredientMatches;
}

/**
 * Get an import session by ID
 */
export async function getImportSession(sessionId: string, householdId: string) {
  const session = await db.query.recipeImportSessions.findFirst({
    where: and(
      eq(recipeImportSessions.id, sessionId),
      eq(recipeImportSessions.householdId, householdId)
    ),
  });

  if (!session) {
    throw Errors.notFound('Import session');
  }

  // Check if expired
  if (new Date(session.expiresAt) < new Date()) {
    throw Errors.validation('Import session has expired');
  }

  return session;
}

/**
 * Update ingredient matches for a session
 */
export async function updateIngredientMatches(
  sessionId: string,
  householdId: string,
  updates: Array<{ parsedName: string; matchedItemId?: string; matchedItemName?: string; modifiedUnit?: string }>
): Promise<void> {
  const session = await getImportSession(sessionId, householdId);

  const currentMatches = session.ingredientMatches as IngredientMatch[];
  const updatedMatches = currentMatches.map(match => {
    const update = updates.find(u => u.parsedName === match.parsedName);
    if (update) {
      return {
        ...match,
        matchedItemId: update.matchedItemId,
        matchedItemName: update.matchedItemName,
        matchStatus: update.matchedItemId ? 'manual' as const : 'unmatched' as const,
        // Store user-modified unit
        modifiedUnit: update.modifiedUnit,
      };
    }
    return match;
  });

  await db
    .update(recipeImportSessions)
    .set({ ingredientMatches: updatedMatches })
    .where(eq(recipeImportSessions.id, sessionId));
}

/**
 * Confirm an import session and create the recipe
 */
export async function confirmImportSession(
  sessionId: string,
  householdId: string,
  userId: string,
  overrides?: Partial<ParsedRecipe>
): Promise<string> {
  const session = await getImportSession(sessionId, householdId);

  if (session.status !== 'pending_review') {
    throw Errors.validation('Session is not in pending_review status');
  }

  const parsedRecipe = session.parsedRecipe as ParsedRecipe;
  const ingredientMatches = session.ingredientMatches as IngredientMatch[];

  // Merge overrides
  const finalRecipe = { ...parsedRecipe, ...overrides };

  // Convert instructions to the expected format
  const instructionObjects: RecipeInstruction[] = finalRecipe.instructions.map((text, index) => ({
    step: index + 1,
    text,
  }));

  // Create the recipe
  const [recipe] = await db
    .insert(recipes)
    .values({
      householdId,
      createdBy: userId,
      title: finalRecipe.title,
      description: finalRecipe.description,
      instructions: instructionObjects,
      prepTimeMinutes: finalRecipe.prepTimeMinutes,
      cookTimeMinutes: finalRecipe.cookTimeMinutes,
      servings: finalRecipe.servings,
      imageUrl: finalRecipe.imageUrl,
    })
    .returning();

  // Build ingredient-to-group lookup from parsed groups
  const ingredientGroupMap: Record<string, string> = {};
  if (finalRecipe.ingredientGroups) {
    for (const group of finalRecipe.ingredientGroups) {
      if (group.name) {
        for (const groupIng of group.ingredients) {
          ingredientGroupMap[groupIng.name] = group.name;
        }
      }
    }
  }

  // Create ingredients with inventory links
  if (finalRecipe.ingredients.length > 0) {
    await db.insert(recipeIngredients).values(
      finalRecipe.ingredients.map((ing, index) => {
        const match = ingredientMatches.find(m => m.parsedName === ing.name);
        // Use user-modified unit if available, otherwise fall back to parsed unit
        const unit = match?.modifiedUnit ?? ing.unit;
        return {
          recipeId: recipe.id,
          name: ing.name,
          quantity: ing.quantity?.toString(),
          unit,
          notes: ing.notes,
          inventoryItemId: match?.matchedItemId,
          groupName: ingredientGroupMap[ing.name] || null,
        };
      })
    );
  }

  // Auto-create ingredient aliases for manual matches where names differ
  for (const match of ingredientMatches) {
    if (match.matchStatus === 'matched' && match.matchedItemId && match.matchReason === 'manual') {
      const parsedNorm = normalizeIngredientName(match.parsedName);
      // Get the matched item name
      const item = await db.query.inventoryItems.findFirst({
        where: eq(inventoryItems.id, match.matchedItemId),
      });
      if (item) {
        const itemNorm = normalizeIngredientName(item.name);
        // Only create alias if names are actually different
        if (parsedNorm !== itemNorm) {
          // Check if alias already exists
          const existing = await db.query.ingredientAliases.findFirst({
            where: and(
              eq(ingredientAliases.householdId, householdId),
              eq(ingredientAliases.aliasName, parsedNorm),
            ),
          });
          if (!existing) {
            await db.insert(ingredientAliases).values({
              householdId,
              canonicalItemId: match.matchedItemId,
              aliasName: parsedNorm,
              aliasType: 'exact',
            });
          }
        }
      }
    }
  }

  // Update session status
  await db
    .update(recipeImportSessions)
    .set({ status: 'confirmed' })
    .where(eq(recipeImportSessions.id, sessionId));

  return recipe.id;
}

/**
 * Cancel an import session
 */
export async function cancelImportSession(
  sessionId: string,
  householdId: string
): Promise<void> {
  await db
    .update(recipeImportSessions)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(recipeImportSessions.id, sessionId),
        eq(recipeImportSessions.householdId, householdId)
      )
    );
}
