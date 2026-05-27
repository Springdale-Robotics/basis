// Shared constants for inventory items

import {
  ALL_UNITS,
  WEIGHT_UNITS,
  VOLUME_UNITS,
  COUNT_UNITS,
  NEGLIGIBLE_UNITS,
  resolveUnit,
  convert,
  type UnitDefinition,
  type QuantityUnitSizes,
} from './units';

export const defaultCategories = [
  'Produce',
  'Dairy & Eggs',
  'Meat',
  'Seafood',
  'Deli',
  'Bakery',
  'Frozen',
  'Canned Goods',
  'Pasta & Grains',
  'Breakfast',
  'Baking',
  'Snacks',
  'Beverages',
  'Condiments & Sauces',
  'Spices & Herbs',
  'Cleaning',
  'Paper Goods',
  'Personal Care',
  'Other',
] as const;

/** @deprecated Use defaultCategories instead */
export const categoryOptions = defaultCategories;

export const categoryIcons: Record<string, string> = {
  'Produce': '🥬',
  'Dairy & Eggs': '🥛',
  'Meat': '🥩',
  'Seafood': '🐟',
  'Deli': '🥪',
  'Bakery': '🍞',
  'Frozen': '🧊',
  'Canned Goods': '🥫',
  'Pasta & Grains': '🍝',
  'Breakfast': '🥣',
  'Baking': '🧁',
  'Snacks': '🍿',
  'Beverages': '🥤',
  'Condiments & Sauces': '🫙',
  'Spices & Herbs': '🌶️',
  'Cleaning': '🧹',
  'Paper Goods': '🧻',
  'Personal Care': '🧴',
  'Other': '📦',
  // Legacy categories (still show icons if data exists)
  'Dairy': '🥛',
  'Dry Goods': '🌾',
  'Condiments': '🧂',
  'Spices': '🌶️',
  'Oils': '🫒',
};

export function getItemIcon(item: { icon?: string; category?: string }): string {
  if (item.icon) return item.icon;
  if (item.category && categoryIcons[item.category]) return categoryIcons[item.category];
  return '📦';
}

/**
 * All unit option keys for UI dropdowns.
 * Ordered: weight, volume, count, negligible.
 */
export const unitOptions = ALL_UNITS.map(u => u.key);

/**
 * Get unit options filtered by category for targeted dropdowns.
 */
export function getUnitOptionsByCategory(category: 'weight' | 'volume' | 'count' | 'negligible'): string[] {
  const map = { weight: WEIGHT_UNITS, volume: VOLUME_UNITS, count: COUNT_UNITS, negligible: NEGLIGIBLE_UNITS };
  return (map[category] ?? []).map(u => u.key);
}

/**
 * Get the display name for a unit key.
 */
export function getUnitDisplayName(key: string): string {
  const unit = ALL_UNITS.find(u => u.key === key);
  return unit?.name ?? key;
}

/**
 * Mapping from various unit forms to canonical keys.
 * Built from the unit registry's alias lists.
 */
export const unitAliases: Record<string, string> = (() => {
  const aliases: Record<string, string> = {};
  for (const unit of ALL_UNITS) {
    for (const alias of unit.aliases) {
      aliases[alias.toLowerCase()] = unit.key;
    }
    // Also add the key itself (lowercase)
    aliases[unit.key.toLowerCase()] = unit.key;
  }
  return aliases;
})();

/**
 * Normalize a unit string to its canonical key.
 */
export function normalizeUnit(unit: string | undefined | null): string {
  if (!unit) return '';
  return resolveUnit(unit);
}

export type CategoryOption = (typeof categoryOptions)[number];

/**
 * Convert a quantity from one unit to another using density-based system.
 * Handles same-category, cross-category (weight<->volume via density in g/cup),
 * and custom count units (via quantityUnitSizes — e.g. { bottle: { 16, 'fl oz' } }).
 * Returns null if no conversion path is found.
 */
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  densityGPerCup?: number | null,
  quantityUnitSizes?: QuantityUnitSizes
): number | null {
  return convert(quantity, fromUnit, toUnit, densityGPerCup, quantityUnitSizes);
}

/**
 * Calculate total stock quantity, converting all entries to the target unit.
 * Returns the total and a flag indicating if all entries could be converted.
 */
export function calculateTotalStock(
  entries: Array<{ quantity: number | string; unit?: string }>,
  targetUnit: string,
  densityGPerCup?: number | null,
  quantityUnitSizes?: QuantityUnitSizes
): { total: number; allConverted: boolean; unconvertedUnits: string[] } {
  let total = 0;
  let allConverted = true;
  const unconvertedUnits: string[] = [];

  for (const entry of entries) {
    const qty = typeof entry.quantity === 'string' ? parseFloat(entry.quantity) : entry.quantity;
    const entryUnit = entry.unit || targetUnit;

    if (resolveUnit(entryUnit) === resolveUnit(targetUnit)) {
      total += qty;
    } else {
      const converted = convert(qty, entryUnit, targetUnit, densityGPerCup, quantityUnitSizes);
      if (converted !== null) {
        total += converted;
      } else {
        allConverted = false;
        if (!unconvertedUnits.includes(entryUnit)) {
          unconvertedUnits.push(entryUnit);
        }
      }
    }
  }

  return { total, allConverted, unconvertedUnits };
}
