// Shared constants for inventory items

export const categoryOptions = [
  'Produce',
  'Dairy',
  'Meat',
  'Seafood',
  'Bakery',
  'Frozen',
  'Canned Goods',
  'Dry Goods',
  'Beverages',
  'Snacks',
  'Condiments',
  'Spices',
  'Cleaning',
  'Personal Care',
  'Other',
] as const;

export const unitOptions = [
  // Count/quantity
  'count',
  'pieces',
  'each',
  // Weight
  'lbs',
  'oz',
  'kg',
  'g',
  'mg',
  // Volume - large
  'gallons',
  'liters',
  'quarts',
  'pints',
  // Volume - medium
  'cups',
  'fl oz',
  // Volume - small
  'tbsp',
  'tsp',
  'ml',
  // Packaging
  'boxes',
  'bags',
  'cans',
  'bottles',
  'jars',
  'packs',
  'packages',
  // Cooking-specific
  'cloves',
  'heads',
  'bunches',
  'stalks',
  'sprigs',
  'slices',
  'sticks',
  'pinches',
  'dashes',
  'drops',
  // Size descriptors (for produce)
  'large',
  'medium',
  'small',
] as const;

// Mapping from various unit forms to canonical forms
export const unitAliases: Record<string, string> = {
  // Tablespoon variations
  'tablespoon': 'tbsp',
  'tablespoons': 'tbsp',
  'tbs': 'tbsp',
  't': 'tbsp',
  // Teaspoon variations
  'teaspoon': 'tsp',
  'teaspoons': 'tsp',
  // Cup variations
  'cup': 'cups',
  'c': 'cups',
  // Ounce variations
  'ounce': 'oz',
  'ounces': 'oz',
  // Pound variations
  'pound': 'lbs',
  'pounds': 'lbs',
  'lb': 'lbs',
  // Gram variations
  'gram': 'g',
  'grams': 'g',
  'gm': 'g',
  // Kilogram variations
  'kilogram': 'kg',
  'kilograms': 'kg',
  // Milliliter variations
  'milliliter': 'ml',
  'milliliters': 'ml',
  // Liter variations
  'liter': 'liters',
  'litre': 'liters',
  'litres': 'liters',
  'l': 'liters',
  // Piece variations
  'piece': 'pieces',
  'pcs': 'pieces',
  'pc': 'pieces',
  // Other
  'clove': 'cloves',
  'head': 'heads',
  'bunch': 'bunches',
  'stalk': 'stalks',
  'sprig': 'sprigs',
  'slice': 'slices',
  'stick': 'sticks',
  'pinch': 'pinches',
  'dash': 'dashes',
  'drop': 'drops',
  'package': 'packages',
  'pkg': 'packages',
  'can': 'cans',
  'tin': 'cans',
  'tins': 'cans',
  'bottle': 'bottles',
  'jar': 'jars',
  'box': 'boxes',
  'bag': 'bags',
  'pack': 'packs',
  'gallon': 'gallons',
  'quart': 'quarts',
  'pint': 'pints',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
};

/**
 * Normalize a unit string to its canonical form.
 * Returns the canonical unit if an alias exists, otherwise returns the lowercase trimmed input.
 */
export function normalizeUnit(unit: string | undefined | null): string {
  if (!unit) return '';
  const lower = unit.toLowerCase().trim();
  return unitAliases[lower] || lower;
}

export type CategoryOption = (typeof categoryOptions)[number];
export type UnitOption = (typeof unitOptions)[number];

// Unit conversion types and utilities
export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  factor: number;
}

// Import global conversions for fallback
import { findConversionChain } from './unit-conversions';

/**
 * Convert a quantity from one unit to another.
 * Priority:
 *   1. Item-specific conversions (takes precedence)
 *   2. Global standard conversions (fallback for weight/volume)
 * Returns null if no conversion path is found.
 */
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  conversions: UnitConversion[] = []
): number | null {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  // Same unit, no conversion needed
  if (normFrom === normTo) {
    return quantity;
  }

  // 1. Try item-specific direct conversion
  const direct = conversions.find(
    (c) => normalizeUnit(c.fromUnit) === normFrom && normalizeUnit(c.toUnit) === normTo
  );
  if (direct) {
    return quantity * direct.factor;
  }

  // 2. Try item-specific reverse conversion
  const reverse = conversions.find(
    (c) => normalizeUnit(c.fromUnit) === normTo && normalizeUnit(c.toUnit) === normFrom
  );
  if (reverse) {
    return quantity / reverse.factor;
  }

  // 3. Try global standard conversions (for weight/volume)
  const globalFactor = findConversionChain(normFrom, normTo);
  if (globalFactor !== null) {
    return quantity * globalFactor;
  }

  // No conversion found
  return null;
}

/**
 * Calculate total stock quantity, converting all entries to the target unit.
 * Returns the total and a flag indicating if all entries could be converted.
 */
export function calculateTotalStock(
  entries: Array<{ quantity: number | string; unit?: string }>,
  targetUnit: string,
  conversions: UnitConversion[] = []
): { total: number; allConverted: boolean; unconvertedUnits: string[] } {
  let total = 0;
  let allConverted = true;
  const unconvertedUnits: string[] = [];

  for (const entry of entries) {
    const qty = typeof entry.quantity === 'string' ? parseFloat(entry.quantity) : entry.quantity;
    const entryUnit = entry.unit || targetUnit;

    if (entryUnit === targetUnit) {
      total += qty;
    } else {
      const converted = convertQuantity(qty, entryUnit, targetUnit, conversions);
      if (converted !== null) {
        total += converted;
      } else {
        // Can't convert - track this unit but don't add to total
        allConverted = false;
        if (!unconvertedUnits.includes(entryUnit)) {
          unconvertedUnits.push(entryUnit);
        }
      }
    }
  }

  return { total, allConverted, unconvertedUnits };
}
