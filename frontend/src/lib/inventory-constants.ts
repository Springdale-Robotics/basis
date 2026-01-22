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
  'count',
  'pieces',
  'lbs',
  'oz',
  'kg',
  'g',
  'liters',
  'ml',
  'cups',
  'tbsp',
  'tsp',
  'gallons',
  'quarts',
  'pints',
  'boxes',
  'bags',
  'cans',
  'bottles',
  'jars',
  'packs',
] as const;

export type CategoryOption = (typeof categoryOptions)[number];
export type UnitOption = (typeof unitOptions)[number];

// Unit conversion types and utilities
export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  factor: number;
}

/**
 * Convert a quantity from one unit to another using the item's conversion table.
 * Returns null if no conversion path is found.
 */
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  conversions: UnitConversion[] = []
): number | null {
  // Same unit, no conversion needed
  if (fromUnit === toUnit) {
    return quantity;
  }

  // Try direct conversion
  const direct = conversions.find(
    (c) => c.fromUnit === fromUnit && c.toUnit === toUnit
  );
  if (direct) {
    return quantity * direct.factor;
  }

  // Try reverse conversion
  const reverse = conversions.find(
    (c) => c.fromUnit === toUnit && c.toUnit === fromUnit
  );
  if (reverse) {
    return quantity / reverse.factor;
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
