import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  receiptLineLinks,
  ingredientAliases,
  inventoryItems,
  type InventoryItem,
} from '../../db/schema/index.js';
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

/** Both operands and the result live at decimal(10,3). */
const SCALE = 3;

/** "2.775" -> 2775n, "3" -> 3000n. Throws on anything that isn't a decimal. */
function toScaledInt(value: string): bigint {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d*))?$/);
  if (!match) throw new Error(`Not a decimal value: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  const padded = (fraction + '0'.repeat(SCALE)).slice(0, SCALE);
  return BigInt(`${sign}${whole}${padded}`);
}

/**
 * Drizzle hands decimals back as strings. Multiply as scaled integers — going
 * through Number() loses the column's own precision: 2.775 * 2023.420 lands on
 * 5614.990 in IEEE-754 where the exact product is 5614.991. This result becomes
 * a stock quantity, so that drift is wrong inventory.
 */
export function multiplyQuantity(count: string, unitsPerCount: string): string {
  // Two scaled operands carry 2*SCALE decimal places; divide one scale back out,
  // rounding half away from zero to match Postgres numeric rounding.
  const raw = toScaledInt(count) * toScaledInt(unitsPerCount);
  const divisor = 10n ** BigInt(SCALE);
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  const rounded = (magnitude + divisor / 2n) / divisor;
  const scaled = negative ? -rounded : rounded;

  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE);
  return `${scaled < 0n ? '-' : ''}${whole}.${fraction}`;
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
  householdId: string,
  /**
   * Pre-fetched household catalog, forwarded to the tier-3 fuzzy match.
   * Optional and additive: omitting it re-queries the catalog per call, same
   * as before. `getScan` fetches it once per read and passes it through here
   * for every line rather than paying a full catalog scan per line.
   */
  catalog?: InventoryItem[]
): Promise<ReceiptLineMatchResult> {
  const merchant = normalizeMerchant(input.merchant);
  const { lineKey, keyKind } = buildLineKey(input.merchantCode, input.rawText);
  const normalizedText = normalizeReceiptLine(input.rawText);

  // Set when a link exists but is not trustworthy enough to auto-apply. It
  // still leads the suggestion list — it is probably right — but the user
  // needs the alternatives beside it to judge, so we fall through to tiers 2
  // and 3 rather than returning it alone.
  let untrustedLinkSuggestion: MatchSuggestion | null = null;

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

      // Low-confidence text link: remember it, then fall through so the user
      // sees it alongside the alias and fuzzy candidates. Returning it alone
      // would leave them one option — the one we just declined to trust.
      untrustedLinkSuggestion = linkSuggestion;
    }
  }

  // Tier 2 — alias.
  const suggestions: MatchSuggestion[] = [];
  if (untrustedLinkSuggestion) suggestions.push(untrustedLinkSuggestion);

  const aliasSuggestion = await findAliasSuggestion(householdId, normalizedText);
  if (aliasSuggestion && !suggestions.some((s) => s.itemId === aliasSuggestion.itemId)) {
    suggestions.push(aliasSuggestion);
  }

  // Tier 3 — fuzzy.
  const fuzzy = await matchSingleIngredient(normalizedText, householdId, undefined, catalog);
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
