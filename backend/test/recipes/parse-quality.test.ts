import { describe, it, expect } from 'vitest';
import { confidenceFromCrfParse } from '../../src/modules/recipes/recipe-import.service.js';
import { validateLLMRecipe } from '../../src/services/llm-recipe-parser.js';
import type { ParsedRecipe } from '../../src/db/schema/recipes.js';

// The UI calls >= 0.8 "Looks complete" and >= 0.5 "Review carefully".
const LOOKS_COMPLETE = 0.8;

function recipe(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    title: 'Tomato Pasta',
    instructions: ['Boil the pasta.', 'Add the sauce.'],
    ingredients: [
      { name: 'all-purpose flour', quantity: 2, unit: 'cup' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
    ],
    ...overrides,
  };
}

describe('confidenceFromCrfParse', () => {
  it('calls a clean parse complete', () => {
    // A flat 0.75 used to be reported for every text import — just under the
    // threshold — so a recipe where CRF got every field right still read
    // "Review carefully", training users to ignore the badge.
    expect(confidenceFromCrfParse(recipe(), 0.99)).toBeGreaterThanOrEqual(LOOKS_COMPLETE);
  });

  it('holds back when the parser was unsure', () => {
    expect(confidenceFromCrfParse(recipe(), 0.2)).toBeLessThan(LOOKS_COMPLETE);
  });

  it('never claims complete without instructions', () => {
    expect(
      confidenceFromCrfParse(recipe({ instructions: [] }), 0.99)
    ).toBeLessThan(LOOKS_COMPLETE);
  });

  it('flags ingredient names that are really whole recipe lines', () => {
    // The signature of text that never went through a parser at all — the
    // exact state the bulk URL import used to reach while reporting 100%.
    const unparsed = recipe({
      ingredients: [{ name: '2 tablespoons extra-virgin olive oil, plus more for drizzling' }],
    });
    expect(confidenceFromCrfParse(unparsed, 0.99)).toBeLessThan(0.6);
  });

  it('is a little less sure without a title', () => {
    const untitled = confidenceFromCrfParse(recipe({ title: 'Untitled Recipe' }), 0.99);
    expect(untitled).toBeLessThan(confidenceFromCrfParse(recipe(), 0.99));
  });
});

describe('validateLLMRecipe', () => {
  const valid = {
    title: 'Chili',
    instructions: ['Brown the beef.'],
    ingredientGroups: [
      { name: null, ingredients: [{ name: 'ground beef', quantity: 2, unit: 'lb' }] },
    ],
  };

  it('accepts a well-formed recipe', () => {
    expect(validateLLMRecipe(valid)).toBe(true);
  });

  it('rejects output with no ingredients or no steps', () => {
    expect(validateLLMRecipe({ ...valid, instructions: [] })).toBe(false);
    expect(validateLLMRecipe({ ...valid, ingredientGroups: [] })).toBe(false);
    expect(validateLLMRecipe({ ...valid, instructions: ['  '] })).toBe(false);
  });

  it('rejects a non-numeric quantity', () => {
    // Only the presence of three keys was checked before, so "two" sailed
    // through and replaced a parse that may have been better.
    const bad = {
      ...valid,
      ingredientGroups: [
        { name: null, ingredients: [{ name: 'beef', quantity: 'two' as unknown as number }] },
      ],
    };
    expect(validateLLMRecipe(bad)).toBe(false);
  });

  it('rejects an empty or echoed-back ingredient name', () => {
    expect(
      validateLLMRecipe({
        ...valid,
        ingredientGroups: [{ name: null, ingredients: [{ name: '   ' }] }],
      })
    ).toBe(false);

    expect(
      validateLLMRecipe({
        ...valid,
        ingredientGroups: [
          {
            name: null,
            ingredients: [{ name: 'x'.repeat(120) }],
          },
        ],
      })
    ).toBe(false);
  });

  it('rejects missing or malformed output', () => {
    expect(validateLLMRecipe(null)).toBe(false);
    expect(validateLLMRecipe({ ...valid, title: '' })).toBe(false);
  });
});
