import { db } from '../../config/database.js';
import { inventoryItems } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { ParsedIngredient, IngredientMatch } from '../../db/schema/recipes.js';
import type { InventoryItem, UnitConversion } from '../../db/schema/inventory.js';
import { findConversionChain as findGlobalConversion } from '../../lib/unit-conversions.js';

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
  'all-purpose flour': ['plain flour', 'ap flour', 'flour'],
  'plain flour': ['all-purpose flour', 'ap flour', 'flour'],
  'ap flour': ['all-purpose flour', 'plain flour', 'flour'],
  'flour': ['all-purpose flour', 'plain flour', 'ap flour'],
  'cornstarch': ['corn starch', 'corn flour', 'cornflour'],
  'corn starch': ['cornstarch', 'corn flour', 'cornflour'],
  'cornflour': ['cornstarch', 'corn starch', 'corn flour'],
  'heavy cream': ['double cream', 'whipping cream', 'heavy whipping cream'],
  'double cream': ['heavy cream', 'whipping cream', 'heavy whipping cream'],
  'whipping cream': ['heavy cream', 'double cream', 'heavy whipping cream'],
  'sour cream': ['creme fraiche', 'crema'],
  'creme fraiche': ['sour cream', 'crema'],
  'ground beef': ['minced beef', 'beef mince', 'hamburger meat', 'hamburger'],
  'minced beef': ['ground beef', 'beef mince', 'hamburger meat', 'hamburger'],
  'ground pork': ['minced pork', 'pork mince'],
  'minced pork': ['ground pork', 'pork mince'],
  'ground turkey': ['minced turkey', 'turkey mince'],
  'ground chicken': ['minced chicken', 'chicken mince'],
  'chicken breast': ['breast of chicken', 'chicken breasts', 'boneless chicken'],
  'chicken thigh': ['chicken thighs', 'thigh of chicken', 'boneless thigh'],
  'tomato paste': ['tomato puree', 'tomato concentrate'],
  'tomato puree': ['tomato paste', 'tomato concentrate'],
  'crushed tomato': ['crushed tomatoes', 'canned tomato', 'canned tomatoes'],
  'diced tomato': ['diced tomatoes', 'chopped tomato', 'chopped tomatoes'],
  'stock': ['broth', 'bouillon'],
  'broth': ['stock', 'bouillon'],
  'chicken stock': ['chicken broth'],
  'chicken broth': ['chicken stock'],
  'beef stock': ['beef broth'],
  'beef broth': ['beef stock'],
  'vegetable stock': ['vegetable broth', 'veggie broth'],
  'vegetable broth': ['vegetable stock', 'veggie stock'],
  'soy sauce': ['shoyu', 'soya sauce'],
  'fish sauce': ['nam pla', 'nuoc mam'],
  'garlic clove': ['garlic cloves', 'clove of garlic', 'cloves of garlic', 'garlic'],
  'garlic cloves': ['garlic clove', 'clove of garlic', 'cloves of garlic', 'garlic'],
  'garlic': ['garlic clove', 'garlic cloves'],
  'shallot': ['shallots'],
  'shallots': ['shallot'],
  'onion': ['onions', 'yellow onion'],
  'onions': ['onion', 'yellow onion'],
  'red onion': ['red onions'],
  'butter': ['unsalted butter', 'salted butter'],
  'unsalted butter': ['butter'],
  'olive oil': ['evoo', 'extra virgin olive oil'],
  'evoo': ['olive oil', 'extra virgin olive oil'],
  'vegetable oil': ['canola oil', 'neutral oil', 'cooking oil'],
  'canola oil': ['vegetable oil', 'neutral oil', 'cooking oil'],
  'salt': ['kosher salt', 'sea salt', 'table salt'],
  'kosher salt': ['salt', 'sea salt'],
  'black pepper': ['pepper', 'ground pepper', 'freshly ground pepper'],
  'pepper': ['black pepper', 'ground pepper'],
  'parmesan': ['parmigiano', 'parmesan cheese', 'parmigiano reggiano'],
  'parmesan cheese': ['parmesan', 'parmigiano', 'parmigiano reggiano'],
  'mozzarella': ['mozzarella cheese', 'fresh mozzarella'],
  'cheddar': ['cheddar cheese'],
  'cheddar cheese': ['cheddar'],
  'lemon juice': ['juice of lemon', 'fresh lemon juice'],
  'lime juice': ['juice of lime', 'fresh lime juice'],
  'baking soda': ['bicarbonate of soda', 'bicarb'],
  'bicarbonate of soda': ['baking soda', 'bicarb'],
  'baking powder': ['raising agent'],
  'vanilla extract': ['vanilla', 'pure vanilla extract'],
  'vanilla': ['vanilla extract', 'pure vanilla extract'],
  'egg': ['eggs', 'large egg', 'large eggs'],
  'eggs': ['egg', 'large egg', 'large eggs'],
  'milk': ['whole milk', 'regular milk'],
  'whole milk': ['milk'],
  'greek yogurt': ['greek yoghurt', 'plain yogurt', 'natural yogurt'],
  'yogurt': ['yoghurt', 'natural yogurt', 'plain yogurt'],
  'cream cheese': ['philadelphia', 'philly'],
  'mayonnaise': ['mayo'],
  'mayo': ['mayonnaise'],
  'worcestershire sauce': ['worcester sauce', 'lea & perrins'],
  'hot sauce': ['hot pepper sauce', 'tabasco', 'sriracha'],
  'rice': ['white rice', 'long grain rice'],
  'basmati rice': ['basmati'],
  'jasmine rice': ['jasmine'],
  'pasta': ['dried pasta', 'italian pasta'],
  'spaghetti': ['spaghetti pasta'],
  'linguine': ['linguini'],
  'fettuccine': ['fettuccini'],
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

export type MatchReason = 'exact' | 'synonym' | 'contains' | 'fuzzy';

export interface MatchSuggestion {
  itemId: string;
  name: string;
  confidence: number;
  matchReason: MatchReason;
  unitConversion?: {
    fromUnit: string;
    toUnit: string;
    factor: number;
  };
  needsConversion?: {
    fromUnit: string;
    toUnit: string;
    hasExisting: boolean;
    suggestedFactor?: number;
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

export interface SimilarityResult {
  score: number;
  reason: MatchReason;
}

/**
 * Calculate similarity score between two strings (0-1) with reason
 */
export function calculateSimilarityWithReason(a: string, b: string): SimilarityResult {
  const normA = normalizeIngredientName(a);
  const normB = normalizeIngredientName(b);

  // Exact match
  if (normA === normB) {
    return { score: 1.0, reason: 'exact' };
  }

  // Check for synonym match
  const synonymsA = INGREDIENT_SYNONYMS[normA] || [];
  if (synonymsA.includes(normB)) {
    return { score: 0.95, reason: 'synonym' };
  }

  // Check reverse synonym match
  const synonymsB = INGREDIENT_SYNONYMS[normB] || [];
  if (synonymsB.includes(normA)) {
    return { score: 0.95, reason: 'synonym' };
  }

  // Check if one contains the other
  if (normA.includes(normB) || normB.includes(normA)) {
    const longer = normA.length > normB.length ? normA : normB;
    const shorter = normA.length > normB.length ? normB : normA;
    return { score: 0.7 + (shorter.length / longer.length) * 0.25, reason: 'contains' };
  }

  // Check if starts with the same words
  if (normA.startsWith(normB) || normB.startsWith(normA)) {
    const longer = normA.length > normB.length ? normA : normB;
    const shorter = normA.length > normB.length ? normB : normA;
    return { score: 0.6 + (shorter.length / longer.length) * 0.3, reason: 'contains' };
  }

  // Token overlap - split into words and calculate overlap
  const tokensA = normA.split(' ').filter(t => t.length > 1);
  const tokensB = normB.split(' ').filter(t => t.length > 1);

  if (tokensA.length > 0 && tokensB.length > 0) {
    const overlap = tokensA.filter(t => tokensB.includes(t)).length;
    const tokenSimilarity = (2 * overlap) / (tokensA.length + tokensB.length);
    if (tokenSimilarity > 0.5) {
      return { score: 0.5 + tokenSimilarity * 0.35, reason: 'contains' };
    }
  }

  // Levenshtein distance-based similarity
  const maxLength = Math.max(normA.length, normB.length);
  const distance = levenshteinDistance(normA, normB);
  const similarity = 1 - distance / maxLength;

  return { score: Math.max(0, similarity), reason: 'fuzzy' };
}

/**
 * Calculate similarity score between two strings (0-1)
 */
export function calculateSimilarity(a: string, b: string): number {
  return calculateSimilarityWithReason(a, b).score;
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
 * Priority: item-specific > local STANDARD_CONVERSIONS > global conversions
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

  // Check local standard conversions (legacy)
  if (STANDARD_CONVERSIONS[normFrom]?.[normTo]) {
    return { fromUnit, toUnit, factor: STANDARD_CONVERSIONS[normFrom][normTo] };
  }
  if (STANDARD_CONVERSIONS[normTo]?.[normFrom]) {
    return { fromUnit, toUnit, factor: 1 / STANDARD_CONVERSIONS[normTo][normFrom] };
  }

  // Fall back to comprehensive global conversions (includes chains like cups→ml→liters)
  const globalFactor = findGlobalConversion(fromUnit, toUnit);
  if (globalFactor !== null) {
    return { fromUnit, toUnit, factor: globalFactor };
  }

  return undefined;
}

/**
 * Find a suggested conversion factor from standard conversions
 * Uses the shared global conversion utility for consistency
 */
function findSuggestedFactor(fromUnit: string, toUnit: string): number | undefined {
  // First try the legacy STANDARD_CONVERSIONS for backward compatibility
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (STANDARD_CONVERSIONS[normFrom]?.[normTo]) {
    return STANDARD_CONVERSIONS[normFrom][normTo];
  }
  if (STANDARD_CONVERSIONS[normTo]?.[normFrom]) {
    return 1 / STANDARD_CONVERSIONS[normTo][normFrom];
  }

  // Fall back to the comprehensive global conversions
  const globalFactor = findGlobalConversion(fromUnit, toUnit);
  return globalFactor !== null ? globalFactor : undefined;
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
      const { score: similarity, reason: matchReason } = calculateSimilarityWithReason(parsed.name, item.name);

      if (similarity >= 0.6) {
        const suggestion: MatchSuggestion = {
          itemId: item.id,
          name: item.name,
          confidence: similarity,
          matchReason,
        };

        // Check for unit conversion if units differ
        if (parsed.unit && item.defaultUnit) {
          const normFrom = normalizeUnit(parsed.unit);
          const normTo = normalizeUnit(item.defaultUnit);

          if (normFrom !== normTo) {
            const itemConversions = (item.unitConversions as UnitConversion[]) || [];
            const conversion = findUnitConversion(
              parsed.unit,
              item.defaultUnit,
              itemConversions
            );
            if (conversion) {
              suggestion.unitConversion = conversion;
            } else {
              // No conversion found - flag that one is needed
              // Check if item already has this conversion
              const hasExisting = itemConversions.some(c =>
                (normalizeUnit(c.fromUnit) === normFrom && normalizeUnit(c.toUnit) === normTo) ||
                (normalizeUnit(c.fromUnit) === normTo && normalizeUnit(c.toUnit) === normFrom)
              );
              suggestion.needsConversion = {
                fromUnit: parsed.unit,
                toUnit: item.defaultUnit,
                hasExisting,
                suggestedFactor: findSuggestedFactor(parsed.unit, item.defaultUnit),
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
        matchReason: s.matchReason,
        needsConversion: s.needsConversion,
      })),
    };

    // If there's a high-confidence match, set it as the matched item
    if (match.matchStatus === 'matched' && topSuggestions[0]) {
      match.matchedItemId = topSuggestions[0].itemId;
      match.matchedItemName = topSuggestions[0].name;
      match.confidence = topSuggestions[0].confidence;
      match.matchReason = topSuggestions[0].matchReason;
      if (topSuggestions[0].unitConversion) {
        match.unitConversion = topSuggestions[0].unitConversion;
      }
      if (topSuggestions[0].needsConversion) {
        match.needsConversion = topSuggestions[0].needsConversion;
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
    const { score: similarity, reason: matchReason } = calculateSimilarityWithReason(name, item.name);

    if (similarity >= 0.5) {
      const suggestion: MatchSuggestion = {
        itemId: item.id,
        name: item.name,
        confidence: similarity,
        matchReason,
      };

      if (unit && item.defaultUnit) {
        const normFrom = normalizeUnit(unit);
        const normTo = normalizeUnit(item.defaultUnit);

        if (normFrom !== normTo) {
          const itemConversions = (item.unitConversions as UnitConversion[]) || [];
          const conversion = findUnitConversion(
            unit,
            item.defaultUnit,
            itemConversions
          );
          if (conversion) {
            suggestion.unitConversion = conversion;
          } else {
            // No conversion found - flag that one is needed
            const hasExisting = itemConversions.some(c =>
              (normalizeUnit(c.fromUnit) === normFrom && normalizeUnit(c.toUnit) === normTo) ||
              (normalizeUnit(c.fromUnit) === normTo && normalizeUnit(c.toUnit) === normFrom)
            );
            suggestion.needsConversion = {
              fromUnit: unit,
              toUnit: item.defaultUnit,
              hasExisting,
              suggestedFactor: findSuggestedFactor(unit, item.defaultUnit),
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
