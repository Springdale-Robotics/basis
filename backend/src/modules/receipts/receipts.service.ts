import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { queueReceiptParse } from '../../jobs/index.js';
import {
  receiptScans,
  receiptScanLines,
  type ReceiptScan,
  type ReceiptScanLine,
  type ReceiptProcessingStage,
} from '../../db/schema/index.js';
import type { MatchSuggestion } from '../recipes/ingredient-matching.service.js';
import { transcribeReceipt } from './receipt-ocr.js';
import { structureReceipt, attachConfidences } from './receipt-structurer.js';
import { matchReceiptLine } from './receipt-line-matcher.js';

/**
 * Owns the scan lifecycle: upload -> queue -> OCR -> structure -> match ->
 * review. The only two terminal states `processReceiptScan` leaves behind are
 * 'review' and 'failed' — a failed parse becomes a reviewable, retryable
 * record rather than a lost job, so this function must never throw.
 *
 * Task 8 adds `confirmScan` to this same file later.
 */

const UPLOAD_DIR = join(config.STORAGE_PATH, 'receipts');

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export interface ScanLineWithSuggestions extends ReceiptScanLine {
  suggestions: MatchSuggestion[];
}

export interface ScanWithLines extends ReceiptScan {
  lines: ScanLineWithSuggestions[];
}

export function getReceiptImagePath(scanId: string, mimeType: string): string {
  const ext = mimeType.includes('png') ? '.png'
    : mimeType.includes('webp') ? '.webp'
    : mimeType.includes('heic') ? '.heic'
    : mimeType.includes('heif') ? '.heif'
    : '.jpg';
  return join(UPLOAD_DIR, `${scanId}${ext}`);
}

async function setStage(scanId: string, stage: ReceiptProcessingStage): Promise<void> {
  await db
    .update(receiptScans)
    .set({ processingStage: stage, updatedAt: new Date() })
    .where(eq(receiptScans.id, scanId));
}

/**
 * Persist the uploaded image and queue the parse. Returns the scan id
 * immediately — parsing runs on the receipts worker.
 */
export async function createScan(
  householdId: string,
  userId: string,
  imageBuffer: Buffer,
  mimeType: string,
  defaultAreaId?: string
): Promise<string> {
  const maxBytes = config.RECEIPT_MAX_SIZE_MB * 1024 * 1024;
  if (imageBuffer.length > maxBytes) {
    throw Errors.validation(`Image size exceeds maximum of ${config.RECEIPT_MAX_SIZE_MB}MB`);
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw Errors.validation(`Unsupported image type: ${mimeType}`);
  }

  const scanId = randomUUID();
  await mkdir(UPLOAD_DIR, { recursive: true });
  const imagePath = getReceiptImagePath(scanId, mimeType);
  await writeFile(imagePath, imageBuffer);

  await db.insert(receiptScans).values({
    id: scanId,
    householdId,
    scannedBy: userId,
    imagePath,
    imageMimeType: mimeType,
    defaultAreaId,
    status: 'processing',
    processingStage: 'queued',
  });

  await queueReceiptParse({ scanId, householdId });

  logger.info({ scanId, sizeBytes: imageBuffer.length }, 'Receipt scan queued');
  return scanId;
}

async function failScan(scanId: string, message: string): Promise<void> {
  await db
    .update(receiptScans)
    .set({ status: 'failed', errorMessage: message, updatedAt: new Date() })
    .where(eq(receiptScans.id, scanId));
}

/**
 * OCR -> structure -> match. Terminal states are 'review' or 'failed'; this
 * never throws, so a failed parse is a reviewable record rather than a lost
 * job.
 */
export async function processReceiptScan(scanId: string, householdId: string): Promise<void> {
  const startedAt = Date.now();

  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });

  if (!scan || !scan.imagePath) {
    logger.warn({ scanId }, 'Receipt scan missing or has no image; nothing to process');
    return;
  }

  try {
    await setStage(scanId, 'ocr');
    const transcription = await transcribeReceipt(scan.imagePath);

    await setStage(scanId, 'structuring');
    const structured = await structureReceipt(transcription.rawText);
    const linesWithConfidence = attachConfidences(structured, transcription.lines);

    if (linesWithConfidence.length === 0) {
      await failScan(scanId, 'The receipt was read but contained no product lines.');
      return;
    }

    await setStage(scanId, 'matching');
    const merchant = structured.merchant ?? '';

    // Reprocessing replaces prior lines; otherwise a retry would double them.
    await db.delete(receiptScanLines).where(eq(receiptScanLines.scanId, scanId));

    const warnings: string[] = [];
    if (!structured.merchant) {
      warnings.push('No merchant was detected. Set one before confirming.');
    }

    // Same shop, same day, already confirmed — probably a re-scan of a receipt
    // that is already in the pantry. A warning, not a block: genuine repeat
    // trips on one day do happen.
    if (structured.merchant && structured.purchasedAt) {
      const duplicate = await db.query.receiptScans.findFirst({
        where: and(
          eq(receiptScans.householdId, householdId),
          eq(receiptScans.status, 'confirmed'),
          eq(receiptScans.merchant, structured.merchant),
          eq(receiptScans.purchasedAt, new Date(structured.purchasedAt))
        ),
      });
      if (duplicate) {
        warnings.push(
          `A receipt from ${structured.merchant} on this date was already confirmed. Check you are not adding the same shop twice.`
        );
      }
    }

    for (const [index, line] of linesWithConfidence.entries()) {
      const match = await matchReceiptLine(
        {
          rawText: line.rawText,
          merchantCode: line.code,
          merchant,
          ocrConfidence: line.ocrConfidence,
        },
        householdId
      );

      await db.insert(receiptScanLines).values({
        scanId,
        householdId,
        lineIndex: index,
        rawText: line.rawText.slice(0, 500),
        merchantCode: line.code,
        count: line.count.toFixed(3),
        price: line.price !== null ? line.price.toFixed(2) : null,
        ocrConfidence: line.ocrConfidence !== null ? line.ocrConfidence.toFixed(4) : null,
        resolution: match.resolution,
        itemId: match.itemId,
        unitsPerCount: match.unitsPerCount,
      });
    }

    await db
      .update(receiptScans)
      .set({
        status: 'review',
        processingStage: 'done',
        merchant: structured.merchant,
        purchasedAt: structured.purchasedAt ? new Date(structured.purchasedAt) : null,
        rawOcrText: transcription.rawText,
        parseWarnings: warnings,
        processingTimeMs: Date.now() - startedAt,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(receiptScans.id, scanId));

    logger.info(
      { scanId, lineCount: linesWithConfidence.length, ms: Date.now() - startedAt },
      'Receipt scan ready for review'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt parsing failed';
    logger.error({ scanId, error }, 'Receipt scan processing failed');
    await failScan(scanId, message);
  }
}

export async function getScan(
  scanId: string,
  householdId: string
): Promise<ScanWithLines | null> {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) return null;

  const lines = await db
    .select()
    .from(receiptScanLines)
    .where(eq(receiptScanLines.scanId, scanId))
    .orderBy(asc(receiptScanLines.lineIndex));

  const merchant = scan.merchant ?? '';

  const withSuggestions: ScanLineWithSuggestions[] = [];
  for (const line of lines) {
    // Suggestions are recomputed on read rather than stored: the catalog moves
    // under a scan that sits in review, and a stale suggestion list is worse
    // than none.
    const match = await matchReceiptLine(
      {
        rawText: line.rawText,
        merchantCode: line.merchantCode,
        merchant,
        ocrConfidence: line.ocrConfidence !== null ? Number(line.ocrConfidence) : null,
      },
      householdId
    );
    withSuggestions.push({ ...line, suggestions: match.suggestions });
  }

  return { ...scan, lines: withSuggestions };
}

/**
 * Re-run matching for every still-unresolved line. Used after the user edits
 * the merchant, which changes every link key on the scan.
 */
export async function rematchScanLines(scanId: string, householdId: string): Promise<void> {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) return;

  const lines = await db
    .select()
    .from(receiptScanLines)
    .where(eq(receiptScanLines.scanId, scanId));

  for (const line of lines) {
    if (line.resolution !== 'unresolved') continue;

    const match = await matchReceiptLine(
      {
        rawText: line.rawText,
        merchantCode: line.merchantCode,
        merchant: scan.merchant ?? '',
        ocrConfidence: line.ocrConfidence !== null ? Number(line.ocrConfidence) : null,
      },
      householdId
    );

    if (match.resolution === 'link') {
      await db
        .update(receiptScanLines)
        .set({
          resolution: 'link',
          itemId: match.itemId,
          unitsPerCount: match.unitsPerCount,
          updatedAt: new Date(),
        })
        .where(eq(receiptScanLines.id, line.id));
    }
  }
}
