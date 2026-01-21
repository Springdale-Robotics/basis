import { db } from '../../config/database.js';
import { recipes, recipeIngredients, recipeImportSessions } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { ParsedRecipe, ParsedIngredient, IngredientMatch, RecipeInstruction } from '../../db/schema/recipes.js';
import { matchIngredients } from './ingredient-matching.service.js';
import { Errors } from '../../lib/errors.js';

// Ingredient parsing regex patterns
const INGREDIENT_PATTERNS = {
  // Match "2 cups flour" or "1/2 tsp salt"
  quantityUnitName: /^(\d+(?:[\/\.]\d+)?(?:\s*-\s*\d+(?:[\/\.]\d+)?)?)\s+([a-zA-Z]+\.?)?\s*(.+)$/i,
  // Match "2 eggs" (no unit)
  quantityName: /^(\d+(?:[\/\.]\d+)?(?:\s*-\s*\d+(?:[\/\.]\d+)?)?)\s+(.+)$/i,
  // Fractional quantities
  fraction: /(\d+)\s*\/\s*(\d+)/g,
  // Mixed number like "1 1/2"
  mixedNumber: /^(\d+)\s+(\d+)\s*\/\s*(\d+)/,
};

// Common units for parsing
const UNITS = new Set([
  'cup', 'cups', 'c',
  'tablespoon', 'tablespoons', 'tbsp', 'tbs', 'T',
  'teaspoon', 'teaspoons', 'tsp', 't',
  'ounce', 'ounces', 'oz',
  'pound', 'pounds', 'lb', 'lbs',
  'gram', 'grams', 'g', 'gm',
  'kilogram', 'kilograms', 'kg',
  'milliliter', 'milliliters', 'ml', 'mL',
  'liter', 'liters', 'l', 'L', 'litre', 'litres',
  'piece', 'pieces', 'pcs', 'pc',
  'clove', 'cloves',
  'bunch', 'bunches',
  'head', 'heads',
  'can', 'cans', 'tin', 'tins',
  'package', 'packages', 'pkg',
  'slice', 'slices',
  'stick', 'sticks',
  'pinch', 'pinches',
  'dash', 'dashes',
  'handful', 'handfuls',
  'large', 'medium', 'small',
]);

/**
 * Parse a fraction string like "1/2" into a decimal
 */
function parseFraction(str: string): number {
  const mixedMatch = str.match(INGREDIENT_PATTERNS.mixedNumber);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1]);
    const num = parseInt(mixedMatch[2]);
    const denom = parseInt(mixedMatch[3]);
    return whole + num / denom;
  }

  if (str.includes('/')) {
    const parts = str.split('/');
    return parseInt(parts[0]) / parseInt(parts[1]);
  }

  return parseFloat(str);
}

/**
 * Parse a quantity string that may contain ranges like "2-3"
 */
function parseQuantity(str: string): number {
  // Handle ranges - take the average
  if (str.includes('-')) {
    const parts = str.split('-').map(p => parseFraction(p.trim()));
    return parts.reduce((a, b) => a + b, 0) / parts.length;
  }

  return parseFraction(str);
}

/**
 * Parse a single ingredient line into structured data
 */
export function parseIngredientLine(line: string): ParsedIngredient {
  let text = line.trim();

  // Extract notes in parentheses
  let notes: string | undefined;
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    notes = parenMatch[1];
    text = text.replace(/\([^)]+\)/, '').trim();
  }

  // Extract notes after comma
  const commaIndex = text.indexOf(',');
  if (commaIndex > -1) {
    const afterComma = text.slice(commaIndex + 1).trim();
    if (afterComma && !notes) {
      notes = afterComma;
    }
    text = text.slice(0, commaIndex).trim();
  }

  // Try to match quantity + unit + name
  let match = text.match(INGREDIENT_PATTERNS.quantityUnitName);
  if (match) {
    const [, quantityStr, unitStr, name] = match;
    const unit = unitStr?.replace('.', '').toLowerCase();

    if (unit && UNITS.has(unit)) {
      return {
        name: name.trim(),
        quantity: parseQuantity(quantityStr),
        unit: unit,
        notes,
      };
    } else {
      // Unit might be part of the name
      return {
        name: (unitStr ? unitStr + ' ' : '') + name.trim(),
        quantity: parseQuantity(quantityStr),
        notes,
      };
    }
  }

  // Try quantity + name (no unit)
  match = text.match(INGREDIENT_PATTERNS.quantityName);
  if (match) {
    const [, quantityStr, name] = match;
    return {
      name: name.trim(),
      quantity: parseQuantity(quantityStr),
      notes,
    };
  }

  // Just return the text as the name
  return {
    name: text,
    notes,
  };
}

/**
 * Parse raw text to extract recipe structure
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Try to extract title (usually first non-empty line or largest font in PDF)
  let title = 'Untitled Recipe';
  let description: string | undefined;
  let ingredientsStart = -1;
  let ingredientsEnd = -1;
  let instructionsStart = -1;

  // Look for section markers
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();

    // Title is usually first line
    if (i === 0 && lines[i].length < 100) {
      title = lines[i];
    }

    // Find ingredients section
    if (lower.includes('ingredient') && ingredientsStart === -1) {
      ingredientsStart = i + 1;
    }

    // Find instructions/directions section
    if ((lower.includes('instruction') || lower.includes('direction') || lower.includes('method') || lower.includes('steps')) && instructionsStart === -1) {
      if (ingredientsStart > -1 && ingredientsEnd === -1) {
        ingredientsEnd = i;
      }
      instructionsStart = i + 1;
    }
  }

  // If we found ingredients but not end, look for empty line or other section
  if (ingredientsStart > -1 && ingredientsEnd === -1) {
    for (let i = ingredientsStart; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (lower.includes('instruction') || lower.includes('direction') || lower.includes('method') || lower.includes('steps') || lower.includes('note')) {
        ingredientsEnd = i;
        break;
      }
    }
    if (ingredientsEnd === -1) {
      ingredientsEnd = instructionsStart > -1 ? instructionsStart - 1 : lines.length;
    }
  }

  // Parse ingredients
  const ingredients: ParsedIngredient[] = [];
  if (ingredientsStart > -1 && ingredientsEnd > ingredientsStart) {
    for (let i = ingredientsStart; i < ingredientsEnd; i++) {
      const line = lines[i];
      // Skip section headers and empty lines
      if (line.toLowerCase().includes('ingredient') || line.length < 2) continue;

      const parsed = parseIngredientLine(line);
      if (parsed.name.length > 0) {
        ingredients.push(parsed);
      }
    }
  }

  // Parse instructions
  const instructions: string[] = [];
  if (instructionsStart > -1) {
    let currentInstruction = '';

    for (let i = instructionsStart; i < lines.length; i++) {
      const line = lines[i];

      // Skip section headers
      if (line.toLowerCase().includes('instruction') || line.toLowerCase().includes('direction')) continue;

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
    const lower = line.toLowerCase();

    // Prep time
    const prepMatch = lower.match(/prep(?:aration)?\s*(?:time)?[:\s]+(\d+)\s*(min|minute|hour|hr)/);
    if (prepMatch) {
      prepTimeMinutes = parseInt(prepMatch[1]) * (prepMatch[2].startsWith('h') ? 60 : 1);
    }

    // Cook time
    const cookMatch = lower.match(/cook(?:ing)?\s*(?:time)?[:\s]+(\d+)\s*(min|minute|hour|hr)/);
    if (cookMatch) {
      cookTimeMinutes = parseInt(cookMatch[1]) * (cookMatch[2].startsWith('h') ? 60 : 1);
    }

    // Servings
    const servingsMatch = lower.match(/(?:serve|serving|yield)[s]?[:\s]+(\d+)/);
    if (servingsMatch) {
      servings = parseInt(servingsMatch[1]);
    }
  }

  return {
    title,
    description,
    instructions,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    ingredients,
  };
}

/**
 * Create a new import session
 */
export async function createImportSession(
  householdId: string,
  userId: string,
  sourceType: 'url' | 'image' | 'pdf',
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
 * Process raw text content for an import session
 */
export async function processImportSession(
  sessionId: string,
  rawText: string,
  householdId: string
): Promise<void> {
  // Parse the recipe text
  const parsedRecipe = parseRecipeText(rawText);

  // Match ingredients against inventory
  const matchResults = await matchIngredients(parsedRecipe.ingredients, householdId);
  const ingredientMatches: IngredientMatch[] = matchResults.map(r => r.match);

  // Update the session
  await db
    .update(recipeImportSessions)
    .set({
      parsedRecipe,
      ingredientMatches,
      status: 'pending_review',
    })
    .where(eq(recipeImportSessions.id, sessionId));
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
  updates: Array<{ parsedName: string; matchedItemId?: string; matchedItemName?: string }>
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

  // Create ingredients with inventory links
  if (finalRecipe.ingredients.length > 0) {
    await db.insert(recipeIngredients).values(
      finalRecipe.ingredients.map((ing, index) => {
        const match = ingredientMatches.find(m => m.parsedName === ing.name);
        return {
          recipeId: recipe.id,
          name: ing.name,
          quantity: ing.quantity?.toString(),
          unit: ing.unit,
          notes: ing.notes,
          inventoryItemId: match?.matchedItemId,
        };
      })
    );
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
