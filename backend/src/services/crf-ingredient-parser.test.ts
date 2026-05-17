import { describe, it, expect } from 'vitest';
import { isCRFParserAvailable, parseIngredientsWithCRF } from './crf-ingredient-parser.js';

// These tests hit the live CRF/VLM-LLM service to verify it handles the
// ingredient-line edge cases (Unicode fractions, parentheticals, ranges,
// prep descriptors) that justified keeping a regex fallback. They skip when
// the service is unreachable so CI without docker doesn't fail.
//
// Background: the regex ingredient parser was removed once these cases all
// pass — silent regex output was producing confidently-wrong ingredients.
// On CRF failure today the import surfaces a warning instead of guessing.

// Resolved at module load so it.skipIf can see it during test registration.
const serviceUp = await isCRFParserAvailable();
if (!serviceUp) {
  console.warn('[crf-ingredient-parser.test] CRF service unreachable — edge-case tests skipped');
}

describe('CRF ingredient parser — edge cases', () => {
  it.skipIf(!serviceUp)('handles plain numeric quantity + unit + name', async () => {
    const [r] = await parseIngredientsWithCRF(['2 cups all-purpose flour']);
    expect(r.quantity).toBe(2);
    expect(r.unit?.toLowerCase()).toMatch(/cup/);
    expect(r.name.toLowerCase()).toContain('flour');
  });

  it.skipIf(!serviceUp)('handles Unicode vulgar fractions', async () => {
    const results = await parseIngredientsWithCRF([
      '½ cup sugar',
      '¼ tsp salt',
      '¾ cup milk',
    ]);
    expect(results[0].quantity).toBeCloseTo(0.5);
    expect(results[1].quantity).toBeCloseTo(0.25);
    expect(results[2].quantity).toBeCloseTo(0.75);
  });

  it.skipIf(!serviceUp)('handles mixed numbers ("1½ cups flour")', async () => {
    const [r] = await parseIngredientsWithCRF(['1½ cups flour']);
    expect(r.quantity).toBeCloseTo(1.5);
    expect(r.unit?.toLowerCase()).toMatch(/cup/);
  });

  it.skipIf(!serviceUp)('handles parenthetical size ("1 (14.5 oz) can diced tomatoes")', async () => {
    const [r] = await parseIngredientsWithCRF(['1 (14.5 oz) can diced tomatoes']);
    expect(r.quantity).toBe(1);
    expect(r.unit?.toLowerCase()).toContain('can');
    expect(r.name.toLowerCase()).toContain('tomato');
    // Parenthetical should land in notes, not pollute the name
    expect(r.name.toLowerCase()).not.toContain('14.5');
  });

  it.skipIf(!serviceUp)('handles quantity ranges ("2-3 tablespoons olive oil")', async () => {
    const [r] = await parseIngredientsWithCRF(['2-3 tablespoons olive oil']);
    // CRF may pick lower bound, upper bound, or middle — any of those is fine
    // as long as it's a number near the range
    expect(r.quantity).toBeGreaterThanOrEqual(2);
    expect(r.quantity).toBeLessThanOrEqual(3);
    expect(r.unit?.toLowerCase()).toMatch(/tablespoon|tbsp/);
  });

  it.skipIf(!serviceUp)('handles trailing prep descriptors ("1 bunch fresh cilantro, roughly chopped")', async () => {
    const [r] = await parseIngredientsWithCRF(['1 bunch fresh cilantro, roughly chopped']);
    expect(r.quantity).toBe(1);
    expect(r.name.toLowerCase()).toContain('cilantro');
    // "roughly chopped" should land in notes, not in name
    expect(r.name.toLowerCase()).not.toContain('chopped');
  });

  it.skipIf(!serviceUp)('handles "to taste" descriptive ingredients', async () => {
    const [r] = await parseIngredientsWithCRF(['Salt and pepper to taste']);
    // Acceptable outcomes: returns one ingredient with no quantity, or splits.
    // Just assert it didn't throw and produced something with a name.
    expect(r.name).toBeTruthy();
  });

  it.skipIf(!serviceUp)('handles bullet/dash prefixes', async () => {
    const results = await parseIngredientsWithCRF([
      '- 2 cups flour',
      '• 1 tsp salt',
      '* 3 eggs',
    ]);
    expect(results[0].quantity).toBe(2);
    expect(results[1].quantity).toBe(1);
    expect(results[2].quantity).toBe(3);
    // None of the prefix characters should leak into the name
    for (const r of results) {
      expect(r.name).not.toMatch(/^[-•*]/);
    }
  });

  it.skipIf(!serviceUp)('handles weight notes in parentheses ("4-5 boneless skinless chicken breasts (about 2 lbs)")', async () => {
    const [r] = await parseIngredientsWithCRF(['4-5 boneless skinless chicken breasts (about 2 lbs)']);
    expect(r.name.toLowerCase()).toContain('chicken');
    expect(r.name.toLowerCase()).not.toContain('about');
  });

  it.skipIf(!serviceUp)('handles pinch / dash quantifiers', async () => {
    const [r] = await parseIngredientsWithCRF(['1 pinch kosher salt']);
    expect(r.quantity).toBe(1);
    expect(r.unit?.toLowerCase()).toContain('pinch');
    expect(r.name.toLowerCase()).toContain('salt');
  });
});
