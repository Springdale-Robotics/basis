import { describe, it, expect } from 'vitest';
import { parseRecipeFromText } from '../../src/modules/image-parse/extractors/recipe-extractor.js';

/**
 * Splitting a recipe into ingredients and method when nothing says where one
 * ends and the other begins — which is every handwritten card.
 *
 * The extractor used to latch into "ingredients" as soon as any quantity-led
 * line appeared and never leave, so the method check was unreachable. A real
 * card came back as eight ingredients, the last of which was the entire method,
 * and an empty Instructions section. The review box faithfully showed that, and
 * there was nothing to do but retype it.
 */

/** Verbatim transcription of the Spoon Bread card by qwen2.5vl:7b. */
const SPOON_BREAD = `Spoon Bread -Donna James
2 eggs
1-1/2 c (6oz) Mild Cheddar, divided
1 can (8oz) Cream style corn
1 can (8oz) Kernel corn, drained
1 pkg (8oz) Corn muffin mix
1 c. sour cream
6 Tbsp butter, melted
Beat eggs in medium bowl. Add 1 c.`;

describe('parseRecipeFromText: a card with no section headings', () => {
  const parsed = parseRecipeFromText(SPOON_BREAD);

  it('takes the first line as the title', () => {
    expect(parsed.title).toBe('Spoon Bread -Donna James');
  });

  it('keeps every quantity line as an ingredient', () => {
    expect(parsed.ingredients.map((i) => i.name)).toEqual([
      '2 eggs',
      '1-1/2 c (6oz) Mild Cheddar, divided',
      '1 can (8oz) Cream style corn',
      '1 can (8oz) Kernel corn, drained',
      '1 pkg (8oz) Corn muffin mix',
      '1 c. sour cream',
      '6 Tbsp butter, melted',
    ]);
  });

  it('recognises the method rather than filing it under ingredients', () => {
    // Divided per sentence. "Add 1 c." is a fragment because the front of the
    // card ends there and continues on the back.
    expect(parsed.instructions).toEqual(['Beat eggs in medium bowl.', 'Add 1 c.']);
    expect(parsed.ingredients.map((i) => i.name).join(' ')).not.toContain('Beat eggs');
  });
});

describe('parseRecipeFromText: line classification', () => {
  /**
   * The contested cases, pinned deliberately. Each is a judgement call about a
   * line that could plausibly go either way, so the choice should be visible
   * here rather than buried in a regex.
   */
  const cases: Array<{ line: string; expect: 'ingredient' | 'instruction'; why: string }> = [
    { line: '2 eggs', expect: 'ingredient', why: 'quantity-led' },
    { line: '1 c. sour cream', expect: 'ingredient', why: 'quantity-led, despite "cream" being a verb' },
    { line: '6 Tbsp butter, melted', expect: 'ingredient', why: 'quantity-led, despite "melted"' },
    { line: 'Salt and pepper to taste', expect: 'ingredient', why: 'short tail with no sentence punctuation' },
    { line: 'Beat eggs in medium bowl. Add 1 c.', expect: 'instruction', why: 'prose, not quantity-led' },
    { line: 'Preheat oven to 350 degrees.', expect: 'instruction', why: 'a sentence, not a quantity' },
    { line: 'Bake until the top is golden brown.', expect: 'instruction', why: 'a sentence, not a quantity' },
    // The point of classifying on structure rather than vocabulary: no list of
    // cooking words contains these, and it doesn't matter.
    { line: 'Spatchcock the bird and blowtorch the skin.', expect: 'instruction', why: 'no verb list needed' },
    { line: 'Temper the chocolate over a bain-marie.', expect: 'instruction', why: 'no verb list needed' },
    { line: '1. Preheat the oven.', expect: 'instruction', why: 'a step number is not a quantity' },
  ];

  for (const { line, expect: expected, why } of cases) {
    it(`treats "${line}" as ${expected} (${why})`, () => {
      // Prefixed with a quantity line so the "tail" rule has ingredients to
      // trail, matching how these appear on a real card.
      const parsed = parseRecipeFromText(`Test Recipe\n1 cup flour\n${line}`);
      // A line stored as an instruction has its step number stripped and may
      // be divided into sentences, so compare on the text rather than on
      // whole-line identity.
      const withoutStepNumber = line.replace(/^\d+[.)]\s*/, '');
      const landed = parsed.ingredients.some((i) => i.name === line)
        ? 'ingredient'
        : parsed.instructions.join(' ') === withoutStepNumber
          ? 'instruction'
          : 'dropped';
      expect(landed).toBe(expected);
    });
  }
});

describe('parseRecipeFromText: headings', () => {
  it('honours explicit headings, including lines that look like neither', () => {
    const parsed = parseRecipeFromText(
      ['Soup', 'Ingredients', 'a good pinch of saffron', 'Instructions', 'Warm it through.'].join('\n')
    );
    expect(parsed.ingredients.map((i) => i.name)).toEqual(['a good pinch of saffron']);
    expect(parsed.instructions).toEqual(['Warm it through.']);
  });

  it('does not mistake a step that mentions ingredients for a heading', () => {
    // "Mix all ingredients until smooth" contains the word, and used to switch
    // the parser into the ingredients section for the rest of the recipe.
    const parsed = parseRecipeFromText(
      ['Cake', '1 cup flour', 'Mix all ingredients until smooth.', 'Bake for 30 minutes.'].join('\n')
    );
    expect(parsed.ingredients.map((i) => i.name)).toEqual(['1 cup flour']);
    expect(parsed.instructions).toEqual(['Mix all ingredients until smooth.', 'Bake for 30 minutes.']);
  });
});
