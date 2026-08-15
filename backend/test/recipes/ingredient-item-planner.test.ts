import { describe, it, expect } from 'vitest';
import { planIngredientItems } from '../../src/modules/recipes/ingredient-item-planner.js';
import { SUGGESTION_THRESHOLD } from '../../src/modules/recipes/ingredient-matching.service.js';

/**
 * Importing a collection founds a household's inventory, and whatever it is
 * founded on is inherited by every later link and shopping list. Variants
 * typed across different recipe cards — "salt" here, "table salt" there,
 * "cinamon" where "cinnamon" was meant — used to become separate items with
 * nothing ever comparing them, because near-match detection only ever looked
 * at what was already stocked. On an empty inventory it therefore did nothing
 * at all, which is precisely the case when someone is importing for the first
 * time.
 */

const plan = (names: string[], existing: Array<{ id: string; name: string }> = []) =>
  planIngredientItems({
    incoming: names.map((name) => ({ name, canonicalName: name })),
    existing,
    suggestionThreshold: SUGGESTION_THRESHOLD,
  });

const find = (result: ReturnType<typeof plan>, canonicalName: string) =>
  result.items.find((i) => i.canonicalName === canonicalName)!;

describe('planIngredientItems: variants arriving together', () => {
  it('notices that two new names look like the same thing', () => {
    const result = plan(['salt', 'table salt']);

    // Both are still planned separately — see the merge test below.
    expect(result.items).toHaveLength(2);
    expect(find(result, 'salt').similarPlanned[0].canonicalName).toBe('table salt');
    expect(find(result, 'table salt').similarPlanned[0].canonicalName).toBe('salt');
  });

  it('notices a misspelling of another incoming name', () => {
    const result = plan(['cinnamon', 'cinamon']);
    expect(find(result, 'cinnamon').similarPlanned[0].canonicalName).toBe('cinamon');
  });

  it('leaves genuinely different ingredients alone', () => {
    const result = plan(['salt', 'flour', 'butter']);
    for (const item of result.items) {
      expect(item.similarPlanned).toEqual([]);
    }
    expect(result.needingReview).toBe(0);
  });

  it('never merges on its own', () => {
    // "kosher salt" and "table salt" read as near-identical strings, but
    // whether a kitchen treats them as one item is not a fact about the words.
    const result = plan(['kosher salt', 'table salt']);

    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.action === 'create')).toBe(true);
    expect(result.needingReview).toBe(2);
  });
});

describe('planIngredientItems: names that already agree', () => {
  it('collapses identical ingredients from different recipes into one decision', () => {
    const result = plan(['Olive Oil', 'olive oil', 'OLIVE OIL']);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].originalNames).toEqual(['Olive Oil', 'olive oil', 'OLIVE OIL']);
    expect(result.items[0].similarPlanned).toEqual([]);
  });

  it('treats punctuation differences as the same ingredient', () => {
    const result = plan(['all purpose flour', 'all-purpose flour']);
    expect(result.items).toHaveLength(1);
  });
});

describe('planIngredientItems: against what is already stocked', () => {
  const pantry = [{ id: 'item-1', name: 'Olive Oil' }];

  it('links to a stocked item rather than planning a new one', () => {
    const result = plan(['olive oil'], pantry);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].action).toBe('link');
    expect(result.items[0].existingItemId).toBe('item-1');
    // Keeps the household's own spelling rather than the recipe's.
    expect(result.items[0].canonicalName).toBe('Olive Oil');
  });

  it('reports a near-match to a stocked item without adopting it', () => {
    const result = plan(['light olive oil'], pantry);

    expect(result.items[0].action).toBe('create');
    expect(result.items[0].similarExisting[0]).toMatchObject({ itemId: 'item-1', name: 'Olive Oil' });
  });

  it('counts everything worth a second look', () => {
    const result = plan(['salt', 'table salt', 'light olive oil', 'flour'], pantry);

    // salt/table salt see each other; light olive oil sees the pantry; flour
    // sees nothing.
    expect(result.needingReview).toBe(3);
    expect(find(result, 'flour').similarPlanned).toEqual([]);
    expect(find(result, 'flour').similarExisting).toEqual([]);
  });
});

describe('planIngredientItems: nothing is written', () => {
  it('is a pure function of its inputs', () => {
    const existing = [{ id: 'item-1', name: 'Olive Oil' }];
    const incoming = [{ name: 'salt', canonicalName: 'salt' }];
    const snapshot = JSON.stringify({ existing, incoming });

    planIngredientItems({ incoming, existing, suggestionThreshold: SUGGESTION_THRESHOLD });

    expect(JSON.stringify({ existing, incoming })).toBe(snapshot);
  });
});
