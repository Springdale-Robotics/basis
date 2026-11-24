// Tests a frontend helper (frontend/src/lib/recipe-utils.ts) from the backend
// suite: the frontend has no test runner, and the photo-import eval runs this
// same function, so it is exercised end to end there too.
import { describe, expect, it } from 'vitest';
import { combinePagesForEditing } from '../../../frontend/src/lib/recipe-utils.js';

const front = {
  rawText: 'Spoon Bread —Donna James\n\n2 eggs\n1 c. sour cream\n\nBeat eggs in medium bowl. Add 1 c.',
  parsedContent: {
    type: 'recipe' as const,
    data: { title: 'Spoon Bread', description: 'Donna James', ingredients: [{ name: '2 eggs', confidence: 0.9 }], instructions: ['Beat eggs.'] },
  },
};
const back = {
  rawText: 'cheese, both corns, muffin mix, sour cream & melted butter.\nBake 45 min.',
  parsedContent: { type: 'recipe' as const, data: { title: '', ingredients: [], instructions: ['cheese, both corns…'] } },
};

describe('combinePagesForEditing', () => {
  it('one page: the structured formatting, as before', () => {
    const text = combinePagesForEditing([front]);
    expect(text.split('\n')[0]).toBe('Spoon Bread');
    expect(text).toContain('Ingredients');
  });

  it('several pages: the first page\'s structured title leads, then the joined text', () => {
    const text = combinePagesForEditing([front, back]);
    expect(text.split('\n')[0]).toBe('Spoon Bread');
    // The method still runs across the pages as written.
    expect(text).toContain('Add 1 c.\n\ncheese, both corns');
  });

  it('several pages with no structured title: the joined text as read', () => {
    const plain = combinePagesForEditing([{ ...front, parsedContent: null }, { ...back, parsedContent: null }]);
    expect(plain).toBe(`${front.rawText}\n\n${back.rawText}`);
  });
});
