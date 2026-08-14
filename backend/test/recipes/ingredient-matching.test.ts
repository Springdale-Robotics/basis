import { describe, it, expect } from 'vitest';
import {
  normalizeIngredientName,
  normalizeIngredientIdentity,
  preservationStateOf,
  calculateSimilarityWithReason,
  AUTO_MATCH_THRESHOLD,
  SUGGESTION_THRESHOLD,
  INGREDIENT_SYNONYMS,
  IDENTITY_DESCRIPTORS,
  PREPARATION_DESCRIPTORS,
} from '../../src/modules/recipes/ingredient-matching.service.js';

/**
 * Two normalizers, two jobs:
 *
 * - `normalizeIngredientName` is the LOOSE one. It is the storage key for
 *   ingredient aliases and (via normalizeReceiptLine) for receipt line links,
 *   and both the recipes and receipts modules read the alias table with it.
 *   Its exact output is therefore a persisted format — changing it orphans
 *   every learned link in every household. These tests pin it in place.
 *
 * - `normalizeIngredientIdentity` is the MATCHING one. It keeps the words that
 *   distinguish one pantry item from another (dried vs canned vs fresh) and
 *   strips only preparation noise. It is free to evolve.
 */

describe('normalizeIngredientName (loose — persisted key format)', () => {
  it('stays byte-stable for the shapes receipts and aliases already store', () => {
    // Regression pins. If one of these changes, existing learned links break.
    expect(normalizeIngredientName('Tomatoes')).toBe('tomato');
    expect(normalizeIngredientName('Onions')).toBe('onion');
    expect(normalizeIngredientName('canned chickpeas')).toBe('chickpeas');
    // Warts included. These two look like bugs and are: the first keeps the
    // comma left behind by descriptor removal, and the second fails to
    // singularize because stripping the parenthetical leaves a trailing space
    // that defeats the `es$` rule. They are keys, not labels, and both sides
    // of every comparison run through the same function — so the warts are
    // stable, and "fixing" them would orphan the links already stored under
    // them. Correct behaviour lives in normalizeIngredientIdentity instead.
    expect(normalizeIngredientName('boneless, skinless chicken breasts')).toBe(
      ', chicken breast'
    );
    expect(normalizeIngredientName('tomatoes (diced)')).toBe('tomatoes');
    // Known-imperfect stemming, deliberately preserved: it is a *key*, and both
    // sides of every comparison run through it, so consistency beats accuracy.
    expect(normalizeIngredientName('olives')).toBe('olif');
  });
});

describe('normalizeIngredientIdentity (matching)', () => {
  it('strips preparation noise', () => {
    expect(normalizeIngredientIdentity('finely chopped parsley')).toBe('parsley');
    expect(normalizeIngredientIdentity('2 large eggs, beaten')).toBe('2 egg');
    expect(normalizeIngredientIdentity('boneless, skinless chicken breasts')).toBe(
      'chicken breast'
    );
    expect(normalizeIngredientIdentity('shredded mozzarella')).toBe('mozzarella');
    expect(normalizeIngredientIdentity('tomatoes (diced)')).toBe('tomato');
  });

  it('keeps the words that make an item a different item', () => {
    expect(normalizeIngredientIdentity('dried chickpeas')).toBe('dried chickpea');
    expect(normalizeIngredientIdentity('canned chickpeas')).toBe('canned chickpea');
    expect(normalizeIngredientIdentity('fresh oregano')).toBe('fresh oregano');
    expect(normalizeIngredientIdentity('ground beef')).toBe('ground beef');
    expect(normalizeIngredientIdentity('whole milk')).toBe('whole milk');
    expect(normalizeIngredientIdentity('smoked paprika')).toBe('smoked paprika');
    expect(normalizeIngredientIdentity('unsalted butter')).toBe('unsalted butter');
  });

  it('does not corrupt -ves plurals', () => {
    // The loose normalizer turns these into "olif" / "clof" / "knif".
    expect(normalizeIngredientIdentity('olives')).toBe('olive');
    expect(normalizeIngredientIdentity('cloves')).toBe('clove');
    expect(normalizeIngredientIdentity('garlic cloves')).toBe('garlic clove');
    expect(normalizeIngredientIdentity('knives')).toBe('knife');
    // …while still handling the ones the rule was written for.
    expect(normalizeIngredientIdentity('leaves')).toBe('leaf');
    expect(normalizeIngredientIdentity('halves')).toBe('half');
    expect(normalizeIngredientIdentity('loaves')).toBe('loaf');
  });

  it('handles the ordinary plural cases', () => {
    expect(normalizeIngredientIdentity('tomatoes')).toBe('tomato');
    expect(normalizeIngredientIdentity('onions')).toBe('onion');
    expect(normalizeIngredientIdentity('berries')).toBe('berry');
    expect(normalizeIngredientIdentity('capers')).toBe('caper');
  });
});

describe('descriptor classification', () => {
  it('never treats a word as both preparation noise and an identity marker', () => {
    // A word in both sets would be stripped or kept depending on which check
    // ran first — the kind of ambiguity that made "canned chickpeas" collapse
    // into "chickpeas" in the first place.
    const both = [...IDENTITY_DESCRIPTORS].filter((word) => PREPARATION_DESCRIPTORS.has(word));
    expect(both).toEqual([]);
  });

  it('keeps every identity descriptor through normalization', () => {
    for (const word of IDENTITY_DESCRIPTORS) {
      expect(normalizeIngredientIdentity(`${word} beans`)).toBe(`${word} bean`);
    }
  });
});

describe('preservationStateOf', () => {
  it('reads an explicit state word out of the name', () => {
    expect(preservationStateOf('dried chickpeas')).toBe('dried');
    expect(preservationStateOf('canned tomatoes')).toBe('canned');
    expect(preservationStateOf('fresh basil')).toBe('fresh');
    expect(preservationStateOf('frozen peas')).toBe('frozen');
    expect(preservationStateOf('cooked rice')).toBe('cooked');
  });

  it('reads a container unit as canned', () => {
    expect(preservationStateOf('crushed tomatoes', 'can')).toBe('canned');
    expect(preservationStateOf('coconut milk', 'tin')).toBe('canned');
  });

  it('returns null when nothing in the name says', () => {
    expect(preservationStateOf('chickpeas')).toBeNull();
    expect(preservationStateOf('olive oil', 'cup')).toBeNull();
  });
});

describe('calculateSimilarityWithReason', () => {
  const score = (a: string, b: string) => calculateSimilarityWithReason(a, b).score;

  it('does not auto-link items that differ only by preservation state', () => {
    // These all scored a perfect 1.0 "exact" before, because the loose
    // normalizer deleted the only word that distinguished them.
    expect(score('canned chickpeas', 'dried chickpeas')).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(score('dried oregano', 'fresh oregano')).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(score('cooked rice', 'rice')).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(score('frozen peas', 'fresh peas')).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it('still offers them as suggestions rather than hiding them', () => {
    expect(score('canned chickpeas', 'dried chickpeas')).toBeGreaterThanOrEqual(
      SUGGESTION_THRESHOLD
    );
    expect(score('dried oregano', 'fresh oregano')).toBeGreaterThanOrEqual(
      SUGGESTION_THRESHOLD
    );
  });

  it('keeps auto-linking genuine equivalences', () => {
    expect(score('ground beef', 'minced beef')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(score('whole milk', 'milk')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(score('garlic cloves', 'garlic')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(score('heavy cream', 'double cream')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(score('kosher salt', 'salt')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(score('extra virgin olive oil', 'olive oil')).toBeGreaterThanOrEqual(
      AUTO_MATCH_THRESHOLD
    );
    expect(score('boneless, skinless chicken breasts', 'chicken breast')).toBeGreaterThanOrEqual(
      AUTO_MATCH_THRESHOLD
    );
  });

  it('matches -ves plurals against their singular', () => {
    // "olives" normalized to "olif" before, so it never found "olive".
    expect(score('olives', 'olive')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
    expect(score('capers', 'caper')).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD);
  });

  it('keeps genuinely different things apart', () => {
    expect(score('chicken breast', 'chicken thigh')).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(score('baking soda', 'baking powder')).toBeLessThan(AUTO_MATCH_THRESHOLD);
    expect(score('olives', 'olive oil')).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });
});

describe('INGREDIENT_SYNONYMS', () => {
  it('has no entry that identity normalization makes unreachable', () => {
    // Lookups happen on normalized names, so a key that normalization rewrites
    // can never be found. 13 of 99 entries were dead this way.
    const unreachable = Object.keys(INGREDIENT_SYNONYMS).filter(
      (key) => normalizeIngredientIdentity(key) !== key
    );
    expect(unreachable).toEqual([]);
  });

  it('has no value that identity normalization makes unmatchable', () => {
    const unreachable = Object.values(INGREDIENT_SYNONYMS)
      .flat()
      .filter((value) => normalizeIngredientIdentity(value) !== value);
    expect(unreachable).toEqual([]);
  });

  it('is symmetric where it claims equivalence', () => {
    // A one-way synonym silently depends on argument order at the call site.
    const asymmetric: string[] = [];
    for (const [key, values] of Object.entries(INGREDIENT_SYNONYMS)) {
      for (const value of values) {
        const back = INGREDIENT_SYNONYMS[value];
        if (back && !back.includes(key)) asymmetric.push(`${key} -> ${value}`);
      }
    }
    expect(asymmetric).toEqual([]);
  });
});
