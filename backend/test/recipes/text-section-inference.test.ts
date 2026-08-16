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

  it('breaks the method into one step per sentence', () => {
    expect(result.recipe.instructions).toEqual([
      'Beat eggs in medium bowl.',
      'Add 1 c. Cheese, both corns, muffin mix, sour cream & melted butter, mixing thoroughly until combined.',
      'Pour mixture into greased 2 qt. baking dish.',
      'Bake in preheated 350° oven 45 min or until center is set.',
      'Top with remaining cheese, bake 2 min more or until cheese is melted.',
    ]);
  });

  it('does not mistake an abbreviation for the end of a step', () => {
    // Two traps in this card. The front stops at "Add 1 c." and continues onto
    // the back, so that period must not divide anything; and "2 qt. baking
    // dish" carries one mid-step.
    expect(result.recipe.instructions[1]).toMatch(/^Add 1 c\. Cheese/);
    expect(result.recipe.instructions[2]).toBe('Pour mixture into greased 2 qt. baking dish.');
  });
});

describe('parseRecipeTextWithConfidence: a method transcribed as a single line', () => {
  /**
   * The reported failure, verbatim. Asked to transcribe the same card twice,
   * the vision model kept the line breaks once and ran the whole method
   * together the next time. Splitting on line breaks alone therefore produced
   * a recipe with one enormous step — for the same photo that had worked
   * moments earlier.
   */
  const ONE_LINE_BACK =
    'Cheese, both corn, muffin mix, pour cream & melted butter, mixing thoroughly until combined. Pour mixture into greased 2 qt. baking dish. Bake in preheated 350° oven 45 min or until center is set. Top with remaining cheese, bake 2 min more or until cheese is melted.';

  it('divides it into steps anyway', () => {
    const result = parseRecipeTextWithConfidence([CARD_FRONT, ONE_LINE_BACK].join('\n\n'));

    expect(result.recipe.instructions).toEqual([
      'Beat eggs in medium bowl.',
      'Add 1 c. Cheese, both corn, muffin mix, pour cream & melted butter, mixing thoroughly until combined.',
      'Pour mixture into greased 2 qt. baking dish.',
      'Bake in preheated 350° oven 45 min or until center is set.',
      'Top with remaining cheese, bake 2 min more or until cheese is melted.',
    ]);
  });

  it('reads the same whether or not the transcription kept its line breaks', () => {
    const asLines = parseRecipeTextWithConfidence([CARD_FRONT, CARD_BACK].join('\n\n'));
    const asOneLine = parseRecipeTextWithConfidence([CARD_FRONT, ONE_LINE_BACK].join('\n\n'));

    expect(asOneLine.recipe.instructions).toHaveLength(asLines.recipe.instructions.length);
    expect(asOneLine.recipe.ingredients).toEqual(asLines.recipe.ingredients);
  });
});

describe('parseRecipeTextWithConfidence: wrapped lines', () => {
  it('leaves a recipe that numbers its own steps alone', () => {
    // "1." may deliberately cover several sentences. The author has said where
    // the divisions are, so they are not second-guessed.
    const result = parseRecipeTextWithConfidence(
      [
        'Bread',
        'Ingredients',
        '500 g flour',
        'Instructions',
        '1. Mix the dough. Knead it for ten minutes. Leave it to rise.',
        '2. Shape and bake.',
      ].join('\n')
    );

    expect(result.recipe.instructions).toEqual([
      'Mix the dough. Knead it for ten minutes. Leave it to rise.',
      'Shape and bake.',
    ]);
  });

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

  it('keeps a bare ingredient under a heading out of the method', () => {
    // With an Ingredients heading but no Instructions heading, the boundary is
    // still inferred — and "lettuce" was being read as the first step, because
    // it carries no quantity. The heading has already said what it is.
    const result = parseRecipeTextWithConfidence(['Salad', 'Ingredients', 'lettuce'].join('\n'));

    expect(result.recipe.ingredients.map((i) => i.name)).toEqual(['lettuce']);
    expect(result.recipe.instructions).toEqual([]);
  });

  it('still finds where the method starts under an ingredients heading', () => {
    const result = parseRecipeTextWithConfidence(
      ['Cake', 'Ingredients', '2 cups flour', 'a pinch of salt', 'Bake until risen.'].join('\n')
    );

    expect(result.recipe.ingredients.map((i) => i.name)).toEqual(['2 cups flour', 'a pinch of salt']);
    expect(result.recipe.instructions).toEqual(['Bake until risen.']);
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

describe('parseRecipeTextWithConfidence: a reader that writes markdown', () => {
  /**
   * The vlm-llm sidecar hands back markdown rather than plain transcription,
   * and judged literally none of it was recognisable: "**Ingredients:**" is
   * not a heading because of the asterisks, and "- 2 eggs" is not quantity-led
   * because of the bullet. A complete recipe parsed to nothing at all — no
   * title, no ingredients, no method — with nothing anywhere reporting a
   * problem.
   */
  const MARKDOWN = [
    '**Title:**',
    'Spoon Bread - Donna James',
    '',
    '**Ingredients:**',
    '- 2 eggs',
    '- 1 can (8 oz) cream style corn',
    '- 1/2 c. sour cream',
    '',
    '**Instructions:**',
    'Beat eggs in medium bowl.',
  ].join('\n');

  const result = parseRecipeTextWithConfidence(MARKDOWN);

  it('reads the title from beneath its label', () => {
    // "**Title:**" is a label for the line under it, not a name.
    expect(result.recipe.title).toBe('Spoon Bread - Donna James');
  });

  it('sees bulleted lines as the ingredients they are', () => {
    expect(result.recipe.ingredients.map((i) => i.name)).toEqual([
      '2 eggs',
      '1 can (8 oz) cream style corn',
      '1/2 c. sour cream',
    ]);
  });

  it('finds the method under a decorated heading', () => {
    expect(result.recipe.instructions).toEqual(['Beat eggs in medium bowl.']);
  });

  it('reads a plain transcription exactly as before', () => {
    // The decoration is stripped only to judge a line; nothing else changes.
    const plain = parseRecipeTextWithConfidence(
      ['Pancakes', 'Ingredients', '2 cups flour', 'Instructions', 'Fry until golden.'].join('\n')
    );
    expect(plain.recipe.title).toBe('Pancakes');
    expect(plain.recipe.ingredients.map((i) => i.name)).toEqual(['2 cups flour']);
    expect(plain.recipe.instructions).toEqual(['Fry until golden.']);
  });
});
