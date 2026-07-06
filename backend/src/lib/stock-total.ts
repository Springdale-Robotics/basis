/**
 * The single "how much of this item do we have" computation.
 *
 * Stock lives in tranches (inventory_stock) that may be recorded in different
 * units, so each tranche is converted to the target unit using the item's
 * density (weight↔volume) and quantityUnitSizes (custom count units). Before
 * this existed, five divergent implementations disagreed about totals — the
 * confidence service even summed mixed units raw (500 g + 1 kg = "501 g"),
 * which drove wrong shopping-list deltas and low-stock alerts.
 *
 * Callers choose their policy for unconvertible tranches:
 * - `convertedTotal` counts only tranches that bridged to the target unit.
 * - `unconvertedRaw` is the face-value sum of the ones that didn't. Adding it
 *   (best-effort total) avoids under-counting — e.g. the low-stock worker uses
 *   `convertedTotal + unconvertedRaw` so a unit hiccup can't raise a false
 *   "running low" alert.
 */
import { convertWithDensity, normalizeUnit, type QuantityUnitSizes } from './unit-conversions.js';

export interface StockEntryLike {
  quantity: string | number;
  unit: string | null;
}

export interface StockTotal {
  /** Sum of tranches convertible to the target unit, in the target unit. */
  convertedTotal: number;
  /** Face-value sum of tranches whose unit couldn't be bridged. */
  unconvertedRaw: number;
  allConverted: boolean;
  unconvertedUnits: string[];
}

export function sumStock(
  entries: StockEntryLike[],
  targetUnit: string | null,
  density: number | null,
  quantityUnitSizes: QuantityUnitSizes | null,
): StockTotal {
  let convertedTotal = 0;
  let unconvertedRaw = 0;
  const unconvertedUnits: string[] = [];

  for (const entry of entries) {
    const qty = typeof entry.quantity === 'number' ? entry.quantity : parseFloat(entry.quantity);
    if (Number.isNaN(qty)) continue;

    const entryUnit = entry.unit || targetUnit;
    if (!entryUnit || !targetUnit || normalizeUnit(entryUnit) === normalizeUnit(targetUnit)) {
      convertedTotal += qty;
      continue;
    }

    const converted = convertWithDensity(qty, entryUnit, targetUnit, density, quantityUnitSizes ?? {});
    if (converted !== null) {
      convertedTotal += converted;
    } else {
      unconvertedRaw += qty;
      if (!unconvertedUnits.includes(entryUnit)) {
        unconvertedUnits.push(entryUnit);
      }
    }
  }

  return {
    convertedTotal,
    unconvertedRaw,
    allConverted: unconvertedUnits.length === 0,
    unconvertedUnits,
  };
}
