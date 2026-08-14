import { db } from '../../config/database.js';
import { inventoryItems, ingredientAliases, type InventoryItem } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { ParsedIngredient, IngredientMatch } from '../../db/schema/recipes.js';
import { getUnitCategory } from '../../lib/unit-conversions.js';

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

/**
 * Groups of names that mean the same pantry item.
 *
 * Authored as equivalence groups rather than a hand-maintained
 * name -> synonyms map, because the map form drifted: entries were asymmetric
 * (a match depended on which argument came first), and 13 of 99 keys were
 * unreachable because lookups happen on *normalized* names and normalization
 * rewrote the key. Deriving the map from groups makes both properties
 * structural rather than something a future edit has to remember.
 *
 * Write group members in their natural form; they are normalized on load.
 */
const SYNONYM_GROUPS: string[][] = [
  ['cilantro', 'coriander', 'chinese parsley', 'fresh coriander'],
  ['scallion', 'green onion', 'spring onion', 'bunching onion'],
  ['bell pepper', 'capsicum', 'sweet pepper'],
  ['aubergine', 'eggplant'],
  ['courgette', 'zucchini'],
  ['rocket', 'arugula'],
  ['caster sugar', 'superfine sugar', 'fine sugar'],
  ['icing sugar', 'powdered sugar', 'confectioners sugar'],
  ['all-purpose flour', 'plain flour', 'ap flour', 'flour'],
  ['cornstarch', 'corn starch', 'corn flour', 'cornflour'],
  ['heavy cream', 'double cream', 'whipping cream', 'heavy whipping cream'],
  ['sour cream', 'creme fraiche', 'crema'],
  ['ground beef', 'minced beef', 'beef mince', 'hamburger meat', 'hamburger'],
  ['ground pork', 'minced pork', 'pork mince'],
  ['ground turkey', 'minced turkey', 'turkey mince'],
  ['ground chicken', 'minced chicken', 'chicken mince'],
  ['chicken breast', 'breast of chicken'],
  ['chicken thigh', 'thigh of chicken'],
  ['tomato paste', 'tomato puree', 'tomato concentrate'],
  ['crushed tomato', 'canned tomato'],
  ['stock', 'broth', 'bouillon'],
  ['chicken stock', 'chicken broth'],
  ['beef stock', 'beef broth'],
  ['vegetable stock', 'vegetable broth', 'veggie broth', 'veggie stock'],
  ['soy sauce', 'shoyu', 'soya sauce'],
  ['fish sauce', 'nam pla', 'nuoc mam'],
  ['garlic clove', 'clove of garlic', 'garlic'],
  ['onion', 'yellow onion'],
  ['butter', 'unsalted butter', 'salted butter'],
  ['olive oil', 'evoo', 'extra virgin olive oil'],
  ['vegetable oil', 'canola oil', 'neutral oil', 'cooking oil'],
  ['salt', 'kosher salt', 'sea salt', 'table salt'],
  ['black pepper', 'pepper', 'ground pepper'],
  ['parmesan', 'parmigiano', 'parmesan cheese', 'parmigiano reggiano'],
  ['mozzarella', 'mozzarella cheese', 'fresh mozzarella'],
  ['cheddar', 'cheddar cheese'],
  ['lemon juice', 'juice of lemon', 'fresh lemon juice'],
  ['lime juice', 'juice of lime', 'fresh lime juice'],
  ['baking soda', 'bicarbonate of soda', 'bicarb'],
  ['baking powder', 'raising agent'],
  ['vanilla extract', 'vanilla', 'pure vanilla extract'],
  ['milk', 'whole milk', 'regular milk'],
  ['greek yogurt', 'greek yoghurt'],
  ['yogurt', 'yoghurt', 'natural yogurt', 'plain yogurt'],
  ['cream cheese', 'philadelphia', 'philly'],
  ['mayonnaise', 'mayo'],
  ['worcestershire sauce', 'worcester sauce', 'lea & perrins'],
  ['hot sauce', 'hot pepper sauce', 'tabasco'],
  ['rice', 'white rice', 'long grain rice'],
  ['basmati rice', 'basmati'],
  ['jasmine rice', 'jasmine'],
  ['pasta', 'dried pasta', 'italian pasta'],
  ['spaghetti', 'spaghetti pasta'],
  ['linguine', 'linguini'],
  ['fettuccine', 'fettuccini'],
];

// The lookup index derived from these groups is built below, once the
// normalizer it depends on has been declared.

export interface IngredientMatchResult {
  parsed: ParsedIngredient;
  match: IngredientMatch;
}

export type MatchReason = 'exact' | 'synonym' | 'contains' | 'fuzzy' | 'related';

/**
 * At or above this, a suggestion is applied automatically without the user
 * choosing it. Anything that can silently mislink an ingredient must stay
 * below it.
 */
export const AUTO_MATCH_THRESHOLD = 0.85;

/** Below this a candidate isn't worth showing at all. */
export const SUGGESTION_THRESHOLD = 0.6;

/** Looser floor for the single-ingredient endpoint, which is user-driven. */
export const SINGLE_MATCH_THRESHOLD = 0.5;

/**
 * Ceiling for pairs whose preservation state disagrees (dried vs canned).
 * Deliberately just under AUTO_MATCH_THRESHOLD: shown first in the list,
 * never applied on the user's behalf.
 */
const STATE_MISMATCH_CAP = 0.8;

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
 * Loose normalization — the PERSISTED KEY FORMAT.
 *
 * This function's exact output is stored, not just computed: it is the
 * `ingredient_aliases.alias_name` key written by recipe import, and (through
 * `normalizeReceiptLine`) the `receipt_line_links.line_key` written by receipt
 * scanning. Both the recipes and receipts modules look aliases up with it.
 *
 * That makes it effectively a migration surface. Changing what it returns
 * orphans every learned link in every household, so it is deliberately frozen,
 * quirks included — notably `ves$ -> f` ("olives" -> "olif"), which is wrong as
 * English but harmless as a key, since both sides of every comparison run
 * through it. `backend/test/recipes/ingredient-matching.test.ts` pins the
 * shapes that are already in the wild.
 *
 * For deciding whether two ingredients are the same thing, use
 * `normalizeIngredientIdentity` instead.
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
 * Words describing how an ingredient was *prepared*. These say nothing about
 * which pantry item to reach for, so they are noise for matching.
 *
 * CRF usually pulls these into `notes` before we ever see them; this is the
 * safety net for the lines it doesn't.
 */
export const PREPARATION_DESCRIPTORS = new Set([
  'chopped', 'diced', 'sliced', 'cubed', 'julienned', 'quartered', 'halved',
  'grated', 'shredded', 'crumbled', 'mashed', 'beaten', 'whisked', 'melted',
  'softened', 'peeled', 'trimmed', 'drained', 'rinsed', 'washed', 'seeded',
  'stemmed', 'packed', 'divided', 'optional', 'organic',
  'finely', 'roughly', 'coarsely', 'thinly', 'thickly', 'loosely', 'tightly',
  'freshly', 'lightly', 'well',
  'large', 'medium', 'small', 'boneless', 'skinless',
]);

/**
 * Words that make an ingredient a *different item* rather than the same item
 * prepared differently. Dried chickpeas and canned chickpeas are two entries in
 * a pantry, with different units, shelf lives and weights.
 *
 * Deliberately NOT stripped, unlike in `normalizeIngredientName`.
 */
export const IDENTITY_DESCRIPTORS = new Set([
  'fresh', 'dried', 'frozen', 'canned', 'tinned', 'jarred', 'cooked', 'raw',
  'ground', 'minced', 'whole', 'crushed', 'stewed', 'pureed',
  'smoked', 'salted', 'unsalted', 'sweetened', 'unsweetened',
  'toasted', 'roasted', 'pickled', 'candied',
]);

/**
 * Words ending in -ves whose singular is -ve, not -f. The blanket
 * `-ves -> -f` rule turns "olives" into "olif" and "cloves" into "clof", so
 * neither ever matched its singular.
 */
const VES_PLURAL_EXCEPTIONS: Record<string, string> = {
  olives: 'olive',
  cloves: 'clove',
  chives: 'chive',
  gloves: 'glove',
  staves: 'stave',
  knives: 'knife',
  lives: 'life',
  wives: 'wife',
};

/** Singular words that happen to end in -s. */
const UNCOUNTABLE_TOKENS = new Set([
  'molasses', 'hummus', 'couscous', 'asparagus', 'watercress', 'swiss',
  'bass', 'cress', 'anise',
]);

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (UNCOUNTABLE_TOKENS.has(token)) return token;
  if (VES_PLURAL_EXCEPTIONS[token]) return VES_PLURAL_EXCEPTIONS[token];
  if (/ies$/.test(token)) return token.replace(/ies$/, 'y'); // berries -> berry
  if (/ves$/.test(token)) return token.replace(/ves$/, 'f'); // halves -> half
  // Only the endings that genuinely take "-es": tomatoes, peaches, squashes,
  // boxes. A blanket "-es" strip mangles "juices" into "juic".
  if (/(oes|ches|shes|xes|zes)$/.test(token)) return token.replace(/es$/, '');
  if (/ss$/.test(token)) return token;
  if (/s$/.test(token)) return token.slice(0, -1); // chickpeas -> chickpea
  return token;
}

/**
 * Identity normalization — the MATCHING form.
 *
 * Strips preparation noise and plurals while keeping the words that
 * distinguish one pantry item from another. Free to evolve: nothing persists
 * its output.
 */
export function normalizeIngredientIdentity(name: string): string {
  const withoutParentheticals = name.toLowerCase().replace(/\([^)]*\)/g, ' ');
  return withoutParentheticals
    // Hyphens and commas are punctuation between words, not part of them:
    // "extra-virgin olive oil" must match "extra virgin olive oil".
    .replace(/[-–—,/]/g, ' ')
    .replace(/[^a-z0-9%&\s]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !PREPARATION_DESCRIPTORS.has(token))
    .map(singularizeToken)
    .join(' ')
    .trim();
}

/** How an ingredient is stored/preserved — the axis that makes two otherwise
 *  identical names different pantry items. */
export type PreservationState = 'fresh' | 'dried' | 'canned' | 'frozen' | 'cooked';

const STATE_WORDS: Record<string, PreservationState> = {
  fresh: 'fresh',
  raw: 'fresh',
  dried: 'dried',
  dehydrated: 'dried',
  canned: 'canned',
  tinned: 'canned',
  jarred: 'canned',
  frozen: 'frozen',
  cooked: 'cooked',
};

/** Container units imply a canned/jarred product even when the name doesn't say so. */
const CONTAINER_UNITS = new Set(['can', 'cans', 'tin', 'tins', 'jar', 'jars']);

/**
 * Read an ingredient's preservation state from its name, falling back to the
 * unit ("1 can crushed tomatoes" is a canned product however it's worded).
 * Returns null when nothing says — most item names are unmarked, and an
 * unmarked name is compatible with anything.
 */
export function preservationStateOf(name: string, unit?: string): PreservationState | null {
  for (const token of normalizeIngredientIdentity(name).split(' ')) {
    if (STATE_WORDS[token]) return STATE_WORDS[token];
  }
  if (unit && CONTAINER_UNITS.has(unit.toLowerCase().trim())) return 'canned';
  return null;
}

function stripStateWords(normalized: string): string {
  return normalized
    .split(' ')
    .filter((token) => !STATE_WORDS[token])
    .join(' ')
    .trim();
}

function buildSynonymIndex(groups: string[][]): Record<string, string[]> {
  const index: Record<string, Set<string>> = {};
  for (const group of groups) {
    const members = [...new Set(group.map(normalizeIngredientIdentity))].filter(Boolean);
    for (const member of members) {
      index[member] ??= new Set();
      for (const other of members) {
        if (other !== member) index[member].add(other);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(index)
      .filter(([, others]) => others.size > 0)
      .map(([name, others]) => [name, [...others]])
  );
}

/** Derived lookup: normalized name -> other normalized names meaning the same thing. */
export const INGREDIENT_SYNONYMS: Record<string, string[]> = buildSynonymIndex(SYNONYM_GROUPS);

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
 * Calculate similarity score between two strings (0-1) with reason.
 *
 * `opts.unitA` lets the caller pass the recipe's unit so "1 can crushed
 * tomatoes" is recognised as a canned product even though the name alone
 * doesn't say so.
 */
export function calculateSimilarityWithReason(
  a: string,
  b: string,
  opts?: { unitA?: string }
): SimilarityResult {
  const normA = normalizeIngredientIdentity(a);
  const normB = normalizeIngredientIdentity(b);

  // Preservation-state guard. "canned chickpeas" and "dried chickpeas" used to
  // score a perfect 1.0 "exact" — the loose normalizer deleted the only word
  // telling them apart, so imports silently linked a recipe to the wrong
  // pantry item. When both sides state a form and the forms disagree, score
  // the underlying ingredient (so the pairing is still offered, prominently)
  // but hold it below the auto-link threshold: this is the user's call.
  const stateA = preservationStateOf(a, opts?.unitA);
  const stateB = preservationStateOf(b);
  if (stateA && stateB && stateA !== stateB) {
    const bare = calculateSimilarityWithReason(stripStateWords(normA), stripStateWords(normB));
    return {
      score: Math.min(bare.score, STATE_MISMATCH_CAP),
      reason: 'related',
    };
  }

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
      const { score: similarity, reason: matchReason } = calculateSimilarityWithReason(
        parsed.name,
        item.name,
        { unitA: parsed.unit }
      );

      if (similarity >= SUGGESTION_THRESHOLD) {
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
      matchStatus: topSuggestions.length > 0 && topSuggestions[0].confidence >= AUTO_MATCH_THRESHOLD
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
 *
 * `items` is an optional pre-fetched catalog. Callers that need to score many
 * names against the same household in one request (e.g. a receipt scan with
 * dozens of lines) should fetch the catalog once and pass it here — without
 * it, every call re-queries the household's entire inventory.
 *
 * CONTRACT: when `items` is supplied, tenancy scoping becomes the caller's
 * responsibility — this function trusts the list instead of re-querying by
 * `householdId`. This service is shared with the recipes module, so every
 * new caller that passes `items` MUST have fetched it scoped to the same
 * `householdId` passed here. Violating that lets one household's items match
 * against another household's ingredient text. Checked at runtime below
 * rather than merely documented, since a caller getting this wrong would
 * otherwise fail silently.
 */
export async function matchSingleIngredient(
  name: string,
  householdId: string,
  unit?: string,
  items?: InventoryItem[]
): Promise<MatchSuggestion[]> {
  if (items && !items.every((item) => item.householdId === householdId)) {
    throw new Error(
      'matchSingleIngredient: pre-fetched items must all belong to householdId — the caller is responsible for scoping them.'
    );
  }

  const catalog = items ?? await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  const suggestions: MatchSuggestion[] = [];

  for (const item of catalog) {
    const { score: similarity, reason: matchReason } = calculateSimilarityWithReason(
      name,
      item.name,
      { unitA: unit }
    );

    if (similarity >= SINGLE_MATCH_THRESHOLD) {
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
