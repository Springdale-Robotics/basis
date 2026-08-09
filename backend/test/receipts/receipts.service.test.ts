import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/config/database.js';
import {
  households,
  users,
  inventoryItems,
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
const { processReceiptScan, getScan } = await import(
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

  it('scopes the fetch by household', async () => {
    const scanId = await makeScan();
    expect(await getScan(scanId, randomUUID())).toBeNull();
  });
});
