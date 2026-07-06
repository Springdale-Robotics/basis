import { describe, expect, it } from 'vitest';
import { sumStock } from './stock-total.js';

describe('sumStock', () => {
  it('sums same-unit tranches directly', () => {
    const r = sumStock(
      [
        { quantity: '500', unit: 'g' },
        { quantity: '250', unit: 'g' },
      ],
      'g',
      null,
      null,
    );
    expect(r.convertedTotal).toBe(750);
    expect(r.allConverted).toBe(true);
  });

  it('converts mixed units instead of summing raw (the "501 g" bug)', () => {
    const r = sumStock(
      [
        { quantity: '500', unit: 'g' },
        { quantity: '1', unit: 'kg' },
      ],
      'g',
      null,
      null,
    );
    expect(r.convertedTotal).toBe(1500);
    expect(r.allConverted).toBe(true);
  });

  it('bridges weight to volume with density', () => {
    // density is g per cup; 1 cup = 240 ml
    const r = sumStock([{ quantity: '120', unit: 'g' }], 'cup', 120, null);
    expect(r.convertedTotal).toBeCloseTo(1, 5);
  });

  it('bridges custom count units via quantityUnitSizes', () => {
    const r = sumStock(
      [{ quantity: '2', unit: 'bottle' }],
      'ml',
      null,
      { bottle: { quantity: 750, unit: 'ml' } },
    );
    expect(r.convertedTotal).toBeCloseTo(1500, 5);
  });

  it('reports unconvertible tranches separately instead of dropping them', () => {
    const r = sumStock(
      [
        { quantity: '500', unit: 'g' },
        { quantity: '2', unit: 'bunch' },
      ],
      'g',
      null,
      null,
    );
    expect(r.convertedTotal).toBe(500);
    expect(r.unconvertedRaw).toBe(2);
    expect(r.allConverted).toBe(false);
    expect(r.unconvertedUnits).toEqual(['bunch']);
  });

  it('treats a null tranche unit as the target unit', () => {
    const r = sumStock([{ quantity: '3', unit: null }], 'each', null, null);
    expect(r.convertedTotal).toBe(3);
  });
});
