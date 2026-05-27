// Unit conversion system — delegates to the canonical unit registry in units.ts.
//
// This file preserves the existing API surface (convertWithDensity, normalizeUnit, etc.)
// so existing callsites don't need to change. New code should import from units.ts directly.

import {
  convert,
  resolveUnit,
  getUnitCategory as getUnitCategoryFromRegistry,
  isCountUnit,
  isNegligible,
  toBaseUnit,
  fromBaseUnit,
  convertSameCategory,
  type QuantityUnitSizes,
} from './units.js';

// Re-export the canonical functions under their existing names

/**
 * Normalize a unit string to its canonical key.
 * @deprecated Use `resolveUnit` from units.ts directly.
 */
export function normalizeUnit(unit: string): string {
  return resolveUnit(unit);
}

/**
 * Get the category of a unit.
 */
export function getUnitCategory(unit: string): 'weight' | 'volume' | 'quantity' | 'other' {
  const cat = getUnitCategoryFromRegistry(unit);
  // Map the new category names to the old API surface
  if (cat === 'count' || cat === 'unknown') return 'quantity';
  if (cat === 'negligible') return 'other';
  return cat;
}

/**
 * Get a conversion factor between two same-category units.
 * Returns null if no direct conversion exists.
 */
export function getGlobalConversionFactor(fromUnit: string, toUnit: string): number | null {
  const result = convertSameCategory(1, fromUnit, toUnit);
  return result;
}

/**
 * Find a conversion factor via base unit (replaces the old chain-finding logic).
 * Returns null if units are in different categories.
 */
export function findConversionChain(fromUnit: string, toUnit: string): number | null {
  return convertSameCategory(1, fromUnit, toUnit);
}

/**
 * Check if a global conversion exists between two units.
 */
export function hasGlobalConversion(fromUnit: string, toUnit: string): boolean {
  return convertSameCategory(1, fromUnit, toUnit) !== null;
}

/**
 * Convert a quantity between any units using density and per-item quantity sizes.
 *
 * Handles:
 * - Same category (weight<->weight, volume<->volume): direct conversion
 * - Cross category (weight<->volume): uses density in g/cup
 * - Custom count units: resolved through `quantityUnitSizes` (e.g.
 *   { bottle: { quantity: 16, unit: 'fl oz' } }) before applying the normal
 *   conversion; density is then only needed when the resolved unit still
 *   crosses weight↔volume.
 *
 * @param quantity            Amount to convert
 * @param fromUnit            Source unit
 * @param toUnit              Target unit
 * @param densityGPerCup      Item density in g/cup (nullable). NOTE: the old API used g/mL — callers
 *                            storing g/mL need to multiply by 236.588 first, or update to g/cup.
 * @param quantityUnitSizes   Map of unit key -> { quantity, unit } in any standard unit
 */
export function convertWithDensity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  densityGPerCup: number | null | undefined,
  quantityUnitSizes?: QuantityUnitSizes
): number | null {
  return convert(quantity, fromUnit, toUnit, densityGPerCup, quantityUnitSizes);
}

// Re-export core functions for direct use
export { resolveUnit, toBaseUnit, fromBaseUnit, convert, isCountUnit, isNegligible };
export type { QuantityUnitSizes };
