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

  // No structured data — use raw text, but ensure section headers exist
  if (rawText) {
    const hasIngredients = /^ingredients?$/im.test(rawText);
    const hasInstructions = /^(instructions?|directions?|method|steps?)$/im.test(rawText);

    // If headers are already present, return as-is
    if (hasIngredients && hasInstructions) {
      return rawText;
    }

    // Add missing headers as guidance
    const lines = [rawText, ''];
    if (!hasIngredients) lines.push('Ingredients', '(move ingredient lines here)', '');
    if (!hasInstructions) lines.push('Instructions', '(move instruction lines here)', '');
    return lines.join('\n');
  }

  // Nothing at all
  return 'Ingredients\n\n\nInstructions\n\n';
}

/**
 * Simple ingredient name normalization for deduplication on the frontend.
 * Mirrors the backend's normalizeIngredientName() logic.
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
  confidence?: number;
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
      const key = normalizeIngredientName(match.parsedName);
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
