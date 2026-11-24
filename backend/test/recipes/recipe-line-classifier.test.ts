import { describe, expect, it } from 'vitest';
import { splitIntoSteps } from '../../src/modules/recipes/recipe-line-classifier.js';

describe('splitIntoSteps', () => {
  it('splits at sentence ends', () => {
    expect(splitIntoSteps('Melt the chocolate. Let cool. Add the eggs.')).toEqual([
      'Melt the chocolate.',
      'Let cool.',
      'Add the eggs.',
    ]);
  });

  it('does not split after a measurement abbreviation', () => {
    expect(splitIntoSteps('Add 1 c. Sugar goes in last.')).toEqual(['Add 1 c. Sugar goes in last.']);
    expect(splitIntoSteps('Pour in 2 qt. Stir well.')).toEqual(['Pour in 2 qt. Stir well.']);
  });

  it('splits after a temperature that ends a sentence', () => {
    expect(splitIntoSteps('Preheat oven to 350°. Grease the pan.')).toEqual([
      'Preheat oven to 350°.',
      'Grease the pan.',
    ]);
    expect(splitIntoSteps('Heat to 180°C. Add the oil.')).toEqual(['Heat to 180°C.', 'Add the oil.']);
  });
});
