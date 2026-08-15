import { describe, it, expect } from 'vitest';
import { parseRecipeTextWithConfidence } from '../../src/modules/recipes/recipe-import.service.js';

/**
 * Where the ingredients end and the method begins, when the recipe doesn't say.
 *
 * A recipe photographed off a card arrives as text with no "Ingredients" or
 * "Instructions" headings — the quantities stop and the prose starts. This
 * parser anchored the ingredients at the first quantity-led line and ran them
 * to the last line of the recipe, so the entire method was collected as things
 * to buy: eleven ingredients and no steps, from a transcription that was
 * completely correct.
 */

/** Verbatim transcription of both sides of the Spoon Bread card. */
const CARD_FRONT = `Spoon Bread -Donna James
2 eggs
1-1/2 c (6oz) Mild Cheddar, divided
1 can (8oz) Cream style corn
1 can (8oz) Kernel corn, drained
1 pkg. (8oz) Corn muffin mix
1 c. sour cream
6 Tbsp butter, melted
Beat eggs in medium bowl. Add 1 c.`;

const CARD_BACK = `Cheese, both corns, muffin mix, sour cream & melted butter, mixing thoroughly until combined.
Pour mixture into greased 2 qt. baking dish.
Bake in preheated 350° oven 45 min or until center is set. Top with remaining cheese, bake 2 min more or until cheese is melted.`;

describe('parseRecipeTextWithConfidence: a card photographed front and back', () => {
  const result = parseRecipeTextWithConfidence([CARD_FRONT, CARD_BACK].join('\n\n'));

  it('takes the title from the first line', () => {
    expect(result.recipe.title).toBe('Spoon Bread -Donna James');
  });

  it('stops the ingredients where the quantities stop', () => {
    expect(result.recipe.ingredients.map((i) => i.name)).toEqual([
      '2 eggs',
      '1-1/2 c (6oz) Mild Cheddar, divided',
      '1 can (8oz) Cream style corn',
      '1 can (8oz) Kernel corn, drained',
      '1 pkg. (8oz) Corn muffin mix',
      '1 c. sour cream',
      '6 Tbsp butter, melted',
    ]);
  });

  it('collects the method instead of shopping for it', () => {
    const method = result.recipe.instructions.join(' ');
    expect(method).toContain('Beat eggs in medium bowl');
    expect(method).toContain('Pour mixture into greased 2 qt. baking dish');
    expect(method).toContain('Bake in preheated 350');
    // And no step is masquerading as an ingredient.
    expect(result.recipe.ingredients.map((i) => i.name).join(' ')).not.toContain('Bake');
  });

  it('says that it worked the split out rather than being told', () => {
    expect(result.warnings.join(' ')).toMatch(/inferred/i);
  });

  it('breaks the method into steps at sentence ends', () => {
    expect(result.recipe.instructions).toHaveLength(3);
    expect(result.recipe.instructions[1]).toBe('Pour mixture into greased 2 qt. baking dish.');
  });

  it('rejoins the sentence that runs across the two photos', () => {
    // The front of the card stops at "Add 1 c." — an abbreviation, not a full
    // stop — and the back continues "Cheese, both corns…". Treating that
    // period as the end of a step split one sentence into two.
    expect(result.recipe.instructions[0]).toBe(
      'Beat eggs in medium bowl. Add 1 c. Cheese, both corns, muffin mix, sour cream & melted butter, mixing thoroughly until combined.'
    );
  });
});

describe('parseRecipeTextWithConfidence: wrapped lines', () => {
  it('still rejoins a step wrapped across lines by a PDF', () => {
    const result = parseRecipeTextWithConfidence(
      [
        'Stew',
        'Ingredients',
        '1 kg beef',
        'Instructions',
        'Brown the beef in batches, then set it aside while you',
        'soften the onions in the same pan.',
        'Return everything to the pan and simmer for two hours.',
      ].join('\n')
    );

    // The first line has no terminator, so it is a wrap, not a finished step.
    expect(result.recipe.instructions).toEqual([
      'Brown the beef in batches, then set it aside while you soften the onions in the same pan.',
      'Return everything to the pan and simmer for two hours.',
    ]);
  });
});

describe('parseRecipeTextWithConfidence: explicit headings still win', () => {
  it('leaves a conventionally formatted recipe alone', () => {
    const result = parseRecipeTextWithConfidence(
      [
        'Pancakes',
        'Ingredients',
        '2 cups flour',
        'a good pinch of salt',
        'Instructions',
        'Mix the dry ingredients.',
        'Fry until golden.',
      ].join('\n')
    );

    expect(result.recipe.title).toBe('Pancakes');
    // "a good pinch of salt" is not quantity-led; the heading still claims it.
    expect(result.recipe.ingredients.map((i) => i.name)).toEqual([
      '2 cups flour',
      'a good pinch of salt',
    ]);
    expect(result.recipe.instructions.join(' ')).toContain('Fry until golden');
  });

  it('does not end the ingredients on a group header', () => {
    // "To serve:" contains a cooking verb but introduces more ingredients.
    const result = parseRecipeTextWithConfidence(
      ['Trifle', '200 g sponge', 'To serve:', '100 ml cream', 'Assemble in a bowl.'].join('\n')
    );

    expect(result.recipe.ingredients.map((i) => i.name)).toContain('100 ml cream');
    expect(result.recipe.instructions.join(' ')).toContain('Assemble in a bowl');
  });
});
