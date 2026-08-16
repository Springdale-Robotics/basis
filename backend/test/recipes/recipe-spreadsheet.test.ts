import { describe, it, expect } from 'vitest';
import {
  rowsToRecipes,
  toCanonicalText,
  readCsv,
  MAX_ROWS,
} from '../../src/modules/recipes/recipe-spreadsheet.js';
import { parseRecipeTextWithConfidence } from '../../src/modules/recipes/recipe-import.service.js';

/**
 * Reading a collection out of a spreadsheet.
 *
 * The shape is ours — a template to fill in — so this refuses anything that
 * doesn't match rather than guessing at what someone's columns mean. What it
 * produces is the canonical text the ordinary text import already reads, so
 * the round-trip tests below are the ones that matter: they check the handover
 * is exact rather than merely plausible.
 */

const HEADER = ['Title', 'Servings', 'Prep', 'Cook', 'Ingredients', 'Instructions'];

const spoonBread = [
  'Spoon Bread',
  '8',
  '10',
  '45',
  '2 eggs\n1 c. sour cream\n6 Tbsp butter, melted',
  'Beat eggs in medium bowl.\nBake 45 min at 350.',
];

describe('rowsToRecipes: reading the template', () => {
  it('reads a row into a recipe', () => {
    const { recipes, skipped } = rowsToRecipes([HEADER, spoonBread]);

    expect(skipped).toEqual([]);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]).toMatchObject({
      title: 'Spoon Bread',
      servings: 8,
      prepMinutes: 10,
      cookMinutes: 45,
      ingredients: ['2 eggs', '1 c. sour cream', '6 Tbsp butter, melted'],
      instructions: ['Beat eggs in medium bowl.', 'Bake 45 min at 350.'],
    });
  });

  it('forgives the case and spacing of the headings but not the words', () => {
    const { recipes } = rowsToRecipes([['  title ', 'INGREDIENTS'], ['Toast', 'bread']]);
    expect(recipes[0].title).toBe('Toast');

    expect(() => rowsToRecipes([['Recipe Name', 'Stuff'], ['Toast', 'bread']])).toThrow(
      /doesn't look like the Basis recipe template/i
    );
  });

  it('names the rows it could not use rather than dropping them quietly', () => {
    const { recipes, skipped } = rowsToRecipes([
      HEADER,
      spoonBread,
      ['', '', '', '', 'flour', ''],
      ['No Ingredients Here', '', '', '', '', 'Stir.'],
    ]);

    expect(recipes).toHaveLength(1);
    expect(skipped).toEqual([
      { rowNumber: 3, reason: 'No title.' },
      { rowNumber: 4, reason: 'No ingredients for "No Ingredients Here".' },
    ]);
  });

  it('ignores blank rows between recipes', () => {
    const { recipes, skipped } = rowsToRecipes([HEADER, spoonBread, ['', '', '', '', '', ''], spoonBread]);
    expect(recipes).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it('says so rather than silently truncating a long file', () => {
    const many = Array.from({ length: MAX_ROWS + 3 }, () => spoonBread);
    const { recipes, skipped } = rowsToRecipes([HEADER, ...many]);

    expect(recipes).toHaveLength(MAX_ROWS);
    expect(skipped).toHaveLength(3);
    expect(skipped[0].reason).toMatch(/first 200 recipes/i);
  });

  it('drops a cell line that would masquerade as a section heading', () => {
    // Otherwise the generated text would tell the parser something the
    // spreadsheet never said.
    const { recipes, warnings } = rowsToRecipes([
      HEADER,
      ['Soup', '', '', '', 'Ingredients\n2 onions\nInstructions', 'Simmer.'],
    ]);

    expect(recipes[0].ingredients).toEqual(['2 onions']);
    expect(warnings[0]).toMatch(/section heading/i);
  });
});

describe('readCsv: the way a spreadsheet actually saves', () => {
  it('keeps a quoted cell that spans several lines', () => {
    // The template's whole shape depends on this — splitting on newlines
    // would tear each recipe apart.
    const csv = 'Title,Ingredients\r\n"Toast","2 slices bread\n1 tbsp butter"\r\n';
    const rows = readCsv(csv);

    expect(rows[1][1]).toBe('2 slices bread\n1 tbsp butter');
  });

  it('survives the byte-order mark Excel writes', () => {
    const csv = '\uFEFFTitle,Ingredients\r\nToast,bread\r\n';
    const { recipes } = rowsToRecipes(readCsv(csv));

    expect(recipes[0].title).toBe('Toast');
  });
});

describe('toCanonicalText: handing over to the text import', () => {
  const { recipes } = rowsToRecipes([HEADER, spoonBread]);
  const text = toCanonicalText(recipes[0]);

  it('states the sections rather than leaving them to be inferred', () => {
    expect(text).toContain('\nIngredients\n');
    expect(text).toContain('\nInstructions\n');
    expect(text).toContain('1. Beat eggs in medium bowl.');
  });

  it('round-trips through the real text parser without losing anything', () => {
    const parsed = parseRecipeTextWithConfidence(text);

    expect(parsed.recipe.title).toBe('Spoon Bread');
    expect(parsed.recipe.servings).toBe(8);
    expect(parsed.recipe.prepTimeMinutes).toBe(10);
    expect(parsed.recipe.cookTimeMinutes).toBe(45);
    expect(parsed.recipe.ingredients.map((i) => i.name)).toEqual([
      '2 eggs',
      '1 c. sour cream',
      '6 Tbsp butter, melted',
    ]);
    expect(parsed.recipe.instructions).toEqual([
      'Beat eggs in medium bowl.',
      'Bake 45 min at 350.',
    ]);
  });

  it('keeps a step the writer put on one line as one step', () => {
    // Numbering is what stops the sentence splitter dividing it further: the
    // person filling the template already said where the steps are.
    const { recipes: rows } = rowsToRecipes([
      HEADER,
      ['Stew', '', '', '', '1 kg beef', 'Brown the beef. Add the stock. Simmer.'],
    ]);
    const parsed = parseRecipeTextWithConfidence(toCanonicalText(rows[0]));

    expect(parsed.recipe.instructions).toEqual(['Brown the beef. Add the stock. Simmer.']);
  });

  it('does not invent an Instructions section for a recipe that has none', () => {
    const { recipes: rows } = rowsToRecipes([HEADER, ['Salad', '', '', '', 'lettuce', '']]);
    const text = toCanonicalText(rows[0]);

    expect(text).not.toContain('Instructions');
    expect(parseRecipeTextWithConfidence(text).recipe.instructions).toEqual([]);
  });
});

describe('the template we actually ship', () => {
  /**
   * Reads the real file from frontend/public, because everything above works
   * on arrays that a test made up. This is the only check that the template
   * people download can be read by the code that reads it — and it caught the
   * workbook reader returning sheets rather than rows.
   */
  const templatePath = new URL(
    '../../../frontend/public/basis-recipes-template.xlsx',
    import.meta.url
  );

  it('reads back into the recipes it demonstrates', async () => {
    const { readSpreadsheet } = await import('../../src/modules/recipes/recipe-spreadsheet.js');
    const { readFile } = await import('node:fs/promises');

    const rows = await readSpreadsheet(await readFile(templatePath), 'template.xlsx');
    const { recipes, skipped } = rowsToRecipes(rows);

    expect(skipped).toEqual([]);
    expect(recipes.map((r) => r.title)).toEqual(['Spoon Bread', 'Pancakes']);

    const spoon = recipes[0];
    expect(spoon.servings).toBe(8);
    expect(spoon.ingredients).toHaveLength(5);
    // The multi-line cell is the part people won't guess, so it is the part
    // most worth proving survives a round trip through a real workbook.
    expect(spoon.ingredients[0]).toBe('2 eggs');
    expect(spoon.instructions).toHaveLength(4);
  });

  it('produces sound recipes through the ordinary text import', async () => {
    const { readSpreadsheet } = await import('../../src/modules/recipes/recipe-spreadsheet.js');
    const { readFile } = await import('node:fs/promises');

    const rows = await readSpreadsheet(await readFile(templatePath), 'template.xlsx');
    for (const recipe of rowsToRecipes(rows).recipes) {
      const parsed = parseRecipeTextWithConfidence(toCanonicalText(recipe));
      expect(parsed.recipe.title).toBe(recipe.title);
      expect(parsed.recipe.ingredients).toHaveLength(recipe.ingredients.length);
      expect(parsed.recipe.instructions).toHaveLength(recipe.instructions.length);
    }
  });

  it('ships a .csv twin that reads the same as the workbook', async () => {
    const { readSpreadsheet } = await import('../../src/modules/recipes/recipe-spreadsheet.js');
    const { readFile } = await import('node:fs/promises');
    const csvPath = new URL('../../../frontend/public/basis-recipes-template.csv', import.meta.url);

    const fromCsv = rowsToRecipes(
      await readSpreadsheet(await readFile(csvPath), 'template.csv')
    ).recipes;
    const fromXlsx = rowsToRecipes(
      await readSpreadsheet(await readFile(templatePath), 'template.xlsx')
    ).recipes;

    // Whichever format someone downloads, they get the same recipes.
    expect(fromCsv.map(toCanonicalText)).toEqual(fromXlsx.map(toCanonicalText));
  });
});
