// Global unit conversions - standard mathematical conversions that apply universally
// These are used as fallbacks when no item-specific conversion exists

import { normalizeUnit } from './inventory-constants';

// Standard mathematical conversions (same-category only)
// Values represent: 1 [fromUnit] = X [toUnit]
export const GLOBAL_UNIT_CONVERSIONS: Record<string, Record<string, number>> = {
  // Volume - US
  'cups': { 'ml': 236.588, 'tbsp': 16, 'tsp': 48, 'fl oz': 8, 'liters': 0.236588, 'pints': 0.5, 'quarts': 0.25, 'gallons': 0.0625 },
  'tbsp': { 'ml': 14.787, 'tsp': 3, 'cups': 0.0625, 'fl oz': 0.5 },
  'tsp': { 'ml': 4.929, 'tbsp': 0.333333, 'cups': 0.0208333 },
  'fl oz': { 'ml': 29.5735, 'tbsp': 2, 'cups': 0.125, 'liters': 0.0295735 },

  // Volume - Metric
  'liters': { 'ml': 1000, 'cups': 4.22675, 'quarts': 1.05669, 'gallons': 0.264172, 'fl oz': 33.814, 'pints': 2.11338 },
  'ml': { 'liters': 0.001, 'tsp': 0.202884, 'tbsp': 0.067628, 'cups': 0.00422675, 'fl oz': 0.033814 },

  // Volume - US Large
  'pints': { 'cups': 2, 'fl oz': 16, 'ml': 473.176, 'liters': 0.473176, 'quarts': 0.5, 'gallons': 0.125, 'tbsp': 32, 'tsp': 96 },
  'quarts': { 'cups': 4, 'pints': 2, 'fl oz': 32, 'ml': 946.353, 'liters': 0.946353, 'gallons': 0.25, 'tbsp': 64, 'tsp': 192 },
  'gallons': { 'cups': 16, 'quarts': 4, 'pints': 8, 'fl oz': 128, 'ml': 3785.41, 'liters': 3.78541, 'tbsp': 256, 'tsp': 768 },

  // Weight - Imperial
  'lbs': { 'oz': 16, 'g': 453.592, 'kg': 0.453592, 'mg': 453592 },
  'oz': { 'g': 28.3495, 'lbs': 0.0625, 'kg': 0.0283495, 'mg': 28349.5 },

  // Weight - Metric
  'kg': { 'g': 1000, 'lbs': 2.20462, 'oz': 35.274, 'mg': 1000000 },
  'g': { 'kg': 0.001, 'oz': 0.035274, 'lbs': 0.00220462, 'mg': 1000 },
  'mg': { 'g': 0.001, 'kg': 0.000001, 'oz': 0.000035274, 'lbs': 0.0000022046 },
};

// Unit categories - conversions only work within the same category
export const UNIT_CATEGORIES: Record<string, 'weight' | 'volume' | 'count' | 'other'> = {
  // Weight
  'lbs': 'weight',
  'oz': 'weight',
  'kg': 'weight',
  'g': 'weight',
  'mg': 'weight',

  // Volume
  'cups': 'volume',
  'tbsp': 'volume',
  'tsp': 'volume',
  'fl oz': 'volume',
  'ml': 'volume',
  'liters': 'volume',
  'pints': 'volume',
  'quarts': 'volume',
  'gallons': 'volume',

  // Count
  'count': 'count',
  'pieces': 'count',
  'each': 'count',
};

/**
 * Get the category of a unit (weight, volume, count, or other)
 */
export function getUnitCategory(unit: string): 'weight' | 'volume' | 'count' | 'other' {
  const normalized = normalizeUnit(unit);
  return UNIT_CATEGORIES[normalized] || 'other';
}

/**
 * Check if two units are in the same category (can potentially be converted)
 */
export function areSameCategory(fromUnit: string, toUnit: string): boolean {
  const fromCategory = getUnitCategory(fromUnit);
  const toCategory = getUnitCategory(toUnit);

  // 'other' category units can't be auto-converted
  if (fromCategory === 'other' || toCategory === 'other') return false;

  return fromCategory === toCategory;
}

/**
 * Get a direct global conversion factor between two units.
 * Returns null if no direct conversion exists.
 */
export function getGlobalConversionFactor(fromUnit: string, toUnit: string): number | null {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) return 1;

  // Check direct conversion
  if (GLOBAL_UNIT_CONVERSIONS[normFrom]?.[normTo] !== undefined) {
    return GLOBAL_UNIT_CONVERSIONS[normFrom][normTo];
  }

  // Check reverse conversion
  if (GLOBAL_UNIT_CONVERSIONS[normTo]?.[normFrom] !== undefined) {
    return 1 / GLOBAL_UNIT_CONVERSIONS[normTo][normFrom];
  }

  return null;
}

/**
 * Check if a global conversion exists between two units (direct or via chain)
 */
export function hasGlobalConversion(fromUnit: string, toUnit: string): boolean {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) return true;

  // Check direct conversion
  if (getGlobalConversionFactor(normFrom, normTo) !== null) return true;

  // Check for chain conversion
  return findConversionChain(normFrom, normTo) !== null;
}

/**
 * Find a conversion factor via an intermediate unit (1-step chain).
 * Example: cups → ml → liters
 * Returns the combined factor or null if no chain exists.
 */
export function findConversionChain(fromUnit: string, toUnit: string): number | null {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) return 1;

  // First check if direct conversion exists
  const directFactor = getGlobalConversionFactor(normFrom, normTo);
  if (directFactor !== null) return directFactor;

  // Only look for chains within the same category
  if (!areSameCategory(normFrom, normTo)) return null;

  // Try to find a chain through an intermediate unit
  // Get all units we can convert FROM normFrom
  const fromConversions = GLOBAL_UNIT_CONVERSIONS[normFrom] || {};

  for (const intermediateUnit of Object.keys(fromConversions)) {
    const factor1 = fromConversions[intermediateUnit];
    const factor2 = getGlobalConversionFactor(intermediateUnit, normTo);

    if (factor2 !== null) {
      return factor1 * factor2;
    }
  }

  // Also try reverse from normFrom
  for (const [unit, conversions] of Object.entries(GLOBAL_UNIT_CONVERSIONS)) {
    if (conversions[normFrom] !== undefined) {
      const factor1 = 1 / conversions[normFrom];
      const factor2 = getGlobalConversionFactor(unit, normTo);

      if (factor2 !== null) {
        return factor1 * factor2;
      }
    }
  }

  return null;
}

/**
 * Convert a quantity using global conversions.
 * Returns null if no conversion path exists.
 */
export function convertWithGlobal(
  quantity: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const factor = findConversionChain(fromUnit, toUnit);
  if (factor === null) return null;
  return quantity * factor;
}
