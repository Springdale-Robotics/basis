/**
 * Utilities for simplifying ingredient names into clean inventory item names
 * and auto-detecting categories.
 *
 * Uses the CRF parser (via VLM-LLM service) for name extraction when available,
 * with a simple fallback for when the service isn't running.
 */

import { parseIngredientsWithCRF } from './crf-ingredient-parser.js';

// Category detection from ingredient keywords
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Meat': ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'steak', 'ground meat',
    'sausage', 'bacon', 'ham', 'veal', 'bison', 'duck', 'goose', 'venison',
    'prosciutto', 'pancetta', 'chorizo', 'pepperoni', 'salami'],
  'Seafood': ['salmon', 'tuna', 'shrimp', 'cod', 'tilapia', 'halibut', 'crab',
    'lobster', 'scallop', 'mussels', 'clams', 'oyster', 'anchovy', 'sardine',
    'fish', 'seafood', 'calamari', 'squid', 'octopus', 'prawns'],
  'Dairy & Eggs': ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'egg', 'eggs',
    'sour cream', 'cream cheese', 'ricotta', 'mozzarella', 'parmesan',
    'cheddar', 'feta', 'mascarpone', 'buttermilk', 'ghee', 'cottage cheese'],
  'Produce': ['onion', 'garlic', 'tomato', 'potato', 'carrot', 'celery',
    'pepper', 'lettuce', 'spinach', 'kale', 'broccoli', 'cauliflower',
    'zucchini', 'cucumber', 'mushroom', 'avocado', 'lemon', 'lime',
    'ginger', 'jalapeño', 'shallot', 'leek', 'scallion', 'green onion'],
  'Baking': ['flour', 'sugar', 'baking soda', 'baking powder', 'yeast',
    'vanilla extract', 'cocoa', 'chocolate chips', 'cornstarch',
    'powdered sugar', 'brown sugar', 'molasses', 'corn syrup'],
  'Spices & Herbs': ['salt', 'pepper', 'black pepper', 'white pepper', 'cinnamon', 'cumin', 'paprika',
    'oregano', 'thyme', 'rosemary', 'basil', 'bay leaf', 'nutmeg',
    'turmeric', 'chili powder', 'cayenne', 'garlic powder', 'onion powder',
    'italian seasoning', 'curry powder', 'red pepper flakes', 'parsley',
    'cilantro', 'dill', 'mint', 'chives', 'sage', 'sea salt', 'kosher salt'],
  'Condiments & Sauces': ['soy sauce', 'worcestershire', 'hot sauce', 'ketchup',
    'mustard', 'mayonnaise', 'vinegar', 'sriracha', 'teriyaki', 'fish sauce',
    'oyster sauce', 'hoisin', 'bbq sauce', 'salsa', 'pesto', 'tahini',
    'miso', 'gochujang', 'harissa'],
  'Pasta & Grains': ['pasta', 'spaghetti', 'penne', 'fusilli', 'macaroni',
    'noodle', 'rice', 'quinoa', 'couscous', 'barley', 'farro',
    'orzo', 'lasagna', 'linguine', 'oats', 'oatmeal'],
  'Canned Goods': ['diced tomatoes', 'crushed tomatoes', 'tomato paste',
    'tomato sauce', 'coconut milk', 'chickpeas', 'black beans',
    'kidney beans', 'broth', 'stock'],
  'Bakery': ['bread', 'rolls', 'tortilla', 'pita', 'naan', 'baguette',
    'bagel', 'croutons', 'breadcrumbs', 'panko'],
};

// Identity descriptors that are usually NOT part of the inventory item name
// (CRF strips preparation words, but keeps these)
const IDENTITY_DESCRIPTORS = new Set([
  'boneless', 'skinless', 'bone-in', 'skin-on',
  'fresh', 'dried', 'frozen', 'canned', 'raw', 'cooked',
  'organic', 'conventional',
  'large', 'medium', 'small', 'extra-large', 'jumbo',
  'low-sodium', 'low-fat', 'nonfat', 'whole', 'reduced-fat',
  'extra-virgin', 'virgin',
  'unsalted', 'salted',
  'ripe', 'unripe', 'overripe',
]);

/**
 * Simplify parsed ingredient names into clean inventory item names.
 * Uses CRF parser to extract the ingredient name (stripping preparation),
 * then strips identity descriptors for a clean item name.
 *
 * "boneless, skinless chicken breasts" → "Chicken Breast"
 * "fresh Italian parsley, chopped" → "Italian Parsley"
 * "extra-virgin olive oil" → "Olive Oil"
 *
 * Falls back to simple cleanup if CRF is unavailable.
 */
export async function simplifyIngredientNames(
  parsedNames: string[]
): Promise<string[]> {
  const crfResults = await parseIngredientsWithCRF(parsedNames);

  return crfResults.map((r, i) => {
    let name = r.name || parsedNames[i];
    // CRF strips prep but keeps identity descriptors — strip those too
    name = stripIdentityDescriptors(name);
    return singularize(toTitleCase(name));
  });
}

/**
 * Remove identity descriptors from an ingredient name.
 * "boneless, skinless chicken breasts" → "chicken breasts"
 * "extra-virgin olive oil" → "olive oil"
 */
function stripIdentityDescriptors(name: string): string {
  const words = name.split(/[\s,]+/).filter(w => {
    const lower = w.toLowerCase().replace(/[^a-z-]/g, '');
    return lower.length > 0 && !IDENTITY_DESCRIPTORS.has(lower);
  });
  return words.length > 0 ? words.join(' ') : name;
}

/**
 * Simplify a single ingredient name. Async since it may call CRF.
 */
export async function simplifyIngredientName(parsedName: string): Promise<string> {
  const results = await simplifyIngredientNames([parsedName]);
  return results[0];
}

/**
 * Title case a string.
 */
function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Simple singularize for display (breasts → Breast, tomatoes → Tomato).
 */
function singularize(str: string): string {
  return str
    .replace(/ies$/i, 'y')
    .replace(/([^s])es$/i, '$1')
    .replace(/([^aeiou])s$/i, '$1');
}

/**
 * Auto-detect a category from an ingredient name.
 * Returns the best matching category or undefined.
 */
export function detectCategory(ingredientName: string): string | undefined {
  const lower = ingredientName.toLowerCase();

  let bestCategory: string | undefined;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        const score = keyword.length;
        if (score > bestScore) {
          bestScore = score;
          bestCategory = category;
        }
      }
    }
  }

  return bestCategory;
}

/**
 * Check if a proposed item name is too similar to an existing item.
 * Returns the similar item name if found, null otherwise.
 */
export function findSimilarItemName(
  proposedName: string,
  existingNames: string[]
): string | null {
  const proposed = proposedName.toLowerCase().trim();

  for (const existing of existingNames) {
    const existingLower = existing.toLowerCase().trim();

    // Exact match
    if (proposed === existingLower) return existing;

    // One contains the other (e.g., "Chicken" and "Chicken Breast")
    if (proposed.includes(existingLower) || existingLower.includes(proposed)) {
      const shorter = proposed.length < existingLower.length ? proposed : existingLower;
      if (shorter.length >= 4) return existing;
    }

    // Levenshtein distance for close typos
    if (proposed.length > 3 && existingLower.length > 3) {
      const maxLen = Math.max(proposed.length, existingLower.length);
      const matrix: number[][] = [];
      for (let i = 0; i <= proposed.length; i++) {
        matrix[i] = [i];
        for (let j = 1; j <= existingLower.length; j++) {
          if (i === 0) { matrix[i][j] = j; continue; }
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + (proposed[i - 1] === existingLower[j - 1] ? 0 : 1)
          );
        }
      }
      const dist = matrix[proposed.length][existingLower.length];
      const similarity = 1 - dist / maxLen;
      if (similarity >= 0.85) return existing;
    }
  }

  return null;
}
