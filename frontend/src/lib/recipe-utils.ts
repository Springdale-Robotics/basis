import type { ParsedContent, ParsedRecipeContent } from '@/api/image-parse';

/**
 * Format OCR output into editable text with clear section headers.
 * Uses structured data when available to place content under the right headers,
 * so the user can see if anything ended up in the wrong section.
 */
export function formatOcrForEditing(rawText: string | null, parsedContent: ParsedContent | null): string {
  // If we have structured recipe data, rebuild text with explicit headers
  if (parsedContent?.type === 'recipe') {
    const data = parsedContent.data as ParsedRecipeContent;
    const sections: string[] = [];

    // Title
    if (data.title) {
      sections.push(data.title);
      sections.push('');
    }

    // Description
    if (data.description) {
      sections.push(data.description);
      sections.push('');
    }

    // Metadata line
    const meta: string[] = [];
    if (data.prepTimeMinutes) meta.push(`Prep: ${data.prepTimeMinutes} min`);
    if (data.cookTimeMinutes) meta.push(`Cook: ${data.cookTimeMinutes} min`);
    if (data.servings) meta.push(`Servings: ${data.servings}`);
    if (meta.length > 0) {
      sections.push(meta.join(' | '));
      sections.push('');
    }

    // Ingredients
    sections.push('Ingredients');
    if (data.ingredients && data.ingredients.length > 0) {
      for (const ing of data.ingredients) {
        const parts: string[] = [];
        if (ing.quantity != null) parts.push(String(ing.quantity));
        if (ing.unit) parts.push(ing.unit);
        parts.push(ing.name);
        if (ing.notes) parts.push(`(${ing.notes})`);
        sections.push(parts.join(' '));
      }
    }
    sections.push('');

    // Instructions
    sections.push('Instructions');
    if (data.instructions && data.instructions.length > 0) {
      data.instructions.forEach((step, i) => {
        sections.push(`${i + 1}. ${step}`);
      });
    }

    return sections.join('\n');
  }

  // No structured data — show the text as read.
  //
  // This used to append "Ingredients / (move ingredient lines here)" and the
  // same for instructions, meant as guidance. It destroyed the recipe: the
  // parser anchors its ingredients section at the first heading it finds, so
  // the placeholder lines became the entire recipe — one ingredient reading
  // "(move ingredient lines here)" and one step reading "(move instruction
  // lines here)" — and everything actually transcribed was dropped. The
  // multi-photo path hits this every time, since it deliberately passes no
  // structured data (per-page structure would conflict across pages).
  //
  // Appending bare headings instead would be no better: an "Ingredients"
  // heading at the end of the text anchors the section at the end of the
  // text. The backend infers the split from the content, so hand it the
  // content.
  if (rawText) {
    return rawText;
  }

  // Nothing at all
  return 'Ingredients\n\n\nInstructions\n\n';
}

/**
 * Fallback grouping key for ingredient matches that predate the server sending
 * `dedupeKey` (sessions created before that change, which live for a week).
 *
 * This claimed to mirror the backend and didn't — no plural stemming, and it
 * strips everything after a comma — so bulk review listed "onion" and "onions"
 * as two separate things to link, and updating one didn't reach the other.
 * Prefer `match.dedupeKey`; a second implementation of a matching rule only
 * ever drifts again.
 */
export function normalizeIngredientName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s*\(.*?\)\s*/g, '') // strip parentheticals
    .replace(/,.*$/, '')           // strip everything after comma
    .replace(/\b(chopped|diced|minced|sliced|crushed|ground|fresh|dried|frozen|canned|large|small|medium)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface MatchWithConfidence {
  parsedName: string;
  /** Server-computed grouping key; absent on sessions created before it existed. */
  dedupeKey?: string;
  confidence?: number;
}

/** Group two ingredient mentions together iff they mean the same thing. */
export function dedupeKeyFor(match: MatchWithConfidence): string {
  return match.dedupeKey || normalizeIngredientName(match.parsedName);
}

export interface DedupedMatchGroup<M extends MatchWithConfidence> {
  /** Representative match (highest confidence) — render this one in the UI. */
  matches: M[];
  /** All session IDs that contain this ingredient — used to fan updates back out. */
  sessionIds: string[];
  /** How many recipes reference this ingredient. */
  recipeCount: number;
}

/**
 * Dedupe ingredient matches across multiple recipes by `normalizeIngredientName`.
 * The reviewer should only link "olive oil" once even if it appears in 8 recipes;
 * `sessionIds` lets the caller fan a single update back to every recipe that
 * shares the ingredient.
 *
 * Pure function — no state, no React. Easy to test, easy to reuse if another
 * surface ever needs cross-recipe matching.
 */
export function deduplicateIngredientMatches<M extends MatchWithConfidence>(
  perSessionMatches: Iterable<[string, M[]]>,
): Map<string, DedupedMatchGroup<M>> {
  const grouped = new Map<string, DedupedMatchGroup<M>>();
  for (const [sessionId, matches] of perSessionMatches) {
    for (const match of matches) {
      const key = dedupeKeyFor(match);
      const existing = grouped.get(key);
      if (existing) {
        existing.recipeCount++;
        existing.sessionIds.push(sessionId);
        // Keep the highest-confidence match as the representative.
        if ((match.confidence ?? 0) > (existing.matches[0]?.confidence ?? 0)) {
          existing.matches.unshift(match);
        }
      } else {
        grouped.set(key, { matches: [match], sessionIds: [sessionId], recipeCount: 1 });
      }
    }
  }
  return grouped;
}
