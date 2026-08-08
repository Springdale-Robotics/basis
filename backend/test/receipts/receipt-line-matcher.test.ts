import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  households,
  inventoryItems,
  ingredientAliases,
  receiptLineLinks,
} from '../../src/db/schema/index.js';
import {
  matchReceiptLine,
  buildLineKey,
  normalizeMerchant,
  multiplyQuantity,
} from '../../src/modules/receipts/receipt-line-matcher.js';

let householdId: string;
let oliveOilId: string;
let spinachId: string;

beforeAll(async () => {
  householdId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `Matcher ${householdId.slice(0, 8)}` });

  const [oil] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  oliveOilId = oil.id;

  const [spin] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Spinach', defaultUnit: 'g' })
    .returning({ id: inventoryItems.id });
  spinachId = spin.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('buildLineKey', () => {
  it('prefers the merchant code when present', () => {
    expect(buildLineKey('1234567', 'KS ORG EVOO')).toEqual({
      lineKey: '1234567',
      keyKind: 'code',
    });
  });

  it('falls back to normalized text', () => {
    const { lineKey, keyKind } = buildLineKey(null, 'ORG SPNCH');
    expect(keyKind).toBe('text');
    expect(lineKey).toBe('spinach');
  });
});

describe('normalizeMerchant', () => {
  it('lowercases and trims so casing never forks a key', () => {
    expect(normalizeMerchant('  COSTCO  ')).toBe('costco');
    expect(normalizeMerchant('Costco Wholesale')).toBe('costco wholesale');
  });
});

describe('multiplyQuantity', () => {
  it('multiplies decimal strings without float drift', () => {
    expect(multiplyQuantity('3', '2')).toBe('6.000');
    expect(multiplyQuantity('2', '0.5')).toBe('1.000');
    expect(multiplyQuantity('1.5', '3')).toBe('4.500');
  });
});

describe('matchReceiptLine', () => {
  it('auto-resolves from a learned code link', async () => {
    await db.insert(receiptLineLinks).values({
      householdId,
      merchant: 'costco',
      lineKey: '1234567',
      keyKind: 'code',
      itemId: oliveOilId,
      unitsPerCount: '2000',
    });

    const result = await matchReceiptLine(
      { rawText: 'KS ORG EVOO', merchantCode: '1234567', merchant: 'costco', ocrConfidence: 0.4 },
      householdId
    );

    expect(result.resolution).toBe('link');
    expect(result.itemId).toBe(oliveOilId);
    expect(result.unitsPerCount).toBe('2000.000');
    expect(result.linkSource).toBe('code');
  });

  it('does not auto-resolve a text link when OCR confidence is low', async () => {
    await db.insert(receiptLineLinks).values({
      householdId,
      merchant: 'safeway',
      lineKey: 'spinach',
      keyKind: 'text',
      itemId: spinachId,
      unitsPerCount: '150',
    });

    const result = await matchReceiptLine(
      { rawText: 'ORG SPNCH', merchantCode: null, merchant: 'safeway', ocrConfidence: 0.3 },
      householdId
    );

    // The link is offered as the top suggestion but the user must confirm it:
    // a misread description must not silently ride a link into stock.
    expect(result.resolution).toBe('unresolved');
    expect(result.suggestions[0]?.itemId).toBe(spinachId);
  });

  it('auto-resolves a text link when OCR confidence is high', async () => {
    const result = await matchReceiptLine(
      { rawText: 'ORG SPNCH', merchantCode: null, merchant: 'safeway', ocrConfidence: 0.95 },
      householdId
    );

    expect(result.resolution).toBe('link');
    expect(result.itemId).toBe(spinachId);
    expect(result.linkSource).toBe('text');
  });

  it('scopes links by merchant', async () => {
    const result = await matchReceiptLine(
      { rawText: 'KS ORG EVOO', merchantCode: '1234567', merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.itemId).toBeNull();
  });

  it('offers an alias hit as a suggestion but never auto-resolves it', async () => {
    await db.insert(ingredientAliases).values({
      householdId,
      canonicalItemId: oliveOilId,
      aliasName: 'cooking oil',
      aliasType: 'variant',
    });

    const result = await matchReceiptLine(
      { rawText: 'COOKING OIL', merchantCode: null, merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    // No conversion factor is stored on an alias, so the user still has to
    // supply one.
    expect(result.resolution).toBe('unresolved');
    expect(result.unitsPerCount).toBeNull();
    expect(result.suggestions.some((s) => s.itemId === oliveOilId)).toBe(true);
  });

  it('falls through to fuzzy suggestions', async () => {
    const result = await matchReceiptLine(
      { rawText: 'SPINACH', merchantCode: null, merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.suggestions[0]?.itemId).toBe(spinachId);
  });

  it('returns an empty suggestion list when nothing is close', async () => {
    const result = await matchReceiptLine(
      { rawText: 'ZZQX WIDGET', merchantCode: null, merchant: 'target', ocrConfidence: 0.9 },
      householdId
    );

    expect(result.resolution).toBe('unresolved');
    expect(result.suggestions).toHaveLength(0);
  });
});
