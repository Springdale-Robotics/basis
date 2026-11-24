import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ crf: vi.fn() }));

vi.mock('../../src/modules/recipes/recipe-import.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/recipes/recipe-import.service.js')>()),
  parseIngredientLinesViaCRF: mocks.crf,
}));

const { addIngredientQuantities } = await import('../../src/modules/image-parse/image-parse.service.js');
const { INGREDIENT_PARSER_UNAVAILABLE_WARNING } = await import('../../src/modules/recipes/recipe-import.service.js');

afterEach(() => mocks.crf.mockReset());

function recipe(ingredients: Array<{ name: string; quantity?: number; unit?: string }>) {
  return {
    type: 'recipe' as const,
    data: { title: 'Cake', instructions: ['Bake.'], ingredients: ingredients.map((i) => ({ ...i, confidence: 0.8 })) },
  };
}

describe('addIngredientQuantities', () => {
  it('splits unquantified ingredient lines into quantity and unit with the parser', async () => {
    mocks.crf.mockResolvedValue({
      degraded: false,
      confidence: 0.99,
      ingredients: [{ name: 'baking powder', quantity: 1.5, unit: 'teaspoon' }],
    });
    const content = recipe([{ name: '1½ tsp. baking powder' }]);
    const warnings: string[] = [];

    await addIngredientQuantities(content, warnings);

    expect(mocks.crf).toHaveBeenCalledWith(['1½ tsp. baking powder']);
    expect(content.data.ingredients).toEqual([
      { name: 'baking powder', quantity: 1.5, unit: 'teaspoon', confidence: 0.75 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('keeps the preparation notes the parser separates out ("finely grated")', async () => {
    mocks.crf.mockResolvedValue({
      degraded: false,
      confidence: 0.99,
      ingredients: [{ name: 'zucchini', quantity: 3, unit: 'cup', notes: 'finely grated' }],
    });
    const content = recipe([{ name: '3c. finely grated zucchini' }]);
    await addIngredientQuantities(content, []);
    expect(content.data.ingredients[0]).toMatchObject({ name: 'zucchini', quantity: 3, unit: 'cup', notes: 'finely grated' });
  });

  it('leaves ingredients alone when the provider already gave quantities', async () => {
    const content = recipe([{ name: 'flour', quantity: 2, unit: 'cup' }]);
    await addIngredientQuantities(content, []);
    expect(mocks.crf).not.toHaveBeenCalled();
    expect(content.data.ingredients[0]).toMatchObject({ name: 'flour', quantity: 2, unit: 'cup' });
  });

  it('warns when the parser is unavailable', async () => {
    mocks.crf.mockResolvedValue({ degraded: true, confidence: 0, ingredients: [{ name: '1 egg' }] });
    const warnings: string[] = [];
    await addIngredientQuantities(recipe([{ name: '1 egg' }]), warnings);
    expect(warnings).toEqual([INGREDIENT_PARSER_UNAVAILABLE_WARNING]);
  });

  it('ignores content that is not a recipe', async () => {
    await addIngredientQuantities({ type: 'unknown', data: { rawText: 'x' } }, []);
    expect(mocks.crf).not.toHaveBeenCalled();
  });
});
