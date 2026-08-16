import type { ParsedRecipeContent, ParsedRecipeIngredient } from '../../../db/schema/image-parse.js';
import { logger } from '../../../lib/logger.js';
import {
  INGREDIENTS_HEADER,
  INSTRUCTIONS_HEADER,
  classifyRecipeLine,
  splitIntoSteps,
  stripDecoration,
} from '../../recipes/recipe-line-classifier.js';

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

    // Skip empty lines
    if (!line) continue;

    // Skip TITLE:, SERVINGS:, PREP TIME:, COOK TIME: lines
    if (/^(TITLE|SERVINGS|PREP\s*TIME|COOK\s*TIME):/i.test(line)) {
      continue;
    }

    // Detect section headers. A header is a line that IS the word, not any
    // line mentioning it — "Mix all ingredients until smooth" is a step, and
    // treating it as a header moved the rest of the recipe into the wrong
    // list. Trailing punctuation and a parenthetical ("Ingredients (sauce):")
    // are still headers.
    if (INGREDIENTS_HEADER.test(stripDecoration(line))) {
      inIngredientsSection = true;
      inInstructionsSection = false;
      continue;
    }

    if (INSTRUCTIONS_HEADER.test(stripDecoration(line))) {
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

    const kind = classifyRecipeLine(line, {
      inIngredientsSection,
      inInstructionsSection,
      seenIngredient: ingredients.length > 0,
    });

    // Collect ingredient lines as raw text. Per-line parsing happens at the
    // caller via CRF — we used to call a regex parser here, but silent
    // regex output produces confident-looking-but-wrong quantities, which
    // is worse than knowing parsing failed.
    if (kind === 'ingredient') {
      const cleaned = line.replace(/^[\-\*•]\s*/, '').trim();
      if (cleaned.length > 0) {
        ingredients.push({ name: cleaned, quantity: undefined, unit: undefined, confidence: 0 });
      }
      continue;
    }

    if (kind === 'instruction') {
      const cleaned = cleanInstructionText(line);
      // A transcription may hand back the entire method as one line, so the
      // step divisions come from the sentences rather than the line breaks.
      // A line the recipe itself numbered is left whole.
      if (cleaned) {
        if (/^\d+[.)]\s/.test(line)) instructions.push(cleaned);
        else instructions.push(...splitIntoSteps(cleaned));
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
 * Clean up instruction text
 */
function cleanInstructionText(text: string): string {
  return text
    .replace(/^\d+[\.\)]\s*/, '') // Remove step numbers
    .replace(/^step\s*\d+[:\.\)]\s*/i, '') // Remove "Step N:" prefix
    .trim();
}
