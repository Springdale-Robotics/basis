import { db } from '../../config/database.js';
import { inventoryItems, ingredientAliases } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { ParsedIngredient, IngredientMatch } from '../../db/schema/recipes.js';
import type { InventoryItem } from '../../db/schema/inventory.js';
import { findConversionChain as findGlobalConversion, getUnitCategory } from '../../lib/unit-conversions.js';
import { isCountUnit as isQuantityUnit } from '../../lib/units.js';

/**
 * Look up ingredient aliases from the database for a household.
 * Returns inventory item IDs that match the given ingredient name via alias.
 *
 * Directional matching:
 * - If recipe says "milk" (generic), we find items that have "milk" as an alias name
 *   (e.g., item "whole milk" with alias "milk" matches)
 * - If recipe says "whole milk" (specific), only items named "whole milk" or with
 *   alias "whole milk" match — the generic "milk" item does NOT match.
 */
async function findAliasCandidates(
  ingredientName: string,
  householdId: string,
): Promise<Array<{ itemId: string; itemName: string; aliasType: string }>> {
  const normalizedName = ingredientName.toLowerCase().trim();

  // Find items where the searched name is one of their aliases
  const aliasMatches = await db
    .select({
      itemId: ingredientAliases.canonicalItemId,
      aliasName: ingredientAliases.aliasName,
      aliasType: ingredientAliases.aliasType,
    })
    .from(ingredientAliases)
    .where(and(
      eq(ingredientAliases.householdId, householdId),
      eq(ingredientAliases.aliasName, normalizedName),
    ));

  // Get item names for matched IDs
  const results: Array<{ itemId: string; itemName: string; aliasType: string }> = [];
  for (const match of aliasMatches) {
    const item = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, match.itemId),
    });
    if (item) {
      results.push({
        itemId: item.id,
        itemName: item.name,
        aliasType: match.aliasType,
      });
    }
  }

  return results;
}

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
  needsQuantityWeight?: {
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

        // Check if a quantity unit weight is needed
        if (parsed.unit && item.defaultUnit) {
          const normFrom = normalizeUnit(parsed.unit);
          const normTo = normalizeUnit(item.defaultUnit);

          if (normFrom !== normTo) {
            const fromCat = getUnitCategory(normFrom);
            const toCat = getUnitCategory(normTo);
            // Only flag needsQuantityWeight for quantity units without saved weights
            if (fromCat === 'quantity' || toCat === 'quantity') {
              const quantityUnitSizes = (item.quantityUnitSizes as Record<string, { quantity: number; unit: string }>) || {};
              const qtyUnit = fromCat === 'quantity' ? normFrom : normTo;
              if (quantityUnitSizes[qtyUnit] == null) {
                suggestion.needsQuantityWeight = {
                  fromUnit: parsed.unit,
                  toUnit: item.defaultUnit,
                };
              }
            }
          }
        }

        suggestions.push(suggestion);
      }
    }

    // Check DB aliases for additional matches
    const aliasCandidates = await findAliasCandidates(parsed.name, householdId);
    for (const candidate of aliasCandidates) {
      // Don't duplicate items already found via name matching
      if (suggestions.some(s => s.itemId === candidate.itemId)) continue;
      suggestions.push({
        itemId: candidate.itemId,
        name: candidate.itemName,
        confidence: 0.92, // Between exact (1.0) and synonym (0.95) — alias is a known equivalence
        matchReason: 'synonym',
      });
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
        needsQuantityWeight: s.needsQuantityWeight,
      })),
    };

    // If there's a high-confidence match, set it as the matched item
    if (match.matchStatus === 'matched' && topSuggestions[0]) {
      match.matchedItemId = topSuggestions[0].itemId;
      match.matchedItemName = topSuggestions[0].name;
      match.confidence = topSuggestions[0].confidence;
      match.matchReason = topSuggestions[0].matchReason;
      if (topSuggestions[0].needsQuantityWeight) {
        match.needsQuantityWeight = topSuggestions[0].needsQuantityWeight;
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
          const fromCat = getUnitCategory(normFrom);
          const toCat = getUnitCategory(normTo);
          if (fromCat === 'quantity' || toCat === 'quantity') {
            const quantityUnitSizes = (item.quantityUnitSizes as Record<string, { quantity: number; unit: string }>) || {};
            const qtyUnit = fromCat === 'quantity' ? normFrom : normTo;
            if (quantityUnitSizes[qtyUnit] == null) {
              suggestion.needsQuantityWeight = {
                fromUnit: unit,
                toUnit: item.defaultUnit,
              };
            }
          }
        }
      }

      suggestions.push(suggestion);
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions.slice(0, 10);
}
