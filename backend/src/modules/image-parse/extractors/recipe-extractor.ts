import type { ParsedRecipeContent, ParsedRecipeIngredient } from '../../../db/schema/image-parse.js';
import { logger } from '../../../lib/logger.js';

interface RawRecipeData {
  title?: string;
  name?: string;
  description?: string;
  prepTimeMinutes?: number;
  prepTime?: number;
  cookTimeMinutes?: number;
  cookTime?: number;
  servings?: number;
  serves?: number;
  yield?: number;
  ingredients?: Array<{
    name?: string;
    ingredient?: string;
    quantity?: number;
    amount?: number;
    unit?: string;
    notes?: string;
    note?: string;
    confidence?: number;
  }>;
  instructions?: string[] | Array<{ step?: number; text?: string }>;
  steps?: string[] | Array<{ step?: number; text?: string }>;
  directions?: string[];
}

// Standard unit mapping for normalization
const UNIT_MAP: Record<string, string> = {
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb',
  gram: 'g',
  grams: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  milliliter: 'ml',
  milliliters: 'ml',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  cups: 'cup',
};

/**
 * Normalize and validate extracted recipe content
 */
export function normalizeRecipeContent(raw: unknown): ParsedRecipeContent {
  const data = raw as RawRecipeData;

  const title = (data.title || data.name || 'Untitled Recipe').trim();
  const ingredients: ParsedRecipeIngredient[] = [];
  const instructions: string[] = [];

  // Process ingredients
  if (Array.isArray(data.ingredients)) {
    for (const ing of data.ingredients) {
      const name = (ing.name || ing.ingredient || '').trim();
      if (!name) continue;

      ingredients.push({
        name,
        quantity: ing.quantity ?? ing.amount,
        unit: normalizeUnit(ing.unit),
        notes: (ing.notes || ing.note || '').trim() || undefined,
        confidence: Math.min(1, Math.max(0, ing.confidence ?? 0.8)),
      });
    }
  }

  // Process instructions
  const rawInstructions = data.instructions || data.steps || data.directions || [];
  if (Array.isArray(rawInstructions)) {
    for (const item of rawInstructions) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) {
          instructions.push(cleanInstructionText(trimmed));
        }
      } else if (item && typeof item === 'object' && 'text' in item) {
        const trimmed = (item.text || '').trim();
        if (trimmed) {
          instructions.push(cleanInstructionText(trimmed));
        }
      }
    }
  }

  return {
    title,
    description: data.description?.trim(),
    prepTimeMinutes: data.prepTimeMinutes ?? data.prepTime,
    cookTimeMinutes: data.cookTimeMinutes ?? data.cookTime,
    servings: data.servings ?? data.serves ?? data.yield,
    ingredients,
    instructions,
  };
}

/**
 * Parse recipe content from raw text (fallback when AI extraction fails)
 */
export function parseRecipeFromText(rawText: string): ParsedRecipeContent {
  const lines = rawText.split('\n').filter((l) => l.trim());
  const ingredients: ParsedRecipeIngredient[] = [];
  const instructions: string[] = [];

  let inIngredientsSection = false;
  let inInstructionsSection = false;
  let title = 'Untitled Recipe';

  // Try to extract title from various formats
  // Format 1: "TITLE: Recipe Name" (from simple prompts)
  const titleMatch = rawText.match(/^TITLE:\s*(.+)$/im);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Format 2: "1. Recipe Name - ingredients..." or "Recipe Name - ingredients..."
  // Extract title before the dash when followed by ingredients
  if (title === 'Untitled Recipe') {
    const dashTitleMatch = rawText.match(/^\s*(?:\d+\.\s*)?([A-Za-z][A-Za-z\s]+?)\s*[-–—]\s*\d/m);
    if (dashTitleMatch) {
      title = dashTitleMatch[1].trim();
    }
  }

  // Extract SERVINGS, PREP TIME, COOK TIME from simple prompt format
  let servings: number | undefined;
  let prepTimeMinutes: number | undefined;
  let cookTimeMinutes: number | undefined;

  const servingsMatch = rawText.match(/SERVINGS:\s*(\d+)/i);
  if (servingsMatch) {
    servings = parseInt(servingsMatch[1]);
  }

  const prepMatch = rawText.match(/PREP\s*TIME:\s*(\d+)/i);
  if (prepMatch) {
    prepTimeMinutes = parseInt(prepMatch[1]);
  }

  const cookMatch = rawText.match(/COOK\s*TIME:\s*(\d+)/i);
  if (cookMatch) {
    cookTimeMinutes = parseInt(cookMatch[1]);
  }

  // First pass: try structured parsing with section headers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lowerLine = line.toLowerCase();

    // Skip empty lines
    if (!line) continue;

    // Skip TITLE:, SERVINGS:, PREP TIME:, COOK TIME: lines
    if (/^(TITLE|SERVINGS|PREP\s*TIME|COOK\s*TIME):/i.test(line)) {
      continue;
    }

    // Detect section headers
    if (lowerLine.includes('ingredient') || lowerLine === 'ingredients:') {
      inIngredientsSection = true;
      inInstructionsSection = false;
      continue;
    }

    if (
      lowerLine.includes('instruction') ||
      lowerLine.includes('direction') ||
      lowerLine.includes('method') ||
      lowerLine === 'steps:'
    ) {
      inInstructionsSection = true;
      inIngredientsSection = false;
      continue;
    }

    // First non-header line might be the title (if not already found)
    if (i === 0 && !inIngredientsSection && !inInstructionsSection && title === 'Untitled Recipe') {
      if (line.length < 80 && !line.includes(':')) {
        title = line;
        continue;
      }
    }

    // Parse ingredient lines
    if (inIngredientsSection || (!inInstructionsSection && isIngredientLine(line))) {
      // Check if this line contains multiple comma-separated ingredients
      const parsedMultiple = parseMultipleIngredients(line);
      if (parsedMultiple.length > 0) {
        ingredients.push(...parsedMultiple);
        inIngredientsSection = true;
      } else {
        const parsed = parseIngredientLine(line);
        if (parsed) {
          ingredients.push(parsed);
          inIngredientsSection = true;
        }
      }
      continue;
    }

    // Parse instruction lines
    if (inInstructionsSection || isInstructionLine(line)) {
      const cleaned = cleanInstructionText(line);
      if (cleaned) {
        instructions.push(cleaned);
        inInstructionsSection = true;
      }
    }
  }

  // Second pass: if no structured content found, try to parse natural language
  // This handles cases where the AI returns a description like:
  // "This is a recipe for chicken soup. The ingredients include flour, eggs, and butter."
  if (ingredients.length === 0 && instructions.length === 0) {
    const nlResult = parseNaturalLanguageRecipe(rawText);
    ingredients.push(...nlResult.ingredients);
    instructions.push(...nlResult.instructions);
    if (nlResult.title && nlResult.title !== 'Untitled Recipe') {
      title = nlResult.title;
    }
  }

  // Extract times from text if not already found (fallback patterns)
  if (!prepTimeMinutes) {
    const prepTimeMatch = rawText.match(/prep(?:\s*time)?[:\s]*(\d+)\s*(?:min|minute)/i);
    if (prepTimeMatch) prepTimeMinutes = parseInt(prepTimeMatch[1]);
  }
  if (!cookTimeMinutes) {
    const cookTimeMatch = rawText.match(/cook(?:\s*time)?[:\s]*(\d+)\s*(?:min|minute)/i);
    if (cookTimeMatch) cookTimeMinutes = parseInt(cookTimeMatch[1]);
  }
  if (!servings) {
    const servingsMatch2 = rawText.match(/serves?[:\s]*(\d+)/i);
    if (servingsMatch2) servings = parseInt(servingsMatch2[1]);
  }

  const result = {
    title,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    ingredients,
    instructions,
  };

  logger.info({
    title,
    ingredientCount: ingredients.length,
    instructionCount: instructions.length,
    ingredients: ingredients.slice(0, 5), // Log first 5 for debugging
    instructions: instructions.slice(0, 3), // Log first 3 for debugging
  }, 'parseRecipeFromText result');

  return result;
}

/**
 * Parse natural language text that describes a recipe (fallback for lightweight AI models)
 */
function parseNaturalLanguageRecipe(rawText: string): {
  title: string;
  ingredients: ParsedRecipeIngredient[];
  instructions: string[];
} {
  const ingredients: ParsedRecipeIngredient[] = [];
  const instructions: string[] = [];
  let title = 'Untitled Recipe';

  // Try to extract title from "recipe for X" or "X recipe" patterns
  const titleMatch = rawText.match(/(?:recipe for|recipe:)\s*([^.,:]+)/i) ||
    rawText.match(/(?:^|\s)([A-Z][a-z]+(?:\s+[A-Za-z]+){0,4})\s+recipe\b/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Extract ingredients from patterns like "ingredients include X, Y, and Z" or inline lists
  const ingredientPatterns = [
    /ingredients?(?:\s+include|\s+are|:)\s*([^.]+)/gi,
    /(?:with|using|need)\s+(\d+[^.]*(?:cup|tbsp|tsp|oz|lb|g)[^.]*)/gi,
  ];

  for (const pattern of ingredientPatterns) {
    let match;
    while ((match = pattern.exec(rawText)) !== null) {
      // Split on commas and "and"
      const items = match[1].split(/,\s*|\s+and\s+/);
      for (const item of items) {
        const trimmed = item.trim();
        if (trimmed.length > 2) {
          // Try to parse quantities
          const qtyMatch = trimmed.match(/^(\d+(?:[\/\.]\d+)?)\s*([a-zA-Z]+)?\s*(.+)$/);
          if (qtyMatch) {
            ingredients.push({
              name: qtyMatch[3].trim(),
              quantity: parseFloat(qtyMatch[1]),
              unit: qtyMatch[2] || undefined,
              confidence: 0.5,
            });
          } else {
            ingredients.push({
              name: trimmed,
              confidence: 0.4,
            });
          }
        }
      }
    }
  }

  // Extract instructions from sentences containing cooking verbs
  const sentences = rawText.split(/[.!]\s+/);
  const cookingVerbs = /\b(preheat|heat|cook|bake|fry|sauté|saute|boil|simmer|stir|mix|combine|add|pour|place|remove|let|allow|set|cover|season|taste|serve|slice|dice|chop|mince|grate|whisk|fold|blend|beat|knead)\b/i;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length > 10 && cookingVerbs.test(trimmed)) {
      instructions.push(trimmed.replace(/^\d+[\.\)]\s*/, ''));
    }
  }

  return { title, ingredients, instructions };
}

/**
 * Normalize a unit string to standard form
 */
function normalizeUnit(unit?: string): string | undefined {
  if (!unit) return undefined;

  const lower = unit.toLowerCase().trim();
  return UNIT_MAP[lower] || lower;
}

/**
 * Check if a line looks like an ingredient
 */
function isIngredientLine(line: string): boolean {
  // Check for quantity patterns
  const hasQuantity = /^\s*[\d½¼¾⅓⅔⅛⅜⅝⅞]+/.test(line);
  const hasUnit = /\b(cup|tbsp|tsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|ounce|pound|gram|kilogram)\b/i.test(line);
  const hasBullet = /^[\-\*•]\s*/.test(line);

  return hasQuantity || (hasBullet && hasUnit);
}

/**
 * Check if a line looks like an instruction step
 */
function isInstructionLine(line: string): boolean {
  // Numbered steps
  if (/^\d+[\.\)]\s*/.test(line)) return true;

  // Contains cooking verbs
  const cookingVerbs = /\b(preheat|heat|cook|bake|fry|sauté|boil|simmer|stir|mix|combine|add|pour|place|remove|let|allow|set|cover|season|taste|serve|slice|dice|chop|mince|grate)\b/i;
  return cookingVerbs.test(line);
}

/**
 * Parse a line that might contain multiple ingredients.
 * Handles both comma-separated and space-separated formats:
 * - "1 cup flour, 1 egg, 1/2 cup butter"
 * - "1 cup flour  1 egg  1/2 cup butter"
 * Returns empty array if this doesn't look like multiple ingredients.
 */
function parseMultipleIngredients(line: string): ParsedRecipeIngredient[] {
  // Remove title prefix if present (e.g., "Peanut Butter Cookies - ")
  let text = line.replace(/^[^-:]+[-:]\s*/, '').trim();

  // Check if this looks like multiple ingredients
  // Look for multiple quantity patterns (number optionally followed by unit/item)
  const quantityPattern = /[\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:\/\d+)?/g;
  const matches = text.match(quantityPattern);

  // If we have fewer than 2 quantity patterns, this isn't a multi-ingredient line
  if (!matches || matches.length < 2) {
    return [];
  }

  // Count commas
  const commaCount = (text.match(/,/g) || []).length;

  let segments: string[];

  if (commaCount >= 2) {
    // Split on commas (and also handle "and" at the end)
    segments = text.split(/,\s*|\s+and\s+/).filter(s => s.trim());
  } else {
    // No commas - split on quantity patterns
    // This handles: "1 cup flour  1 egg  1/2 cup butter"
    // We need to split BEFORE each quantity pattern (except the first)
    segments = splitOnQuantityPatterns(text);
  }

  // If we only got one segment, this isn't a multi-ingredient line
  if (segments.length < 2) {
    return [];
  }

  const ingredients: ParsedRecipeIngredient[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed.length < 2) continue;

    const parsed = parseIngredientLine(trimmed);
    if (parsed) {
      ingredients.push(parsed);
    }
  }

  // Only return results if we successfully parsed at least 2 ingredients
  // This prevents false positives where a single ingredient has commas in notes
  return ingredients.length >= 2 ? ingredients : [];
}

/**
 * Split a string on quantity patterns.
 * E.g., "1 cup flour  1 egg  1/2 cup butter" -> ["1 cup flour", "1 egg", "1/2 cup butter"]
 */
function splitOnQuantityPatterns(text: string): string[] {
  // Pattern to match the START of an ingredient: quantity followed by unit or item
  // We look for: number/fraction + space + word
  const splitPattern = /\s{2,}(?=[\d½¼¾⅓⅔⅛⅜⅝⅞])|(?<=\w)\s+(?=[\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:\/\d+)?\s+(?:cup|cups|tbsp|tsp|oz|lb|g|kg|ml|teaspoon|tablespoon|egg|clove))/gi;

  // First try splitting on double spaces (common in OCR output)
  if (text.includes('  ')) {
    const parts = text.split(/\s{2,}/).filter(s => s.trim());
    if (parts.length >= 2) {
      return parts;
    }
  }

  // Try to find boundaries between ingredients by looking for pattern:
  // [word(s)] [quantity] where quantity starts a new ingredient
  const segments: string[] = [];

  // Match each ingredient: starts with quantity, followed by optional unit, followed by name
  const ingredientPattern = /([\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:\/\d+)?)\s*([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/g;

  let lastIndex = 0;
  let match;
  const allMatches: { start: number; end: number; text: string }[] = [];

  while ((match = ingredientPattern.exec(text)) !== null) {
    allMatches.push({
      start: match.index,
      end: ingredientPattern.lastIndex,
      text: match[0]
    });
  }

  // If we found multiple quantity patterns, split between them
  if (allMatches.length >= 2) {
    for (let i = 0; i < allMatches.length; i++) {
      const current = allMatches[i];
      const next = allMatches[i + 1];

      if (next) {
        // Get text from current match start to next match start
        segments.push(text.substring(current.start, next.start).trim());
      } else {
        // Last segment - go to end of text
        segments.push(text.substring(current.start).trim());
      }
    }
  }

  return segments.length >= 2 ? segments : [text];
}

/**
 * Parse a single ingredient line
 */
function parseIngredientLine(line: string): ParsedRecipeIngredient | null {
  // Remove bullet points
  let text = line.replace(/^[\-\*•]\s*/, '').trim();

  // Known units for reference
  const knownUnits = new Set([
    'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'l',
    'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
    'ounce', 'ounces', 'pound', 'pounds', 'gram', 'grams',
    'clove', 'cloves', 'can', 'cans', 'piece', 'pieces',
    'slice', 'slices', 'bunch', 'bunches', 'head', 'heads',
  ]);

  // Items that are commonly counted without a unit (e.g., "1 egg", "2 bananas")
  const countableItems = new Set([
    'egg', 'eggs', 'banana', 'bananas', 'apple', 'apples', 'orange', 'oranges',
    'onion', 'onions', 'tomato', 'tomatoes', 'potato', 'potatoes', 'carrot', 'carrots',
    'lemon', 'lemons', 'lime', 'limes', 'garlic', 'clove', 'cloves',
    'avocado', 'avocados', 'pepper', 'peppers', 'cucumber', 'cucumbers',
  ]);

  // Pattern 1: "1 egg" or "2 eggs" - number followed by countable item
  const countableMatch = text.match(/^([\d½¼¾⅓⅔⅛⅜⅝⅞\/\.]+)\s+(\w+)$/);
  if (countableMatch) {
    const [, qtyStr, item] = countableMatch;
    const itemLower = item.toLowerCase();
    // If it's a countable item, treat the whole thing as the name
    if (countableItems.has(itemLower)) {
      return {
        name: item,
        quantity: parseQuantity(qtyStr),
        confidence: 0.8,
      };
    }
  }

  // Pattern 2: "1/2 cup butter" or "1 cup flour" - quantity, unit, name
  const fullMatch = text.match(/^([\d½¼¾⅓⅔⅛⅜⅝⅞\/\.\s]+)\s+([a-zA-Z]+)\s+(.+)$/);
  if (fullMatch) {
    const [, quantityStr, unit, name] = fullMatch;
    const quantity = parseQuantity(quantityStr.trim());

    if (knownUnits.has(unit.toLowerCase())) {
      return {
        name: name.trim(),
        quantity,
        unit: normalizeUnit(unit),
        confidence: 0.7,
      };
    }

    // Unit not recognized, include it in the name
    return {
      name: `${unit} ${name}`.trim(),
      quantity,
      confidence: 0.6,
    };
  }

  // Pattern 3: Try legacy pattern for edge cases
  const match = text.match(/^([\d½¼¾⅓⅔⅛⅜⅝⅞\/\.\s]+)?\s*([a-zA-Z]+)?\s*(.*)$/);

  if (match) {
    const [, quantityStr, unit, name] = match;

    let quantity: number | undefined;
    if (quantityStr) {
      quantity = parseQuantity(quantityStr.trim());
    }

    if (unit && knownUnits.has(unit.toLowerCase())) {
      return {
        name: name.trim(),
        quantity,
        unit: normalizeUnit(unit),
        confidence: 0.7,
      };
    }

    // No recognized unit, include it in the name
    const fullName = unit ? `${unit} ${name}`.trim() : name.trim();
    return {
      name: fullName,
      quantity,
      confidence: 0.6,
    };
  }

  // Fallback: just use the whole line as the ingredient name
  if (text.length > 2) {
    return {
      name: text,
      confidence: 0.5,
    };
  }

  return null;
}

/**
 * Parse a quantity string (handles fractions)
 */
function parseQuantity(str: string): number | undefined {
  // Handle Unicode fractions
  const fractionMap: Record<string, number> = {
    '½': 0.5,
    '¼': 0.25,
    '¾': 0.75,
    '⅓': 0.333,
    '⅔': 0.667,
    '⅛': 0.125,
    '⅜': 0.375,
    '⅝': 0.625,
    '⅞': 0.875,
  };

  let total = 0;
  let current = str.trim();

  // Replace Unicode fractions
  for (const [frac, value] of Object.entries(fractionMap)) {
    if (current.includes(frac)) {
      total += value;
      current = current.replace(frac, '').trim();
    }
  }

  // Handle "1/2" style fractions
  const fractionMatch = current.match(/(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    total += parseInt(fractionMatch[1]) / parseInt(fractionMatch[2]);
    current = current.replace(fractionMatch[0], '').trim();
  }

  // Handle whole numbers
  const wholeMatch = current.match(/(\d+(?:\.\d+)?)/);
  if (wholeMatch) {
    total += parseFloat(wholeMatch[1]);
  }

  return total > 0 ? total : undefined;
}

/**
 * Clean up instruction text
 */
function cleanInstructionText(text: string): string {
  return text
    .replace(/^\d+[\.\)]\s*/, '') // Remove step numbers
    .replace(/^step\s*\d+[:\.\)]\s*/i, '') // Remove "Step N:" prefix
    .trim();
}
