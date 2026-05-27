/**
 * Inventory confidence service — database-backed operations that use the
 * pure confidence functions from lib/confidence.ts.
 *
 * Handles: querying tranches, computing confidence, FIFO depletion with unit
 * conversion, and reconciliation.
 */

import { db } from '../config/database.js';
import { inventoryStock, inventoryItems, inventoryAreas } from '../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import {
  calculateItemConfidence,
  calculateTrancheConfidence,
  getConfidenceBand,
  planDepletion,
  DEFAULT_THRESHOLDS,
  type Tranche,
  type AreaInfo,
  type ConfidenceBand,
  type ConfidenceThresholds,
  type DepletionPlan,
} from '../lib/confidence.js';
import { convert, resolveUnit } from '../lib/units.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ItemConfidenceResult {
  itemId: string;
  confidence: number;
  band: ConfidenceBand;
  totalQuantity: number;
  unit: string;
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Get the current confidence for a single inventory item.
 * Queries all stock tranches, computes time-decayed confidence.
 */
export async function getItemConfidence(
  itemId: string,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): Promise<ItemConfidenceResult | null> {
  // Get the item's default unit and density
  const item = await db.query.inventoryItems.findFirst({
    where: eq(inventoryItems.id, itemId),
  });
  if (!item) return null;

  // Get all stock entries with their area info
  const stockEntries = await db
    .select({
      stock: inventoryStock,
      area: inventoryAreas,
    })
    .from(inventoryStock)
    .innerJoin(inventoryAreas, eq(inventoryStock.areaId, inventoryAreas.id))
    .where(and(
      eq(inventoryStock.itemId, itemId),
      gt(inventoryStock.quantity, '0'),
    ));

  if (stockEntries.length === 0) {
    return {
      itemId,
      confidence: 0,
      band: 'low',
      totalQuantity: 0,
      unit: item.defaultUnit || 'each',
    };
  }

  // Group by area and compute per-tranche confidence, then aggregate
  const tranches: Tranche[] = stockEntries.map(e => ({
    id: e.stock.id,
    quantity: parseFloat(e.stock.quantity),
    unit: e.stock.unit,
    confidence: e.stock.confidence,
    addedAt: e.stock.addedAt,
    verifiedAt: e.stock.verifiedAt,
    expiryDate: e.stock.expiryDate ? new Date(e.stock.expiryDate) : null,
    source: e.stock.source,
  }));

  // Use the first area for confidence calc (if items span areas, we take a weighted approach)
  // For now, compute per-tranche confidence using each tranche's own area
  const now = new Date();
  let totalQuantity = 0;
  let weightedConfSum = 0;

  for (const entry of stockEntries) {
    const qty = parseFloat(entry.stock.quantity);
    if (qty <= 0) continue;

    const area: AreaInfo = {
      locationType: entry.area.locationType as 'pantry' | 'fridge' | 'freezer' | 'other',
      confidenceDecayRate: entry.area.confidenceDecayRate ? parseFloat(entry.area.confidenceDecayRate) : null,
    };

    const tranche: Tranche = {
      id: entry.stock.id,
      quantity: qty,
      unit: entry.stock.unit,
      confidence: entry.stock.confidence,
      addedAt: entry.stock.addedAt,
      verifiedAt: entry.stock.verifiedAt,
      expiryDate: entry.stock.expiryDate ? new Date(entry.stock.expiryDate) : null,
      source: entry.stock.source,
    };

    const conf = calculateTrancheConfidence(tranche, area, now);
    weightedConfSum += conf * qty;
    totalQuantity += qty;
  }

  const confidence = totalQuantity > 0 ? Math.round(weightedConfSum / totalQuantity) : 0;

  return {
    itemId,
    confidence,
    band: getConfidenceBand(confidence, thresholds),
    totalQuantity,
    unit: item.defaultUnit || 'each',
  };
}

/**
 * Bulk: get confidence for all items in a household.
 * Returns a Map keyed by item ID.
 */
export async function getInventoryConfidenceMap(
  householdId: string,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): Promise<Map<string, ItemConfidenceResult>> {
  const results = new Map<string, ItemConfidenceResult>();

  // Get all items for this household
  const items = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  // Get all stock entries with area info
  const allStock = await db
    .select({
      stock: inventoryStock,
      area: inventoryAreas,
    })
    .from(inventoryStock)
    .innerJoin(inventoryAreas, eq(inventoryStock.areaId, inventoryAreas.id))
    .innerJoin(inventoryItems, eq(inventoryStock.itemId, inventoryItems.id))
    .where(and(
      eq(inventoryItems.householdId, householdId),
      gt(inventoryStock.quantity, '0'),
    ));

  // Group stock by item ID
  const stockByItem = new Map<string, typeof allStock>();
  for (const entry of allStock) {
    const itemId = entry.stock.itemId;
    if (!stockByItem.has(itemId)) stockByItem.set(itemId, []);
    stockByItem.get(itemId)!.push(entry);
  }

  const now = new Date();

  for (const item of items) {
    const entries = stockByItem.get(item.id) || [];

    if (entries.length === 0) {
      results.set(item.id, {
        itemId: item.id,
        confidence: 0,
        band: 'low',
        totalQuantity: 0,
        unit: item.defaultUnit || 'each',
      });
      continue;
    }

    let totalQuantity = 0;
    let weightedConfSum = 0;

    for (const entry of entries) {
      const qty = parseFloat(entry.stock.quantity);
      if (qty <= 0) continue;

      const area: AreaInfo = {
        locationType: entry.area.locationType as 'pantry' | 'fridge' | 'freezer' | 'other',
        confidenceDecayRate: entry.area.confidenceDecayRate ? parseFloat(entry.area.confidenceDecayRate) : null,
      };

      const tranche: Tranche = {
        id: entry.stock.id,
        quantity: qty,
        unit: entry.stock.unit,
        confidence: entry.stock.confidence,
        addedAt: entry.stock.addedAt,
        verifiedAt: entry.stock.verifiedAt,
        expiryDate: entry.stock.expiryDate ? new Date(entry.stock.expiryDate) : null,
        source: entry.stock.source,
      };

      const conf = calculateTrancheConfidence(tranche, area, now);
      weightedConfSum += conf * qty;
      totalQuantity += qty;
    }

    const confidence = totalQuantity > 0 ? Math.round(weightedConfSum / totalQuantity) : 0;
    results.set(item.id, {
      itemId: item.id,
      confidence,
      band: getConfidenceBand(confidence, thresholds),
      totalQuantity,
      unit: item.defaultUnit || 'each',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Deplete inventory tranches for an item using FIFO ordering.
 *
 * Converts the requested quantity to the tranche's unit before depleting.
 * Returns the depletion plan that was applied.
 */
export async function depleteTranches(
  itemId: string,
  quantity: number,
  unit: string,
): Promise<DepletionPlan> {
  // Get item for density and quantity weights
  const item = await db.query.inventoryItems.findFirst({
    where: eq(inventoryItems.id, itemId),
  });
  if (!item) throw new Error(`Item ${itemId} not found`);

  // Get stock entries with area info
  const stockEntries = await db
    .select({
      stock: inventoryStock,
      area: inventoryAreas,
    })
    .from(inventoryStock)
    .innerJoin(inventoryAreas, eq(inventoryStock.areaId, inventoryAreas.id))
    .where(and(
      eq(inventoryStock.itemId, itemId),
      gt(inventoryStock.quantity, '0'),
    ));

  if (stockEntries.length === 0) {
    return { instructions: [], totalDepleted: 0, shortfall: quantity, fullyDepleted: false };
  }

  // Convert quantity to a common unit for depletion planning.
  // We use the first tranche's unit as the target, converting incoming quantity to match.
  // If tranches have mixed units, we convert each to the target for planning.
  const targetUnit = resolveUnit(unit);
  const densityGPerCup = item.density ? parseFloat(item.density) : null;
  const qtySizes = (item.quantityUnitSizes as Record<string, { quantity: number; unit: string }>) || {};

  // Build tranches with converted quantities
  const now = new Date();
  const tranches: (Tranche & { originalUnit: string | null })[] = [];

  for (const entry of stockEntries) {
    const stockQty = parseFloat(entry.stock.quantity);
    const stockUnit = resolveUnit(entry.stock.unit || targetUnit);

    let convertedQty: number;
    if (stockUnit === targetUnit) {
      convertedQty = stockQty;
    } else {
      const converted = convert(stockQty, stockUnit, targetUnit, densityGPerCup, qtySizes);
      if (converted == null) continue; // Can't convert — skip this tranche
      convertedQty = converted;
    }

    tranches.push({
      id: entry.stock.id,
      quantity: convertedQty,
      unit: targetUnit,
      confidence: entry.stock.confidence,
      addedAt: entry.stock.addedAt,
      verifiedAt: entry.stock.verifiedAt,
      expiryDate: entry.stock.expiryDate ? new Date(entry.stock.expiryDate) : null,
      source: entry.stock.source,
      originalUnit: entry.stock.unit,
    });
  }

  // Use the first area for FIFO sort (all tranches sorted together regardless of area)
  const areaInfo: AreaInfo = {
    locationType: (stockEntries[0].area.locationType as 'pantry' | 'fridge' | 'freezer' | 'other'),
    confidenceDecayRate: stockEntries[0].area.confidenceDecayRate
      ? parseFloat(stockEntries[0].area.confidenceDecayRate)
      : null,
  };

  const plan = planDepletion(tranches, quantity, areaInfo, now);

  // Apply the plan to the database
  for (const instruction of plan.instructions) {
    // Convert the depleteBy amount back to the tranche's original unit
    const trancheInfo = tranches.find(t => t.id === instruction.trancheId);
    const originalEntry = stockEntries.find(e => e.stock.id === instruction.trancheId);
    if (!originalEntry) continue;

    const originalUnit = resolveUnit(originalEntry.stock.unit || targetUnit);
    let newQtyInOriginalUnit: number;

    if (originalUnit === targetUnit) {
      newQtyInOriginalUnit = instruction.newQuantity;
    } else {
      const converted = convert(instruction.newQuantity, targetUnit, originalUnit, densityGPerCup, qtySizes);
      newQtyInOriginalUnit = converted ?? instruction.newQuantity;
    }

    if (newQtyInOriginalUnit <= 0) {
      // Remove the tranche entirely
      await db.delete(inventoryStock).where(eq(inventoryStock.id, instruction.trancheId));
    } else {
      await db.update(inventoryStock)
        .set({
          quantity: newQtyInOriginalUnit.toFixed(3),
          updatedAt: now,
        })
        .where(eq(inventoryStock.id, instruction.trancheId));
    }
  }

  return plan;
}

/**
 * Reconcile an inventory item — "I checked, I actually have X amount."
 *
 * Removes all existing tranches for this item and creates a single new
 * tranche at confidence 100 with the verified quantity.
 */
export async function reconcileItem(
  itemId: string,
  actualQuantity: number,
  unit: string,
  areaId: string,
  userId: string,
): Promise<void> {
  const now = new Date();

  // Delete all existing stock for this item
  await db.delete(inventoryStock).where(eq(inventoryStock.itemId, itemId));

  // Create a single fresh tranche if quantity > 0
  if (actualQuantity > 0) {
    await db.insert(inventoryStock).values({
      itemId,
      areaId,
      quantity: actualQuantity.toFixed(3),
      unit: resolveUnit(unit),
      confidence: 100,
      source: 'manual',
      verifiedAt: now,
      originalQuantity: actualQuantity.toFixed(3),
      addedAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Mark an item as out-of-stock — "I thought I had this but I don't."
 *
 * Sets all tranches to 0 quantity. The confidence is 100 because we're
 * certain we don't have it.
 */
export async function markOutOfStock(itemId: string): Promise<void> {
  await db.delete(inventoryStock).where(eq(inventoryStock.itemId, itemId));
}
