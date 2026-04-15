import { describe, it, expect } from 'vitest';
import {
  calculateTrancheConfidence,
  calculateItemConfidence,
  getConfidenceBand,
  getDecayRate,
  sortTranchesForDepletion,
  planDepletion,
  DEFAULT_THRESHOLDS,
  type Tranche,
  type AreaInfo,
} from './confidence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTranche(overrides: Partial<Tranche> = {}): Tranche {
  return {
    id: overrides.id ?? 'tranche-1',
    quantity: overrides.quantity ?? 100,
    unit: overrides.unit ?? 'g',
    confidence: overrides.confidence ?? 100,
    addedAt: overrides.addedAt ?? new Date('2026-04-01'),
    verifiedAt: overrides.verifiedAt ?? null,
    expiryDate: overrides.expiryDate ?? null,
    source: overrides.source ?? 'purchase',
  };
}

const fridgeArea: AreaInfo = { locationType: 'fridge', confidenceDecayRate: null };
const freezerArea: AreaInfo = { locationType: 'freezer', confidenceDecayRate: null };
const pantryArea: AreaInfo = { locationType: 'pantry', confidenceDecayRate: null };
const otherArea: AreaInfo = { locationType: 'other', confidenceDecayRate: null };
const customDecayArea: AreaInfo = { locationType: 'other', confidenceDecayRate: 5 };

// ---------------------------------------------------------------------------
// getDecayRate
// ---------------------------------------------------------------------------

describe('getDecayRate', () => {
  it('returns default rates for each location type', () => {
    expect(getDecayRate(fridgeArea)).toBe(3);
    expect(getDecayRate(freezerArea)).toBe(0.5);
    expect(getDecayRate(pantryArea)).toBe(0.3);
    expect(getDecayRate(otherArea)).toBe(1);
  });

  it('uses custom override when set', () => {
    expect(getDecayRate(customDecayArea)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// calculateTrancheConfidence
// ---------------------------------------------------------------------------

describe('calculateTrancheConfidence', () => {
  it('returns initial confidence at creation time', () => {
    const tranche = makeTranche({ confidence: 100, addedAt: new Date('2026-04-10') });
    expect(calculateTrancheConfidence(tranche, pantryArea, new Date('2026-04-10'))).toBe(100);
  });

  it('applies fridge decay over time', () => {
    const tranche = makeTranche({ confidence: 100, addedAt: new Date('2026-04-01') });
    // 10 days * 3%/day = 30% decay -> 70
    const result = calculateTrancheConfidence(tranche, fridgeArea, new Date('2026-04-11'));
    expect(result).toBe(70);
  });

  it('applies pantry decay over time', () => {
    const tranche = makeTranche({ confidence: 100, addedAt: new Date('2026-04-01') });
    // 10 days * 0.3%/day = 3% decay -> 97
    const result = calculateTrancheConfidence(tranche, pantryArea, new Date('2026-04-11'));
    expect(result).toBe(97);
  });

  it('applies freezer decay over time', () => {
    const tranche = makeTranche({ confidence: 100, addedAt: new Date('2026-04-01') });
    // 10 days * 0.5%/day = 5% decay -> 95
    const result = calculateTrancheConfidence(tranche, freezerArea, new Date('2026-04-11'));
    expect(result).toBe(95);
  });

  it('never goes below 0', () => {
    const tranche = makeTranche({ confidence: 100, addedAt: new Date('2026-01-01') });
    // 100 days * 3%/day = 300% decay -> clamped to 0
    const result = calculateTrancheConfidence(tranche, fridgeArea, new Date('2026-04-11'));
    expect(result).toBe(0);
  });

  it('uses verifiedAt as reference when more recent', () => {
    const tranche = makeTranche({
      confidence: 100,
      addedAt: new Date('2026-04-01'),
      verifiedAt: new Date('2026-04-09'),
    });
    // 2 days since verification * 3%/day = 6% decay -> 94
    const result = calculateTrancheConfidence(tranche, fridgeArea, new Date('2026-04-11'));
    expect(result).toBe(94);
  });

  it('returns 0 when past expiry date', () => {
    const tranche = makeTranche({
      confidence: 100,
      addedAt: new Date('2026-04-01'),
      expiryDate: new Date('2026-04-10'),
    });
    const result = calculateTrancheConfidence(tranche, pantryArea, new Date('2026-04-11'));
    expect(result).toBe(0);
  });

  it('applies expiry proximity penalty within 2 days', () => {
    const tranche = makeTranche({
      confidence: 100,
      addedAt: new Date('2026-04-10'),
      expiryDate: new Date('2026-04-12'),
    });
    // 1 day of normal decay: 1 * 3 = 3
    // Plus expiry penalty: 10 * (2 - 1) = 10
    // Total: 100 - 3 - 10 = 87
    const result = calculateTrancheConfidence(tranche, fridgeArea, new Date('2026-04-11'));
    expect(result).toBe(87);
  });

  it('returns 0 for zero quantity', () => {
    const tranche = makeTranche({ quantity: 0 });
    expect(calculateTrancheConfidence(tranche, pantryArea)).toBe(0);
  });

  it('applies custom decay rate', () => {
    const tranche = makeTranche({ confidence: 100, addedAt: new Date('2026-04-01') });
    // 10 days * 5%/day = 50% decay -> 50
    const result = calculateTrancheConfidence(tranche, customDecayArea, new Date('2026-04-11'));
    expect(result).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// calculateItemConfidence (weighted across tranches)
// ---------------------------------------------------------------------------

describe('calculateItemConfidence', () => {
  it('returns 0 for empty tranches', () => {
    expect(calculateItemConfidence([], pantryArea)).toBe(0);
  });

  it('returns single tranche confidence for one tranche', () => {
    const tranche = makeTranche({ confidence: 80, addedAt: new Date('2026-04-11') });
    expect(calculateItemConfidence([tranche], pantryArea, new Date('2026-04-11'))).toBe(80);
  });

  it('computes quantity-weighted average across tranches', () => {
    const now = new Date('2026-04-11');
    // Tranche A: 200g at confidence 100, freshly added -> 100
    const a = makeTranche({ id: 'a', quantity: 200, confidence: 100, addedAt: now });
    // Tranche B: 100g at confidence 40, freshly added -> 40
    const b = makeTranche({ id: 'b', quantity: 100, confidence: 40, addedAt: now });
    // Weighted: (200*100 + 100*40) / 300 = 24000/300 = 80
    expect(calculateItemConfidence([a, b], pantryArea, now)).toBe(80);
  });

  it('ignores zero-quantity tranches', () => {
    const now = new Date('2026-04-11');
    const a = makeTranche({ id: 'a', quantity: 0, confidence: 100, addedAt: now });
    const b = makeTranche({ id: 'b', quantity: 50, confidence: 60, addedAt: now });
    expect(calculateItemConfidence([a, b], pantryArea, now)).toBe(60);
  });

  it('returns 0 when all tranches have zero quantity', () => {
    const now = new Date('2026-04-11');
    const a = makeTranche({ id: 'a', quantity: 0 });
    const b = makeTranche({ id: 'b', quantity: 0 });
    expect(calculateItemConfidence([a, b], pantryArea, now)).toBe(0);
  });

  it('accounts for decay in weighted calculation', () => {
    // Fresh tranche: 100g, confidence 100, just added
    const fresh = makeTranche({
      id: 'fresh', quantity: 100, confidence: 100,
      addedAt: new Date('2026-04-11'),
    });
    // Old tranche: 100g, confidence 100, 10 days old in fridge -> decayed to 70
    const old = makeTranche({
      id: 'old', quantity: 100, confidence: 100,
      addedAt: new Date('2026-04-01'),
    });
    // Weighted: (100*100 + 100*70) / 200 = 17000/200 = 85
    expect(calculateItemConfidence([fresh, old], fridgeArea, new Date('2026-04-11'))).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// getConfidenceBand
// ---------------------------------------------------------------------------

describe('getConfidenceBand', () => {
  it('returns high for scores >= 80', () => {
    expect(getConfidenceBand(80)).toBe('high');
    expect(getConfidenceBand(100)).toBe('high');
  });

  it('returns medium for scores >= 40 and < 80', () => {
    expect(getConfidenceBand(40)).toBe('medium');
    expect(getConfidenceBand(79)).toBe('medium');
  });

  it('returns low for scores < 40', () => {
    expect(getConfidenceBand(0)).toBe('low');
    expect(getConfidenceBand(39)).toBe('low');
  });

  it('respects custom thresholds', () => {
    const custom = { high: 90, medium: 50 };
    expect(getConfidenceBand(85, custom)).toBe('medium');
    expect(getConfidenceBand(90, custom)).toBe('high');
    expect(getConfidenceBand(49, custom)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// sortTranchesForDepletion (FIFO)
// ---------------------------------------------------------------------------

describe('sortTranchesForDepletion', () => {
  it('sorts oldest first', () => {
    const now = new Date('2026-04-11');
    const newer = makeTranche({ id: 'new', addedAt: new Date('2026-04-10') });
    const older = makeTranche({ id: 'old', addedAt: new Date('2026-04-01') });
    const sorted = sortTranchesForDepletion([newer, older], pantryArea, now);
    expect(sorted.map(t => t.id)).toEqual(['old', 'new']);
  });

  it('breaks ties by lowest confidence first', () => {
    const now = new Date('2026-04-11');
    const sameDate = new Date('2026-04-01');
    const highConf = makeTranche({ id: 'high', confidence: 100, addedAt: sameDate });
    const lowConf = makeTranche({ id: 'low', confidence: 30, addedAt: sameDate });
    const sorted = sortTranchesForDepletion([highConf, lowConf], pantryArea, now);
    expect(sorted.map(t => t.id)).toEqual(['low', 'high']);
  });

  it('excludes zero-quantity tranches', () => {
    const now = new Date('2026-04-11');
    const empty = makeTranche({ id: 'empty', quantity: 0, addedAt: new Date('2026-04-01') });
    const full = makeTranche({ id: 'full', quantity: 50, addedAt: new Date('2026-04-05') });
    const sorted = sortTranchesForDepletion([empty, full], pantryArea, now);
    expect(sorted.map(t => t.id)).toEqual(['full']);
  });
});

// ---------------------------------------------------------------------------
// planDepletion
// ---------------------------------------------------------------------------

describe('planDepletion', () => {
  it('depletes from a single tranche', () => {
    const tranche = makeTranche({ id: 't1', quantity: 100 });
    const plan = planDepletion([tranche], 30, pantryArea);

    expect(plan.fullyDepleted).toBe(true);
    expect(plan.totalDepleted).toBe(30);
    expect(plan.shortfall).toBe(0);
    expect(plan.instructions).toHaveLength(1);
    expect(plan.instructions[0]).toEqual({
      trancheId: 't1',
      currentQuantity: 100,
      depleteBy: 30,
      newQuantity: 70,
    });
  });

  it('depletes across multiple tranches FIFO', () => {
    const now = new Date('2026-04-11');
    const older = makeTranche({ id: 'old', quantity: 20, addedAt: new Date('2026-04-01') });
    const newer = makeTranche({ id: 'new', quantity: 50, addedAt: new Date('2026-04-10') });

    const plan = planDepletion([newer, older], 30, pantryArea, now);

    expect(plan.fullyDepleted).toBe(true);
    expect(plan.totalDepleted).toBe(30);
    expect(plan.instructions).toHaveLength(2);
    // Should deplete old first (20g), then 10g from new
    expect(plan.instructions[0]).toEqual({
      trancheId: 'old', currentQuantity: 20, depleteBy: 20, newQuantity: 0,
    });
    expect(plan.instructions[1]).toEqual({
      trancheId: 'new', currentQuantity: 50, depleteBy: 10, newQuantity: 40,
    });
  });

  it('reports shortfall when insufficient stock', () => {
    const tranche = makeTranche({ id: 't1', quantity: 10 });
    const plan = planDepletion([tranche], 50, pantryArea);

    expect(plan.fullyDepleted).toBe(false);
    expect(plan.totalDepleted).toBe(10);
    expect(plan.shortfall).toBe(40);
    expect(plan.instructions).toHaveLength(1);
    expect(plan.instructions[0].newQuantity).toBe(0);
  });

  it('handles empty tranches', () => {
    const plan = planDepletion([], 10, pantryArea);
    expect(plan.fullyDepleted).toBe(false);
    expect(plan.totalDepleted).toBe(0);
    expect(plan.shortfall).toBe(10);
    expect(plan.instructions).toHaveLength(0);
  });

  it('handles zero depletion amount', () => {
    const tranche = makeTranche({ id: 't1', quantity: 100 });
    const plan = planDepletion([tranche], 0, pantryArea);
    expect(plan.fullyDepleted).toBe(true);
    expect(plan.totalDepleted).toBe(0);
    expect(plan.shortfall).toBe(0);
    expect(plan.instructions).toHaveLength(0);
  });

  it('fully depletes exactly available quantity', () => {
    const tranche = makeTranche({ id: 't1', quantity: 50 });
    const plan = planDepletion([tranche], 50, pantryArea);
    expect(plan.fullyDepleted).toBe(true);
    expect(plan.shortfall).toBe(0);
    expect(plan.instructions[0].newQuantity).toBe(0);
  });
});
