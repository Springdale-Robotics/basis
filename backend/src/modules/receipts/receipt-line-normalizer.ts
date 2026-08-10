import { normalizeIngredientName } from '../recipes/ingredient-matching.service.js';

/**
 * Receipt descriptions are abbreviated past the point where the ingredient
 * matcher can score them ("KS ORG EVOO" vs "olive oil"). This module cleans a
 * raw line into something matchable, and is also what produces the text form
 * of a learned link's key — so it must be deterministic.
 */

/** Item codes are long numeric runs. Five digits avoids eating "2%" or "5OZ". */
const ITEM_CODE_PATTERN = /^(\d{5,})\s+/;

/** Costco prints a single-letter tax flag at the end of most lines. */
const TAX_FLAG_PATTERN = /\s+[AEFNTX]$/;

const ABBREVIATIONS: Record<string, string> = {
  ks: 'kirkland signature',
  kb: 'kirkland signature',
  org: 'organic',
  orgnc: 'organic',
  evoo: 'extra virgin olive oil',
  chkn: 'chicken',
  chk: 'chicken',
  brst: 'breast',
  bnls: 'boneless',
  sknls: 'skinless',
  grnd: 'ground',
  bf: 'beef',
  prk: 'pork',
  spnch: 'spinach',
  bntr: 'butter',
  chdr: 'cheddar',
  chz: 'cheese',
  mzrlla: 'mozzarella',
  yog: 'yogurt',
  ygrt: 'yogurt',
  crm: 'cream',
  mlk: 'milk',
  whl: 'whole',
  wht: 'wheat',
  brd: 'bread',
  tort: 'tortilla',
  ttla: 'tortilla',
  avo: 'avocado',
  tom: 'tomato',
  ptto: 'potato',
  onn: 'onion',
  gar: 'garlic',
  straw: 'strawberry',
  blubry: 'blueberry',
  rasp: 'raspberry',
  jc: 'juice',
  wtr: 'water',
  spklg: 'sparkling',
  frz: 'frozen',
  fzn: 'frozen',
  ppr: 'pepper',
  ssg: 'sausage',
  bcn: 'bacon',
  slmn: 'salmon',
  shrmp: 'shrimp',
  rce: 'rice',
  pnut: 'peanut',
  btr: 'butter',
  choc: 'chocolate',
  vnla: 'vanilla',
  swt: 'sweet',
  lg: 'large',
  sm: 'small',
  md: 'medium',
  pk: 'pack',
  ct: 'count',
  ea: 'each',
};

/**
 * Split a raw receipt line into its item code (when present) and description,
 * with tax flags and stray whitespace removed.
 */
export function stripLineNoise(rawText: string): { text: string; code: string | null } {
  let text = rawText.trim().replace(/\s+/g, ' ');

  let code: string | null = null;
  const codeMatch = text.match(ITEM_CODE_PATTERN);
  if (codeMatch) {
    code = codeMatch[1];
    text = text.slice(codeMatch[0].length);
  }

  text = text.replace(TAX_FLAG_PATTERN, '').trim();

  return { text, code };
}

/**
 * Expand known receipt shorthand to full words. Whole-token matches only —
 * substring replacement would turn "ORGY" into "organicY".
 */
export function expandAbbreviations(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((token) => {
      // Keep trailing punctuation out of the lookup ("evoo," -> "evoo").
      const bare = token.replace(/[^a-z0-9%]/g, '');
      const expanded = ABBREVIATIONS[bare];
      return expanded ?? token;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Full pipeline: strip noise, expand shorthand, then hand off to the shared
 * ingredient normalizer so receipt text and item names are compared on the
 * same footing.
 *
 * Falls back to the pre-normalizer text when normalization empties the string
 * (a line of pure descriptors like "LG ORG" would otherwise vanish), so a
 * link's text key is never blank.
 */
export function normalizeReceiptLine(rawText: string): string {
  const { text } = stripLineNoise(rawText);
  const expanded = expandAbbreviations(text);
  const normalized = normalizeIngredientName(expanded);
  return normalized.length > 0 ? normalized : expanded || text.toLowerCase();
}
