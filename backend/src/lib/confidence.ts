/**
 * Confidence engine — pure functions for computing inventory confidence scores.
 *
 * Confidence is computed on-read (not stored/decayed periodically) to avoid write
 * amplification. Each stock tranche stores its initial confidence and timestamps;
 * this module applies time-based decay at query time.
 *
 * Base units: grams (weight), cups (volume). Density bridges them as g/cup.
 */

import type { LocationType } from '../db/schema/inventory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tranche {
  id: string;
  quantity: number;       // current quantity (may have been partially depleted)
  unit: string | null;
  confidence: number;     // initial confidence at creation (0-100)
  addedAt: Date;
  verifiedAt: Date | null;
  expiryDate: Date | null;
  source: string;
}

export interface AreaInfo {
  locationType: LocationType;
  confidenceDecayRate: number | null; // custom override, percent per day
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface ConfidenceThresholds {
  high: number;  // default 80
  medium: number; // default 40
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { high: 80, medium: 40 };

// ---------------------------------------------------------------------------
// Decay rates (percent confidence lost per day)
// ---------------------------------------------------------------------------

const DEFAULT_DECAY_RATES: Record<LocationType, number> = {
  fridge: 3,
  freezer: 0.5,
  pantry: 0.3,
  other: 1,
};

/**
 * Get the daily confidence decay rate for a storage area.
 * Uses custom override if set, otherwise falls back to location type defaults.
 */
export function getDecayRate(area: AreaInfo): number {
  if (area.confidenceDecayRate != null) {
    return Number(area.confidenceDecayRate);
  }
  return DEFAULT_DECAY_RATES[area.locationType] ?? DEFAULT_DECAY_RATES.other;
}

// ---------------------------------------------------------------------------
// Per-tranche confidence (time-decayed)
// ---------------------------------------------------------------------------

/**
 * Calculate the current confidence of a single tranche, applying time-based decay.
 *
 * Decay is applied from the most recent of: creation time, last verification time.
 * If the tranche has an expiry date and we're past it, confidence drops to 0.
 *
 * Confidence approaches expiry faster: when within 2 days of expiry, an additional
 * 10%/day penalty is applied on top of location-based decay.
 */
export function calculateTrancheConfidence(
  tranche: Tranche,
  area: AreaInfo,
  now: Date = new Date(),
): number {
  // Already zero or negative quantity — no confidence
  if (tranche.quantity <= 0) return 0;

  // Past expiry — confidence is 0
  if (tranche.expiryDate && now > tranche.expiryDate) return 0;

  const baseConfidence = tranche.confidence;
  const referenceTime = tranche.verifiedAt ?? tranche.addedAt;
  const daysSinceReference = Math.max(0, (now.getTime() - referenceTime.getTime()) / (1000 * 60 * 60 * 24));

  const dailyDecay = getDecayRate(area);
  let decayed = baseConfidence - (dailyDecay * daysSinceReference);

  // Expiry proximity penalty: extra 10%/day when within 2 days of expiry
  if (tranche.expiryDate) {
    const daysUntilExpiry = (tranche.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntilExpiry <= 2 && daysUntilExpiry > 0) {
      const expiryPenalty = 10 * (2 - daysUntilExpiry);
      decayed -= expiryPenalty;
    }
  }

  return Math.max(0, Math.min(100, decayed));
}

// ---------------------------------------------------------------------------
// Aggregate item confidence (weighted across tranches)
// ---------------------------------------------------------------------------

/**
 * Calculate the overall confidence for an inventory item from its tranches.
 *
 * Returns a quantity-weighted average of all tranche confidences.
 * If there are no tranches (or all have zero quantity), returns 0.
 */
export function calculateItemConfidence(
  tranches: Tranche[],
  area: AreaInfo,
  now: Date = new Date(),
): number {
  if (tranches.length === 0) return 0;

  let totalQuantity = 0;
  let weightedSum = 0;

  for (const tranche of tranches) {
    if (tranche.quantity <= 0) continue;
    const conf = calculateTrancheConfidence(tranche, area, now);
    weightedSum += conf * tranche.quantity;
    totalQuantity += tranche.quantity;
  }

  if (totalQuantity === 0) return 0;
  return Math.round(weightedSum / totalQuantity);
}

// ---------------------------------------------------------------------------
// Confidence band
// ---------------------------------------------------------------------------

/**
 * Map a numeric confidence score (0-100) to a display band.
 */
export function getConfidenceBand(
  score: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceBand {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// FIFO depletion ordering
// ---------------------------------------------------------------------------

/**
 * Sort tranches for FIFO depletion: oldest first, lowest-confidence first within same age.
 * This aligns with how people actually use perishables.
 *
 * Returns a new sorted array (does not mutate input).
 */
export function sortTranchesForDepletion(
  tranches: Tranche[],
  area: AreaInfo,
  now: Date = new Date(),
): Tranche[] {
  return [...tranches]
    .filter(t => t.quantity > 0)
    .sort((a, b) => {
      // Primary: oldest first (by addedAt)
      const ageDiff = a.addedAt.getTime() - b.addedAt.getTime();
      if (ageDiff !== 0) return ageDiff;
      // Secondary: lowest current confidence first
      const confA = calculateTrancheConfidence(a, area, now);
      const confB = calculateTrancheConfidence(b, area, now);
      return confA - confB;
    });
}

/**
 * Plan a depletion across tranches using FIFO ordering.
 *
 * Given a quantity to deplete (in the same unit as the tranches — caller must
 * convert beforehand), returns a list of depletion instructions.
 *
 * Does NOT mutate any tranche — returns instructions for the caller to apply.
 */
export function planDepletion(
  tranches: Tranche[],
  quantityToDeplete: number,
  area: AreaInfo,
  now: Date = new Date(),
): DepletionPlan {
  const sorted = sortTranchesForDepletion(tranches, area, now);
  const instructions: DepletionInstruction[] = [];
  let remaining = quantityToDeplete;

  for (const tranche of sorted) {
    if (remaining <= 0) break;

    const depletable = Math.min(tranche.quantity, remaining);
    instructions.push({
      trancheId: tranche.id,
      currentQuantity: tranche.quantity,
      depleteBy: depletable,
      newQuantity: tranche.quantity - depletable,
    });
    remaining -= depletable;
  }

  return {
    instructions,
    totalDepleted: quantityToDeplete - remaining,
    shortfall: Math.max(0, remaining),
    fullyDepleted: remaining <= 0,
  };
}

export interface DepletionInstruction {
  trancheId: string;
  currentQuantity: number;
  depleteBy: number;
  newQuantity: number;
}

export interface DepletionPlan {
  instructions: DepletionInstruction[];
  /** How much was actually allocated for depletion (may be less than requested if insufficient stock). */
  totalDepleted: number;
  /** How much could not be covered (0 if fully covered). */
  shortfall: number;
  /** True if the full requested quantity could be covered. */
  fullyDepleted: boolean;
}
