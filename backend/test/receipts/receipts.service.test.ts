import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  households,
  users,
  inventoryItems,
  inventoryAreas,
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
} from '../../src/db/schema/index.js';

vi.mock('../../src/modules/receipts/receipt-ocr.js', () => ({
  transcribeReceipt: vi.fn(),
  isOcrAvailable: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/modules/receipts/receipt-structurer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/receipts/receipt-structurer.js')>();
  return { ...actual, structureReceipt: vi.fn(), isStructurerAvailable: vi.fn().mockResolvedValue(true) };
});

const { transcribeReceipt } = await import('../../src/modules/receipts/receipt-ocr.js');
const { structureReceipt } = await import('../../src/modules/receipts/receipt-structurer.js');
const { processReceiptScan, getScan, confirmScan } = await import(
  '../../src/modules/receipts/receipts.service.js'
);

let householdId: string;
let userId: string;
let oliveOilId: string;

async function makeScan(): Promise<string> {
  const [scan] = await db
    .insert(receiptScans)
    .values({
      householdId,
      scannedBy: userId,
      imagePath: '/tmp/does-not-matter.jpg',
      imageMimeType: 'image/jpeg',
      status: 'processing',
    })
    .returning({ id: receiptScans.id });
  return scan.id;
}

beforeAll(async () => {
  householdId = randomUUID();
  userId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `Svc ${householdId.slice(0, 8)}` });
  await db.insert(users).values({
    id: userId,
    householdId,
    email: `${userId}@test.local`,
    displayName: 'Scanner',
    passwordHash: 'x',
    role: 'admin',
  });
  const [oil] = await db
    .insert(inventoryItems)
    .values({ householdId, name: 'Olive Oil', defaultUnit: 'ml' })
    .returning({ id: inventoryItems.id });
  oliveOilId = oil.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

beforeEach(() => {
  vi.mocked(transcribeReceipt).mockReset();
  vi.mocked(structureReceipt).mockReset();
});

describe('processReceiptScan', () => {
  it('lands in review with one row per product line', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: '1234567 KS ORG EVOO\n96253 ORG SPNCH\nTOTAL 29.97',
      lines: [
        { text: '1234567 KS ORG EVOO', confidence: 0.9 },
        { text: '96253 ORG SPNCH', confidence: 0.8 },
      ],
      processingTimeMs: 1200,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: '2026-08-01',
      lines: [
        { rawText: '1234567 KS ORG EVOO', code: '1234567', count: 1, price: 21.99, ocrConfidence: null },
        { rawText: '96253 ORG SPNCH', code: '96253', count: 2, price: 7.98, ocrConfidence: null },
      ],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('review');
    expect(scan?.merchant).toBe('Costco');
    expect(scan?.lines).toHaveLength(2);
    expect(scan?.lines[0].count).toBe('1.000');
    expect(scan?.lines[1].count).toBe('2.000');
    expect(scan?.lines.every((l) => l.resolution === 'unresolved')).toBe(true);
  });

  it('auto-resolves a line that has a learned link', async () => {
    await db.insert(receiptLineLinks).values({
      householdId,
      merchant: 'costco',
      lineKey: '1234567',
      keyKind: 'code',
      itemId: oliveOilId,
      unitsPerCount: '2000',
    });

    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: '1234567 KS ORG EVOO',
      lines: [{ text: '1234567 KS ORG EVOO', confidence: 0.9 }],
      processingTimeMs: 900,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: null,
      lines: [
        { rawText: '1234567 KS ORG EVOO', code: '1234567', count: 1, price: 21.99, ocrConfidence: null },
      ],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.lines[0].resolution).toBe('link');
    expect(scan?.lines[0].itemId).toBe(oliveOilId);
    expect(scan?.lines[0].unitsPerCount).toBe('2000.000');
    // A resolved line has no use for suggestions — getScan must not compute
    // them (or spend a catalog scan doing so) for a line the user already
    // decided about.
    expect(scan?.lines[0].suggestions).toEqual([]);
  });

  it('still computes suggestions for a line that stays unresolved', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'OLIVE OIL',
      lines: [{ text: 'OLIVE OIL', confidence: 0.9 }],
      processingTimeMs: 300,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Trader Joes',
      purchasedAt: null,
      lines: [{ rawText: 'OLIVE OIL', code: null, count: 1, price: 8.99, ocrConfidence: null }],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.lines[0].resolution).toBe('unresolved');
    expect(scan?.lines[0].suggestions.length).toBeGreaterThan(0);
    expect(scan?.lines[0].suggestions[0].itemId).toBe(oliveOilId);
  });

  it('fails the scan when the row has no stored image', async () => {
    const [scan] = await db
      .insert(receiptScans)
      .values({
        householdId,
        scannedBy: userId,
        imageMimeType: 'image/jpeg',
        status: 'processing',
      })
      .returning({ id: receiptScans.id });

    await processReceiptScan(scan.id, householdId);

    const result = await getScan(scan.id, householdId);
    expect(result?.status).toBe('failed');
    expect(result?.errorMessage).toMatch(/no stored image/i);
    // Neither OCR nor structuring should ever have been reached.
    expect(transcribeReceipt).not.toHaveBeenCalled();
    expect(structureReceipt).not.toHaveBeenCalled();
  });

  it('fails the scan when OCR reads nothing', async () => {
    vi.mocked(transcribeReceipt).mockRejectedValue(new Error('Tesseract produced no text'));

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('failed');
    expect(scan?.errorMessage).toMatch(/no text/i);
  });

  it('fails the scan when the receipt has no product lines', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'TOTAL 29.97',
      lines: [{ text: 'TOTAL 29.97', confidence: 0.99 }],
      processingTimeMs: 500,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: null,
      lines: [],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('failed');
    expect(scan?.errorMessage).toMatch(/no product lines/i);
  });

  it('replaces prior lines when reprocessed rather than appending', async () => {
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'MILK',
      lines: [{ text: 'MILK', confidence: 0.9 }],
      processingTimeMs: 300,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Safeway',
      purchasedAt: null,
      lines: [{ rawText: 'MILK', code: null, count: 1, price: 3.5, ocrConfidence: null }],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);
    await processReceiptScan(scanId, householdId);

    const rows = await db
      .select()
      .from(receiptScanLines)
      .where(eq(receiptScanLines.scanId, scanId));
    expect(rows).toHaveLength(1);
  });

  it('warns when the same shop on the same day was already confirmed', async () => {
    await db.insert(receiptScans).values({
      householdId,
      scannedBy: userId,
      merchant: 'Costco',
      purchasedAt: new Date('2026-08-01T00:00:00Z'),
      status: 'confirmed',
      confirmedAt: new Date(),
    });

    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'KS ORG EVOO',
      lines: [{ text: 'KS ORG EVOO', confidence: 0.9 }],
      processingTimeMs: 400,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: '2026-08-01',
      lines: [{ rawText: 'KS ORG EVOO', code: null, count: 1, price: 21.99, ocrConfidence: null }],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    // A warning, not a block — the scan is still reviewable.
    expect(scan?.status).toBe('review');
    expect(scan?.parseWarnings.join(' ')).toMatch(/already confirmed/i);
  });

  it('surfaces a nulled-date parse warning without failing the scan', async () => {
    // Simulates what structureReceipt now returns for an LLM date it could
    // not parse (see receipt-structurer.ts's parseStructuredResponse guard):
    // purchasedAt is null, not the raw garbage string.
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: 'MILK',
      lines: [{ text: 'MILK', confidence: 0.9 }],
      processingTimeMs: 300,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: null,
      purchasedAtWarning: 'The purchase date ("not a real date") could not be read. Set it before confirming.',
      lines: [{ rawText: 'MILK', code: null, count: 1, price: 3.5, ocrConfidence: null }],
    });

    const scanId = await makeScan();
    await processReceiptScan(scanId, householdId);

    const scan = await getScan(scanId, householdId);
    expect(scan?.status).toBe('review');
    expect(scan?.lines).toHaveLength(1);
    expect(scan?.purchasedAt).toBeNull();
    expect(scan?.parseWarnings.join(' ')).toMatch(/purchase date/i);
  });

  it('scopes the fetch by household', async () => {
    const scanId = await makeScan();
    expect(await getScan(scanId, randomUUID())).toBeNull();
  });
});

/**
 * The round trip this whole feature depends on: confirmScan's
 * buildLineKey/normalizeMerchant write and matchReceiptLine's
 * buildLineKey/normalizeMerchant read must agree, or a learned link written
 * by one receipt would never be found by the next. Every tier of the matcher
 * is otherwise tested from seeded link fixtures (pre-written, never actually
 * produced by confirmScan), and confirm's write is tested against the
 * database (receipts.confirm.test.ts) — but nothing before this proved the
 * two sides actually meet.
 */
describe('confirm -> match round trip', () => {
  it('a link confirmScan writes is the link the next scan for the same merchant/code auto-resolves to', async () => {
    const [area] = await db
      .insert(inventoryAreas)
      .values({ householdId, name: `Round Trip Pantry ${randomUUID().slice(0, 8)}` })
      .returning({ id: inventoryAreas.id });

    const [item] = await db
      .insert(inventoryItems)
      .values({ householdId, name: 'Round Trip Ketchup', defaultUnit: 'ml' })
      .returning({ id: inventoryItems.id });

    // First scan: already resolved (as if a user had just linked it in the
    // review UI) — its own matching isn't what this test is about. What
    // matters is that confirming it writes a learned link.
    const [firstScan] = await db
      .insert(receiptScans)
      .values({
        householdId,
        scannedBy: userId,
        merchant: 'Costco',
        defaultAreaId: area.id,
        status: 'review',
      })
      .returning({ id: receiptScans.id });

    await db.insert(receiptScanLines).values({
      scanId: firstScan.id,
      householdId,
      lineIndex: 0,
      rawText: '8675309 KS KETCHUP',
      merchantCode: '8675309',
      count: '1.000',
      price: '12.49',
      resolution: 'link',
      itemId: item.id,
      unitsPerCount: '2000.000',
    });

    await confirmScan(firstScan.id, householdId);

    const link = await db.query.receiptLineLinks.findFirst({
      where: eq(receiptLineLinks.lineKey, '8675309'),
    });
    expect(link?.merchant).toBe('costco');
    expect(link?.itemId).toBe(item.id);

    // Second scan, same merchant and same merchant code, run through the
    // real OCR -> structure -> match pipeline (only the OCR/LLM legs are
    // mocked, as elsewhere in this file). If buildLineKey or
    // normalizeMerchant ever forked between the write side (confirmScan)
    // and the read side (matchReceiptLine), this line would come back
    // 'unresolved' instead.
    vi.mocked(transcribeReceipt).mockResolvedValue({
      rawText: '8675309 KS KETCHUP 2CT',
      lines: [{ text: '8675309 KS KETCHUP 2CT', confidence: 0.95 }],
      processingTimeMs: 200,
    });
    vi.mocked(structureReceipt).mockResolvedValue({
      merchant: 'Costco',
      purchasedAt: null,
      lines: [
        { rawText: '8675309 KS KETCHUP 2CT', code: '8675309', count: 1, price: 12.99, ocrConfidence: null },
      ],
    });

    const secondScanId = await makeScan();
    await processReceiptScan(secondScanId, householdId);

    const secondScan = await getScan(secondScanId, householdId);
    expect(secondScan?.lines).toHaveLength(1);
    expect(secondScan?.lines[0].resolution).toBe('link');
    expect(secondScan?.lines[0].itemId).toBe(item.id);
    expect(secondScan?.lines[0].unitsPerCount).toBe('2000.000');
  });
});
