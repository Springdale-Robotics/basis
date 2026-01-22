import { db } from '../../config/database.js';
import { inventoryItems } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { ParsedIngredient, IngredientMatch } from '../../db/schema/recipes.js';
import type { InventoryItem, UnitConversion } from '../../db/schema/inventory.js';

// Common ingredient synonyms for matching
const INGREDIENT_SYNONYMS: Record<string, string[]> = {
  'cilantro': ['coriander', 'chinese parsley', 'fresh coriander'],
  'coriander': ['cilantro', 'chinese parsley', 'fresh coriander'],
  'scallion': ['green onion', 'spring onion', 'bunching onion'],
  'green onion': ['scallion', 'spring onion', 'bunching onion'],
  'spring onion': ['scallion', 'green onion', 'bunching onion'],
  'bell pepper': ['capsicum', 'sweet pepper'],
  'capsicum': ['bell pepper', 'sweet pepper'],
  'aubergine': ['eggplant'],
  'eggplant': ['aubergine'],
  'courgette': ['zucchini'],
  'zucchini': ['courgette'],
  'rocket': ['arugula'],
  'arugula': ['rocket'],
  'caster sugar': ['superfine sugar', 'fine sugar'],
  'superfine sugar': ['caster sugar', 'fine sugar'],
  'icing sugar': ['powdered sugar', 'confectioners sugar'],
  'powdered sugar': ['icing sugar', 'confectioners sugar'],
  'all-purpose flour': ['plain flour', 'ap flour'],
  'plain flour': ['all-purpose flour', 'ap flour'],
  'cornstarch': ['corn starch', 'corn flour'],
  'corn flour': ['cornstarch', 'corn starch'],
  'heavy cream': ['double cream', 'whipping cream'],
  'double cream': ['heavy cream', 'whipping cream'],
  'sour cream': ['creme fraiche'],
  'creme fraiche': ['sour cream'],
  'ground beef': ['minced beef', 'beef mince', 'hamburger meat'],
  'minced beef': ['ground beef', 'beef mince', 'hamburger meat'],
  'chicken breast': ['breast of chicken', 'chicken breasts'],
  'chicken thigh': ['chicken thighs', 'thigh of chicken'],
  'tomato paste': ['tomato puree', 'tomato concentrate'],
  'tomato puree': ['tomato paste', 'tomato concentrate'],
  'stock': ['broth', 'bouillon'],
  'broth': ['stock', 'bouillon'],
  'soy sauce': ['shoyu', 'soya sauce'],
  'fish sauce': ['nam pla', 'nuoc mam'],
  'garlic clove': ['garlic cloves', 'clove of garlic', 'cloves of garlic'],
  'garlic cloves': ['garlic clove', 'clove of garlic', 'cloves of garlic'],
};

// Common unit mappings for conversion suggestions
const UNIT_MAPPINGS: Record<string, string[]> = {
  'cup': ['cups', 'c'],
  'cups': ['cup', 'c'],
  'tablespoon': ['tbsp', 'tablespoons', 'tbs', 'T'],
  'tbsp': ['tablespoon', 'tablespoons', 'tbs', 'T'],
  'teaspoon': ['tsp', 'teaspoons', 't'],
  'tsp': ['teaspoon', 'teaspoons', 't'],
  'ounce': ['oz', 'ounces'],
  'oz': ['ounce', 'ounces'],
  'pound': ['lb', 'lbs', 'pounds'],
  'lb': ['pound', 'lbs', 'pounds'],
  'gram': ['g', 'grams', 'gm'],
  'g': ['gram', 'grams', 'gm'],
  'kilogram': ['kg', 'kilograms', 'kilo'],
  'kg': ['kilogram', 'kilograms', 'kilo'],
  'milliliter': ['ml', 'milliliters', 'mL'],
  'ml': ['milliliter', 'milliliters', 'mL'],
  'liter': ['l', 'liters', 'L', 'litre', 'litres'],
  'l': ['liter', 'liters', 'L', 'litre', 'litres'],
  'piece': ['pieces', 'pcs', 'pc'],
  'pieces': ['piece', 'pcs', 'pc'],
  'clove': ['cloves'],
  'cloves': ['clove'],
  'bunch': ['bunches'],
  'bunches': ['bunch'],
  'head': ['heads'],
  'heads': ['head'],
  'can': ['cans', 'tin', 'tins'],
  'cans': ['can', 'tin', 'tins'],
};

// Standard unit conversions for common measurements
const STANDARD_CONVERSIONS: Record<string, Record<string, number>> = {
  // Volume
  'cup': { 'ml': 236.588, 'tbsp': 16, 'tsp': 48, 'oz': 8 },
  'tbsp': { 'ml': 14.787, 'tsp': 3, 'cup': 0.0625 },
  'tsp': { 'ml': 4.929, 'tbsp': 0.333 },
  // Weight
  'lb': { 'oz': 16, 'g': 453.592, 'kg': 0.454 },
  'oz': { 'g': 28.3495, 'lb': 0.0625 },
  'kg': { 'g': 1000, 'lb': 2.205 },
  'g': { 'kg': 0.001, 'oz': 0.0353 },
  // Metric volume
  'l': { 'ml': 1000, 'cup': 4.227 },
  'ml': { 'l': 0.001, 'tsp': 0.203, 'tbsp': 0.068 },
};

export interface IngredientMatchResult {
  parsed: ParsedIngredient;
  match: IngredientMatch;
}

export interface MatchSuggestion {
  itemId: string;
  name: string;
  confidence: number;
  unitConversion?: {
    fromUnit: string;
    toUnit: string;
    factor: number;
  };
  needsConversion?: {
    fromUnit: string;
    toUnit: string;
  };
}

/**
 * Normalize an ingredient name for matching
 * - Lowercase
 * - Remove parentheticals
 * - Stem common plurals
 * - Trim whitespace
 */
export function normalizeIngredientName(name: string): string {
  let normalized = name.toLowerCase();

  // Remove parenthetical content (e.g., "tomatoes (diced)")
  normalized = normalized.replace(/\([^)]*\)/g, '');

  // Remove common descriptor phrases
  normalized = normalized.replace(/\b(fresh|dried|frozen|organic|large|medium|small|chopped|diced|minced|sliced|cubed|grated|shredded|crushed|ground|whole|raw|cooked|canned|packed|loosely|tightly|finely|roughly|boneless|skinless)\b/g, '');

  // Simple plural stemming - remove trailing 's' or 'es'
  normalized = normalized.replace(/ies$/i, 'y'); // berries -> berry
  normalized = normalized.replace(/ves$/i, 'f'); // halves -> half
  normalized = normalized.replace(/([^s])es$/i, '$1'); // tomatoes -> tomato
  normalized = normalized.replace(/([^aeiou])s$/i, '$1'); // onions -> onion

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0-1)
 */
export function calculateSimilarity(a: string, b: string): number {
  const normA = normalizeIngredientName(a);
  const normB = normalizeIngredientName(b);

  // Exact match
  if (normA === normB) {
    return 1.0;
  }

  // Check for synonym match
  const synonymsA = INGREDIENT_SYNONYMS[normA] || [];
  if (synonymsA.includes(normB)) {
    return 0.95;
  }

  // Check if one contains the other
  if (normA.includes(normB) || normB.includes(normA)) {
    const longer = normA.length > normB.length ? normA : normB;
    const shorter = normA.length > normB.length ? normB : normA;
    return 0.7 + (shorter.length / longer.length) * 0.25;
  }

  // Check if starts with the same words
  if (normA.startsWith(normB) || normB.startsWith(normA)) {
    const longer = normA.length > normB.length ? normA : normB;
    const shorter = normA.length > normB.length ? normB : normA;
    return 0.6 + (shorter.length / longer.length) * 0.3;
  }

  // Token overlap - split into words and calculate overlap
  const tokensA = normA.split(' ').filter(t => t.length > 1);
  const tokensB = normB.split(' ').filter(t => t.length > 1);

  if (tokensA.length > 0 && tokensB.length > 0) {
    const overlap = tokensA.filter(t => tokensB.includes(t)).length;
    const tokenSimilarity = (2 * overlap) / (tokensA.length + tokensB.length);
    if (tokenSimilarity > 0.5) {
      return 0.5 + tokenSimilarity * 0.35;
    }
  }

  // Levenshtein distance-based similarity
  const maxLength = Math.max(normA.length, normB.length);
  const distance = levenshteinDistance(normA, normB);
  const similarity = 1 - distance / maxLength;

  return Math.max(0, similarity);
}

/**
 * Normalize unit names for comparison
 */
function normalizeUnit(unit: string): string {
  const normalized = unit.toLowerCase().trim();

  // Map to canonical form
  const canonicalMap: Record<string, string> = {
    'cups': 'cup',
    'c': 'cup',
    'tablespoons': 'tbsp',
    'tbs': 'tbsp',
    't': 'tbsp',
    'teaspoons': 'tsp',
    'ounces': 'oz',
    'pounds': 'lb',
    'lbs': 'lb',
    'grams': 'g',
    'gm': 'g',
    'kilograms': 'kg',
    'kilo': 'kg',
    'milliliters': 'ml',
    'liters': 'l',
    'litres': 'l',
    'pieces': 'piece',
    'pcs': 'piece',
    'pc': 'piece',
  };

  return canonicalMap[normalized] || normalized;
}

/**
 * Find unit conversion between two units
 */
function findUnitConversion(
  fromUnit: string,
  toUnit: string,
  itemConversions: UnitConversion[]
): { fromUnit: string; toUnit: string; factor: number } | undefined {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) {
    return undefined; // No conversion needed
  }

  // Check item-specific conversions first
  for (const conv of itemConversions) {
    if (normalizeUnit(conv.fromUnit) === normFrom && normalizeUnit(conv.toUnit) === normTo) {
      return { fromUnit, toUnit, factor: conv.factor };
    }
    if (normalizeUnit(conv.fromUnit) === normTo && normalizeUnit(conv.toUnit) === normFrom) {
      return { fromUnit, toUnit, factor: 1 / conv.factor };
    }
  }

  // Check standard conversions
  if (STANDARD_CONVERSIONS[normFrom]?.[normTo]) {
    return { fromUnit, toUnit, factor: STANDARD_CONVERSIONS[normFrom][normTo] };
  }
  if (STANDARD_CONVERSIONS[normTo]?.[normFrom]) {
    return { fromUnit, toUnit, factor: 1 / STANDARD_CONVERSIONS[normTo][normFrom] };
  }

  return undefined;
}

/**
 * Match parsed ingredients against inventory items
 */
export async function matchIngredients(
  ingredients: ParsedIngredient[],
  householdId: string
): Promise<IngredientMatchResult[]> {
  // Get all inventory items for the household
  const items = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  const results: IngredientMatchResult[] = [];

  for (const parsed of ingredients) {
    const suggestions: MatchSuggestion[] = [];

    // Calculate similarity for each inventory item
    for (const item of items) {
      const similarity = calculateSimilarity(parsed.name, item.name);

      if (similarity >= 0.6) {
        const suggestion: MatchSuggestion = {
          itemId: item.id,
          name: item.name,
          confidence: similarity,
        };

        // Check for unit conversion if units differ
        if (parsed.unit && item.defaultUnit) {
          const normFrom = normalizeUnit(parsed.unit);
          const normTo = normalizeUnit(item.defaultUnit);

          if (normFrom !== normTo) {
            const conversion = findUnitConversion(
              parsed.unit,
              item.defaultUnit,
              (item.unitConversions as UnitConversion[]) || []
            );
            if (conversion) {
              suggestion.unitConversion = conversion;
            } else {
              // No conversion found - flag that one is needed
              suggestion.needsConversion = {
                fromUnit: parsed.unit,
                toUnit: item.defaultUnit,
              };
            }
          }
        }

        suggestions.push(suggestion);
      }
    }

    // Sort by confidence and take top 5
    suggestions.sort((a, b) => b.confidence - a.confidence);
    const topSuggestions = suggestions.slice(0, 5);

    // Build match result
    const match: IngredientMatch = {
      parsedName: parsed.name,
      parsedQuantity: parsed.quantity,
      parsedUnit: parsed.unit,
      matchStatus: topSuggestions.length > 0 && topSuggestions[0].confidence >= 0.85
        ? 'matched'
        : 'unmatched',
      suggestions: topSuggestions.map(s => ({
        itemId: s.itemId,
        name: s.name,
        confidence: s.confidence,
      })),
    };

    // If there's a high-confidence match, set it as the matched item
    if (match.matchStatus === 'matched' && topSuggestions[0]) {
      match.matchedItemId = topSuggestions[0].itemId;
      match.matchedItemName = topSuggestions[0].name;
      match.confidence = topSuggestions[0].confidence;
      if (topSuggestions[0].unitConversion) {
        match.unitConversion = topSuggestions[0].unitConversion;
      }
    }

    results.push({ parsed, match });
  }

  return results;
}

/**
 * Match a single ingredient name against inventory items
 * Returns top suggestions
 */
export async function matchSingleIngredient(
  name: string,
  householdId: string,
  unit?: string
): Promise<MatchSuggestion[]> {
  const items = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  const suggestions: MatchSuggestion[] = [];

  for (const item of items) {
    const similarity = calculateSimilarity(name, item.name);

    if (similarity >= 0.5) {
      const suggestion: MatchSuggestion = {
        itemId: item.id,
        name: item.name,
        confidence: similarity,
      };

      if (unit && item.defaultUnit) {
        const normFrom = normalizeUnit(unit);
        const normTo = normalizeUnit(item.defaultUnit);

        if (normFrom !== normTo) {
          const conversion = findUnitConversion(
            unit,
            item.defaultUnit,
            (item.unitConversions as UnitConversion[]) || []
          );
          if (conversion) {
            suggestion.unitConversion = conversion;
          } else {
            // No conversion found - flag that one is needed
            suggestion.needsConversion = {
              fromUnit: unit,
              toUnit: item.defaultUnit,
            };
          }
        }
      }

      suggestions.push(suggestion);
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions.slice(0, 10);
}
