import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { receiptLineLinks, ingredientAliases, inventoryItems } from '../../db/schema/index.js';
import {
  matchSingleIngredient,
  type MatchSuggestion,
} from '../recipes/ingredient-matching.service.js';
import { normalizeReceiptLine } from './receipt-line-normalizer.js';

/**
 * Resolution order for a single receipt line:
 *
 *   1. learned link on (merchant, line_key)  -> auto-resolved
 *   2. ingredient alias on normalized text   -> suggestion only
 *   3. fuzzy match against the catalog       -> suggestions only
 *
 * Only tier 1 auto-resolves, because only a link carries the conversion
 * factor. Everything else needs the user, which is what makes the blocking
 * confirm rule survivable: the cost is paid once per product.
 */

/**
 * A text-keyed link rides on OCR-read characters, so a bad read could point at
 * the wrong item. Code-keyed links are exact identifiers and are trusted
 * regardless.
 */
export const TEXT_LINK_MIN_OCR_CONFIDENCE = 0.75;

export interface ReceiptLineMatchInput {
  rawText: string;
  merchantCode: string | null;
  merchant: string;
  ocrConfidence: number | null;
}

export interface ReceiptLineMatchResult {
  resolution: 'unresolved' | 'link';
  itemId: string | null;
  unitsPerCount: string | null;
  linkSource: 'code' | 'text' | null;
  suggestions: MatchSuggestion[];
}

/** Casing and padding must never fork a link key. */
export function normalizeMerchant(merchant: string): string {
  return merchant.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildLineKey(
  merchantCode: string | null,
  rawText: string
): { lineKey: string; keyKind: 'code' | 'text' } {
  if (merchantCode && merchantCode.trim().length > 0) {
    return { lineKey: merchantCode.trim(), keyKind: 'code' };
  }
  return { lineKey: normalizeReceiptLine(rawText), keyKind: 'text' };
}

/**
 * Drizzle hands decimals back as strings. Multiply at the column's scale (3)
 * rather than letting floats decide.
 */
export function multiplyQuantity(count: string, unitsPerCount: string): string {
  const product = Number(count) * Number(unitsPerCount);
  if (!Number.isFinite(product)) {
    throw new Error(`Invalid quantity math: ${count} * ${unitsPerCount}`);
  }
  return product.toFixed(3);
}

async function findLink(householdId: string, merchant: string, lineKey: string) {
  return db.query.receiptLineLinks.findFirst({
    where: and(
      eq(receiptLineLinks.householdId, householdId),
      eq(receiptLineLinks.merchant, merchant),
      eq(receiptLineLinks.lineKey, lineKey)
    ),
  });
}

async function findAliasSuggestion(
  householdId: string,
  normalizedText: string
): Promise<MatchSuggestion | null> {
  const alias = await db.query.ingredientAliases.findFirst({
    where: and(
      eq(ingredientAliases.householdId, householdId),
      eq(ingredientAliases.aliasName, normalizedText)
    ),
  });
  if (!alias) return null;

  const item = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.id, alias.canonicalItemId),
      eq(inventoryItems.householdId, householdId)
    ),
  });
  if (!item) return null;

  return {
    itemId: item.id,
    name: item.name,
    confidence: 0.92,
    matchReason: 'synonym',
  };
}

export async function matchReceiptLine(
  input: ReceiptLineMatchInput,
  householdId: string
): Promise<ReceiptLineMatchResult> {
  const merchant = normalizeMerchant(input.merchant);
  const { lineKey, keyKind } = buildLineKey(input.merchantCode, input.rawText);
  const normalizedText = normalizeReceiptLine(input.rawText);

  // Tier 1 — learned link.
  const link = await findLink(householdId, merchant, lineKey);
  if (link) {
    const trusted =
      keyKind === 'code' ||
      (input.ocrConfidence ?? 1) >= TEXT_LINK_MIN_OCR_CONFIDENCE;

    // Verify the link's item still belongs to this household — fail closed
    // rather than trust a stale or cross-tenant foreign key.
    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, link.itemId),
        eq(inventoryItems.householdId, householdId)
      ),
    });

    if (item) {
      const linkSuggestion: MatchSuggestion = {
        itemId: item.id,
        name: item.name,
        confidence: 1,
        matchReason: 'exact',
      };

      if (trusted) {
        return {
          resolution: 'link',
          itemId: link.itemId,
          unitsPerCount: link.unitsPerCount,
          linkSource: keyKind,
          suggestions: [linkSuggestion],
        };
      }

      // Low-confidence text link: offer it, make the user say yes.
      return {
        resolution: 'unresolved',
        itemId: null,
        unitsPerCount: null,
        linkSource: null,
        suggestions: [linkSuggestion],
      };
    }
  }

  // Tier 2 — alias.
  const suggestions: MatchSuggestion[] = [];
  const aliasSuggestion = await findAliasSuggestion(householdId, normalizedText);
  if (aliasSuggestion) suggestions.push(aliasSuggestion);

  // Tier 3 — fuzzy.
  const fuzzy = await matchSingleIngredient(normalizedText, householdId);
  for (const candidate of fuzzy) {
    if (suggestions.some((s) => s.itemId === candidate.itemId)) continue;
    suggestions.push(candidate);
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);

  return {
    resolution: 'unresolved',
    itemId: null,
    unitsPerCount: null,
    linkSource: null,
    suggestions: suggestions.slice(0, 5),
  };
}
