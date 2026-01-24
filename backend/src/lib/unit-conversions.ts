// Global unit conversions - standard mathematical conversions that apply universally
// These are used as fallbacks when no item-specific conversion exists

// Standard mathematical conversions (same-category only)
// Values represent: 1 [fromUnit] = X [toUnit]
export const GLOBAL_UNIT_CONVERSIONS: Record<string, Record<string, number>> = {
  // Volume - US
  'cups': { 'ml': 236.588, 'tbsp': 16, 'tsp': 48, 'fl oz': 8, 'liters': 0.236588, 'pints': 0.5, 'quarts': 0.25, 'gallons': 0.0625 },
  'cup': { 'ml': 236.588, 'tbsp': 16, 'tsp': 48, 'fl oz': 8, 'liters': 0.236588, 'pints': 0.5, 'quarts': 0.25, 'gallons': 0.0625 },
  'tbsp': { 'ml': 14.787, 'tsp': 3, 'cups': 0.0625, 'cup': 0.0625, 'fl oz': 0.5 },
  'tsp': { 'ml': 4.929, 'tbsp': 0.333333, 'cups': 0.0208333, 'cup': 0.0208333 },
  'fl oz': { 'ml': 29.5735, 'tbsp': 2, 'cups': 0.125, 'cup': 0.125, 'liters': 0.0295735 },

  // Volume - Metric
  'liters': { 'ml': 1000, 'cups': 4.22675, 'cup': 4.22675, 'quarts': 1.05669, 'gallons': 0.264172, 'fl oz': 33.814, 'pints': 2.11338 },
  'l': { 'ml': 1000, 'cups': 4.22675, 'cup': 4.22675, 'quarts': 1.05669, 'gallons': 0.264172, 'fl oz': 33.814, 'pints': 2.11338 },
  'ml': { 'liters': 0.001, 'l': 0.001, 'tsp': 0.202884, 'tbsp': 0.067628, 'cups': 0.00422675, 'cup': 0.00422675, 'fl oz': 0.033814 },

  // Volume - US Large
  'pints': { 'cups': 2, 'cup': 2, 'fl oz': 16, 'ml': 473.176, 'liters': 0.473176, 'l': 0.473176, 'quarts': 0.5, 'gallons': 0.125, 'tbsp': 32, 'tsp': 96 },
  'quarts': { 'cups': 4, 'cup': 4, 'pints': 2, 'fl oz': 32, 'ml': 946.353, 'liters': 0.946353, 'l': 0.946353, 'gallons': 0.25, 'tbsp': 64, 'tsp': 192 },
  'gallons': { 'cups': 16, 'cup': 16, 'quarts': 4, 'pints': 8, 'fl oz': 128, 'ml': 3785.41, 'liters': 3.78541, 'l': 3.78541, 'tbsp': 256, 'tsp': 768 },

  // Weight - Imperial
  'lbs': { 'oz': 16, 'g': 453.592, 'kg': 0.453592, 'mg': 453592 },
  'lb': { 'oz': 16, 'g': 453.592, 'kg': 0.453592, 'mg': 453592 },
  'oz': { 'g': 28.3495, 'lbs': 0.0625, 'lb': 0.0625, 'kg': 0.0283495, 'mg': 28349.5 },

  // Weight - Metric
  'kg': { 'g': 1000, 'lbs': 2.20462, 'lb': 2.20462, 'oz': 35.274, 'mg': 1000000 },
  'g': { 'kg': 0.001, 'oz': 0.035274, 'lbs': 0.00220462, 'lb': 0.00220462, 'mg': 1000 },
  'mg': { 'g': 0.001, 'kg': 0.000001, 'oz': 0.000035274, 'lbs': 0.0000022046, 'lb': 0.0000022046 },
};

// Unit aliases for normalization
const UNIT_ALIASES: Record<string, string> = {
  'tablespoon': 'tbsp',
  'tablespoons': 'tbsp',
  'tbs': 'tbsp',
  't': 'tbsp',
  'teaspoon': 'tsp',
  'teaspoons': 'tsp',
  'cups': 'cup',
  'c': 'cup',
  'ounce': 'oz',
  'ounces': 'oz',
  'pound': 'lb',
  'pounds': 'lb',
  'lbs': 'lb',
  'gram': 'g',
  'grams': 'g',
  'gm': 'g',
  'kilogram': 'kg',
  'kilograms': 'kg',
  'kilo': 'kg',
  'milliliter': 'ml',
  'milliliters': 'ml',
  'liter': 'l',
  'liters': 'l',
  'litre': 'l',
  'litres': 'l',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
};

/**
 * Normalize a unit string to its canonical form
 */
export function normalizeUnit(unit: string): string {
  const normalized = unit.toLowerCase().trim();
  return UNIT_ALIASES[normalized] || normalized;
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
 * Find a conversion factor via an intermediate unit (1-step chain).
 * Returns the combined factor or null if no chain exists.
 */
export function findConversionChain(fromUnit: string, toUnit: string): number | null {
  const normFrom = normalizeUnit(fromUnit);
  const normTo = normalizeUnit(toUnit);

  if (normFrom === normTo) return 1;

  // First check if direct conversion exists
  const directFactor = getGlobalConversionFactor(normFrom, normTo);
  if (directFactor !== null) return directFactor;

  // Try to find a chain through an intermediate unit
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
 * Check if a global conversion exists between two units
 */
export function hasGlobalConversion(fromUnit: string, toUnit: string): boolean {
  return findConversionChain(fromUnit, toUnit) !== null;
}
