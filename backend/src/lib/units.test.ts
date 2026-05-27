import { describe, it, expect } from 'vitest';
import { convert, resolveUnit, type QuantityUnitSizes } from './units';

const closeTo = (n: number | null, expected: number, eps = 1e-4) => {
  expect(n).not.toBeNull();
  expect(Math.abs(n! - expected)).toBeLessThan(eps);
};

describe('convert', () => {
  // -------------------------------------------------------------------------
  // Same unit / no-op
  // -------------------------------------------------------------------------
  it('returns input quantity when the two units are the same key', () => {
    expect(convert(3, 'tsp', 'tsp')).toBe(3);
  });

  it('recognizes synonyms as the same unit', () => {
    // tablespoon and tbsp are the same unit; convert should return the input.
    expect(resolveUnit('tablespoon')).toBe(resolveUnit('tbsp'));
    expect(convert(2, 'tablespoon', 'tbsp')).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Same dimension
  // -------------------------------------------------------------------------
  it('converts within volume', () => {
    // 1 fl oz = 2 tbsp = 6 tsp
    closeTo(convert(1, 'fl oz', 'tbsp'), 2);
    closeTo(convert(1, 'fl oz', 'tsp'), 6);
    closeTo(convert(1, 'cup', 'fl oz'), 8);
  });

  it('converts within weight', () => {
    // 1 lb ≈ 453.592 g; 1 kg = 1000 g
    closeTo(convert(1, 'lb', 'g'), 453.592, 0.01);
    closeTo(convert(1, 'kg', 'g'), 1000);
  });

  // -------------------------------------------------------------------------
  // Cross-dimension with density
  // -------------------------------------------------------------------------
  it('requires density for weight↔volume and returns null without it', () => {
    expect(convert(1, 'cup', 'g')).toBeNull();
    expect(convert(100, 'g', 'cup')).toBeNull();
  });

  it('uses density (g/cup) for volume → weight', () => {
    // Olive oil ≈ 217 g/cup, so 1 cup ≈ 217 g.
    closeTo(convert(1, 'cup', 'g', 217), 217);
  });

  it('uses density for weight → volume', () => {
    // 434 g / 217 g/cup = 2 cups
    closeTo(convert(434, 'g', 'cup', 217), 2);
  });

  // -------------------------------------------------------------------------
  // Per-item quantity sizes (count units → standard units)
  // -------------------------------------------------------------------------
  const bottleSizes: QuantityUnitSizes = {
    bottle: { quantity: 16, unit: 'fl oz' },
  };

  it('resolves count → standard via sizes without density', () => {
    // 1 bottle = 16 fl oz = 32 tbsp = 96 tsp
    closeTo(convert(1, 'bottle', 'fl oz', null, bottleSizes), 16);
    closeTo(convert(1, 'bottle', 'tbsp', null, bottleSizes), 32);
    closeTo(convert(1, 'bottle', 'tsp', null, bottleSizes), 96);
  });

  it('resolves standard → count via sizes (inverse direction)', () => {
    closeTo(convert(16, 'fl oz', 'bottle', null, bottleSizes), 1);
    closeTo(convert(32, 'tbsp', 'bottle', null, bottleSizes), 1);
    closeTo(convert(8, 'fl oz', 'bottle', null, bottleSizes), 0.5);
  });

  it('combines sizes with density when sides need both', () => {
    // 1 bag = 5 lb (weight). Recipe wants cups; density 125 g/cup (flour).
    // 5 lb = 2267.96 g → 18.144 cups
    const sizes: QuantityUnitSizes = { bag: { quantity: 5, unit: 'lb' } };
    closeTo(convert(1, 'bag', 'cup', 125, sizes), 18.1437, 0.001);
  });

  it('returns null when count→standard sizes are missing', () => {
    // Without sizes, a count unit can't bridge to anything.
    expect(convert(1, 'bottle', 'tsp')).toBeNull();
    expect(convert(1, 'bottle', 'g', 217)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  it('returns null for negligible units', () => {
    // "pinch" is in the negligible category.
    expect(convert(1, 'pinch', 'g')).toBeNull();
    expect(convert(1, 'g', 'pinch')).toBeNull();
  });

  it('does not infinite-loop on a cycle in sizes (depth-bounded)', () => {
    // bottle → case → bottle. The depth guard caps iteration; the result is
    // undefined but the call must terminate.
    const cyclic: QuantityUnitSizes = {
      bottle: { quantity: 12, unit: 'case' },
      case: { quantity: 1, unit: 'bottle' },
    };
    // Should return *something* (possibly null) without throwing or hanging.
    expect(() => convert(1, 'bottle', 'fl oz', null, cyclic)).not.toThrow();
  });

  it('handles partial sizes resolution + same-category math', () => {
    // 0.5 bottle → 8 fl oz → 16 tbsp
    closeTo(convert(0.5, 'bottle', 'tbsp', null, bottleSizes), 16);
  });

  it('returns null when only one side is a count unit and no sizes provided', () => {
    expect(convert(1, 'each', 'g')).toBeNull();
    expect(convert(100, 'g', 'each')).toBeNull();
  });
});
