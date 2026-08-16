/**
 * Deciding whether a line of a recipe is an ingredient or a step.
 *
 * Deliberately dependency-free: both the image-parse extractor and the text
 * import parser need this, and `image-parse.service.ts` already dynamic-imports
 * `recipe-import.service.js` to avoid a cycle. A leaf module keeps that
 * question from arising at all.
 *
 * It lives in one place because it was independently wrong in two: each parser
 * decided "we are in the ingredients now" on the first quantity-led line and
 * never reconsidered, so a source without printed headings — every handwritten
 * recipe card — came back as ingredients from that point to the end of the
 * recipe, method included.
 *
 * ## Why there is no list of cooking verbs here
 *
 * The obvious approach is to look for words like "bake" or "stir". Both
 * parsers did, and both were wrong in the same way: the list is a guess at
 * English, so it fails silently on whatever it happens to omit. The card that
 * started all this was recognised only because its one method line contained
 * "Add"; had it read "Beat eggs, then fold in the cheese" it would have been
 * filed as an ingredient, because "beat" and "fold" were not on the list.
 * Lengthening it just moves the boundary of the bug.
 *
 * What actually separates the two is structure, and it is reliable:
 *
 *   - An ingredient is a **quantity followed by a noun phrase** — "2 eggs",
 *     "1 c. sour cream". It is short and it does not end in a full stop.
 *   - A step is a **sentence**. It is longer, it is punctuated, and it does
 *     not open with a quantity.
 *
 * So this module only ever asks the positive question — does this line look
 * like an ingredient? — and treats everything else as method. That test rests
 * on numerals and punctuation rather than vocabulary, so it behaves the same
 * for a recipe written in any style, and it cannot be defeated by a verb
 * nobody thought of.
 *
 * (Deciding whether a document is a recipe *at all* is a different question,
 * and keyword evidence is reasonable there — see `type-detector.ts`.)
 */

/**
 * Strip the decoration a line is wearing, for the purpose of judging it.
 *
 * Some readers hand back markdown rather than plain transcription — the
 * vlm-llm sidecar writes "**Ingredients:**" and "- 2 eggs" — and judged
 * literally none of it is recognisable: the heading is not a heading because
 * of the asterisks, and the ingredient is not quantity-led because of the
 * bullet. A whole recipe parsed to nothing at all.
 *
 * Only the judging uses this. What gets stored keeps its own cleaning, so
 * nothing is silently rewritten on the way through.
 */
export function stripDecoration(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')        // markdown heading
    .replace(/^[-*•]\s+/, '')          // list bullet
    .replace(/^\*\*(.*?)\*\*$/, '$1') // **bold**
    .replace(/^__(.*?)__$/, '$1')     // __bold__
    .replace(/\s*:\s*$/, '')          // trailing label colon
    .trim();
}

/** A line that IS a section heading, not a line that happens to say the word. */
export const INGREDIENTS_HEADER = /^\s*ingredients?\b[^A-Za-z]*$/i;
export const INSTRUCTIONS_HEADER = /^\s*(instructions?|directions?|method|steps?)\b[^A-Za-z]*$/i;

/** "1." or "2)" — a step number, which is not a quantity. */
const NUMBERED_STEP = /^\s*\d+[.)]\s/;

/** "2 eggs", "½ tsp salt", "1-1/2 c (6oz) Mild Cheddar". */
const QUANTITY_LED = /^\s*[\d½¼¾⅓⅔⅛⅜⅝⅞]/;

/** A bulleted line carrying a unit — a list item in an ingredient block. */
const BULLETED = /^[-*•]\s*/;
const UNIT =
  /\b(cup|tbsp|tsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|ounce|pound|gram|kilogram)\b/i;

/** Longest a line can be and still read as a bare ingredient rather than prose. */
const MAX_BARE_INGREDIENT_WORDS = 5;

/**
 * A sentence boundary inside a run of prose.
 *
 * Line breaks can't be relied on to separate steps. A vision model
 * transcribing a recipe card preserves the card's line structure sometimes and
 * runs the whole method together on one line at other times, from the same
 * photo — so a method arrived as a single 266-character line and became a
 * single step.
 *
 * The three characters before the terminator must all be alphanumeric. That is
 * the same rule used for joining wrapped lines, and it is what separates the
 * end of a sentence from an abbreviation: "combined." qualifies, while "2 qt."
 * and "Add 1 c." do not, because the three-character window falls across the
 * space. Recipes are dense with abbreviations and they sit exactly where a
 * measurement ends, which is often the end of a line.
 *
 * Requiring the next character to be a capital or a digit keeps decimals and
 * mid-sentence initials from splitting.
 */
const SENTENCE_BOUNDARY = /(?<=[A-Za-z0-9]{3}[.!?]["')\]]?)\s+(?=[A-Z0-9])/;

/**
 * Break a run of method prose into steps.
 *
 * Only for prose the author didn't already divide up: a recipe that numbers its
 * own steps has said what it means, and "1." may well cover several sentences.
 * Explicit structure wins over inference, the same way a heading does.
 */
export function splitIntoSteps(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface LineContext {
  /** Inside an explicit "Ingredients" heading. */
  inIngredientsSection: boolean;
  /** Inside an explicit "Instructions"/"Method"/… heading. */
  inInstructionsSection: boolean;
  /** Whether any ingredient has been collected yet. */
  seenIngredient: boolean;
}

/**
 * Does this line have the shape of an ingredient?
 *
 * The only question this module asks about content, and it is asked of numerals
 * and punctuation, never of vocabulary.
 */
export function isIngredientShaped(line: string, seenIngredient = false): boolean {
  // "1. Preheat the oven" opens with a digit but is a step, not two ovens.
  if (NUMBERED_STEP.test(line)) return false;

  // "- 2 eggs" is quantity-led once the bullet is out of the way.
  const bare = stripDecoration(line);
  if (QUANTITY_LED.test(line) || QUANTITY_LED.test(bare)) return true;
  if (BULLETED.test(line) && UNIT.test(line)) return true;

  // Bare tails once the quantities have started — "salt", "pepper",
  // "Salt and pepper to taste". Short, and not a sentence.
  if (seenIngredient) {
    const words = bare.split(/\s+/).length;
    if (words <= MAX_BARE_INGREDIENT_WORDS && !/[.!?]$/.test(bare)) return true;
  }

  return false;
}

/**
 * Classify one line.
 *
 * Order matters. Ingredient shape is checked first, so "1 c. sour cream" is
 * never reconsidered as prose, while "Beat eggs in medium bowl." — which has no
 * quantity and ends in a full stop — falls through to method.
 */
export function classifyRecipeLine(line: string, ctx: LineContext): 'ingredient' | 'instruction' {
  // An explicit heading is a promise about everything under it, including
  // lines that look like nothing in particular.
  if (ctx.inIngredientsSection) return 'ingredient';
  if (ctx.inInstructionsSection) return 'instruction';

  return isIngredientShaped(line, ctx.seenIngredient) ? 'ingredient' : 'instruction';
}
