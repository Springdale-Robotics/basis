// Unit conversion system — delegates to the canonical unit registry in units.ts.
//
// This file preserves the existing API surface so existing callsites don't need to change.
// New code should import from units.ts directly.

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
} from './units';

/**
 * Normalize a unit string to its canonical key.
 * @deprecated Use `resolveUnit` from units.ts directly.
 */
export function normalizeUnit(unit: string): string {
  return resolveUnit(unit);
}

/**
 * Get the category of a unit (weight, volume, count, or other).
 */
export function getUnitCategory(unit: string): 'weight' | 'volume' | 'count' | 'other' {
  const cat = getUnitCategoryFromRegistry(unit);
  if (cat === 'count' || cat === 'unknown') return 'count';
  if (cat === 'negligible') return 'other';
  return cat;
}

/**
 * Alias for getUnitCategory — used by IngredientMatchRow.
 * @deprecated Use getUnitCategory directly.
 */
export function getUnitCategoryForDensity(unit: string): 'weight' | 'volume' | 'quantity' | 'other' {
  const cat = getUnitCategoryFromRegistry(unit);
  if (cat === 'count' || cat === 'unknown') return 'quantity';
  if (cat === 'negligible') return 'other';
  return cat;
}

/**
 * Check if two units are in the same category (can potentially be converted).
 */
export function areSameCategory(fromUnit: string, toUnit: string): boolean {
  const fromCat = getUnitCategory(fromUnit);
  const toCat = getUnitCategory(toUnit);
  if (fromCat === 'other' || toCat === 'other') return false;
  return fromCat === toCat;
}

/**
 * Get a conversion factor between two same-category units.
 * Returns null if no conversion exists.
 */
export function getGlobalConversionFactor(fromUnit: string, toUnit: string): number | null {
  return convertSameCategory(1, fromUnit, toUnit);
}

/**
 * Find a conversion factor via base unit.
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
 * Convert a quantity using same-category global conversions.
 * Returns null if no conversion path exists.
 */
export function convertWithGlobal(
  quantity: number,
  fromUnit: string,
  toUnit: string
): number | null {
  return convertSameCategory(quantity, fromUnit, toUnit);
}

/**
 * Convert between any units using density and per-item quantity sizes.
 *
 * @param quantity            Amount to convert
 * @param fromUnit            Source unit
 * @param toUnit              Target unit
 * @param densityGPerCup      Item density in g/cup (nullable)
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

export type { QuantityUnitSizes };

// Re-export core functions for direct use
export { resolveUnit, toBaseUnit, fromBaseUnit, convert, isCountUnit, isNegligible };

// Re-export the old GLOBAL_UNIT_CONVERSIONS and UNIT_CATEGORIES for any remaining direct consumers.
// These are empty — all conversion logic now lives in units.ts.
// @deprecated — use convert() or convertSameCategory() instead.
export const GLOBAL_UNIT_CONVERSIONS: Record<string, Record<string, number>> = {};
export const UNIT_CATEGORIES: Record<string, 'weight' | 'volume' | 'count' | 'other'> = {};
