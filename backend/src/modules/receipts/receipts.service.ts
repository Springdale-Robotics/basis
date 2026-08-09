import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { queueReceiptParse } from '../../jobs/index.js';
import { emitInventoryEvent } from '../../websocket/events.js';
import {
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
  inventoryItems,
  inventoryStock,
  type ReceiptScan,
  type ReceiptScanLine,
  type ReceiptProcessingStage,
} from '../../db/schema/index.js';
import type { MatchSuggestion } from '../recipes/ingredient-matching.service.js';
import { transcribeReceipt } from './receipt-ocr.js';
import { structureReceipt, attachConfidences } from './receipt-structurer.js';
import {
  matchReceiptLine,
  multiplyQuantity,
  normalizeMerchant,
  buildLineKey,
} from './receipt-line-matcher.js';

/**
 * Owns the scan lifecycle: upload -> queue -> OCR -> structure -> match ->
 * review. The only two terminal states `processReceiptScan` leaves behind are
 * 'review' and 'failed' — a failed parse becomes a reviewable, retryable
 * record rather than a lost job, so this function must never throw.
 * `confirmScan`, below, closes the loop by turning a reviewed scan into stock.
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
 * failScan, guarded. A scan wedged in 'processing' forever (no error, no
 * retry button — just a spinner) is worse than one marked 'failed', so every
 * call site that exists purely to record a failure must not itself be able
 * to throw and escape that guarantee. If this write fails too — plausible,
 * since the same outage likely caused the failure being recorded — log it
 * and give up; there is nothing further to fall back to.
 */
async function safeFailScan(scanId: string, message: string): Promise<void> {
  try {
    await failScan(scanId, message);
  } catch (error) {
    logger.error(
      { scanId, error },
      'Failed to record receipt scan failure — scan may be stuck in its current state'
    );
  }
}

/**
 * OCR -> structure -> match. Terminal states are 'review' or 'failed'; this
 * never throws, so a failed parse is a reviewable record rather than a lost
 * job.
 */
export async function processReceiptScan(scanId: string, householdId: string): Promise<void> {
  const startedAt = Date.now();

  let scan: ReceiptScan | undefined;
  try {
    scan = await db.query.receiptScans.findFirst({
      where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
    });
  } catch (error) {
    // The scan id is known even though the lookup itself failed, so there is
    // something to mark failed — unlike the "row genuinely doesn't exist"
    // case below, where there is nothing to update.
    logger.error({ scanId, error }, 'Receipt scan lookup failed');
    await safeFailScan(scanId, error instanceof Error ? error.message : 'Receipt scan lookup failed');
    return;
  }

  if (!scan) {
    logger.warn({ scanId }, 'Receipt scan not found; nothing to process');
    return;
  }

  if (!scan.imagePath) {
    // Reachable: imagePath is nullable. Leaving the scan in 'processing' here
    // would strand it with nothing for the review UI to show.
    await safeFailScan(scanId, 'This scan has no stored image to process.');
    return;
  }

  try {
    await setStage(scanId, 'ocr');
    const transcription = await transcribeReceipt(scan.imagePath);

    await setStage(scanId, 'structuring');
    const structured = await structureReceipt(transcription.rawText);
    const linesWithConfidence = attachConfidences(structured, transcription.lines);

    if (linesWithConfidence.length === 0) {
      await safeFailScan(scanId, 'The receipt was read but contained no product lines.');
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
    await safeFailScan(scanId, message);
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

  // Fetched once and threaded through every line's match call below, rather
  // than letting each line's tier-3 fuzzy match re-query the household's
  // entire catalog — this endpoint is polled by the review UI, and the
  // common case (right after OCR) is exactly the worst case: every line
  // still unresolved.
  const catalog = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  const withSuggestions: ScanLineWithSuggestions[] = [];
  for (const line of lines) {
    // A resolved line has no use for suggestions — the user already decided.
    // Skip the matcher entirely rather than compute and discard them.
    if (line.resolution === 'link' || line.resolution === 'ignore') {
      withSuggestions.push({ ...line, suggestions: [] });
      continue;
    }

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
      householdId,
      catalog
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

export interface ConfirmResult {
  stockCreated: number;
  linksSaved: number;
  ignoredCount: number;
}

interface ConfirmPlan {
  line: ReceiptScanLine;
  areaId: string;
  quantity: string;
  unit: string | null;
}

/**
 * Turn a reviewed scan into stock, and remember every decision.
 *
 * Every line must be resolved first — unlike /shopping-list/put-away, which
 * silently skips what it cannot place, this refuses. Silence here would mean a
 * user believing their pantry was updated when half the receipt was dropped.
 * Everything is validated before the transaction opens: a confirm that writes
 * 20 stock rows and then discovers line 21 has no area is exactly the
 * half-applied state this design forbids.
 */
export async function confirmScan(
  scanId: string,
  householdId: string
): Promise<ConfirmResult> {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) throw Errors.notFound('Receipt scan', scanId);

  if (scan.status === 'confirmed') {
    throw Errors.conflict('This scan has already been confirmed');
  }
  if (scan.status !== 'review') {
    throw Errors.validation(`A scan in status "${scan.status}" cannot be confirmed`);
  }

  const merchant = (scan.merchant ?? '').trim();
  if (merchant.length === 0) {
    throw Errors.validation(
      'Set the merchant before confirming — it is part of every saved line mapping.'
    );
  }

  const lines = await db
    .select()
    .from(receiptScanLines)
    .where(eq(receiptScanLines.scanId, scanId))
    .orderBy(asc(receiptScanLines.lineIndex));

  const unresolved = lines.filter((line) => line.resolution === 'unresolved');
  if (unresolved.length > 0) {
    throw Errors.validation(
      `${unresolved.length} line(s) still need a decision before this receipt can be confirmed.`,
      {
        unresolvedLineIds: unresolved.map((line) => line.id),
        unresolvedLines: unresolved.map((line) => line.rawText),
      }
    );
  }

  const linked = lines.filter((line) => line.resolution === 'link');
  const ignoredCount = lines.length - linked.length;

  // Resolve every line's item and area up front so anything missing fails
  // before any write — see the module-level note above.
  const plans: ConfirmPlan[] = [];
  const missingArea: string[] = [];

  for (const line of linked) {
    if (!line.itemId || !line.unitsPerCount) {
      // A 'link' line without both is a data-integrity gap, not a user
      // decision the reviewer skipped — surface it the same way as any
      // other unresolved line rather than crashing on a null assertion.
      throw Errors.validation(
        `Line "${line.rawText}" is marked linked but is missing an item or conversion.`,
        { lineId: line.id }
      );
    }

    const item = await db.query.inventoryItems.findFirst({
      where: and(eq(inventoryItems.id, line.itemId), eq(inventoryItems.householdId, householdId)),
    });
    if (!item) throw Errors.notFound('Inventory item', line.itemId);

    const areaId = line.targetAreaId ?? item.defaultAreaId ?? scan.defaultAreaId;
    if (!areaId) {
      missingArea.push(line.rawText);
      continue;
    }

    plans.push({
      line,
      areaId,
      quantity: multiplyQuantity(line.count, line.unitsPerCount),
      unit: item.defaultUnit,
    });
  }

  if (missingArea.length > 0) {
    throw Errors.validation(
      `${missingArea.length} line(s) have no storage area. Set a default area for the scan, or pick one per line.`,
      { linesWithoutArea: missingArea }
    );
  }

  const addedAt = scan.purchasedAt ?? new Date();
  const normalizedMerchant = normalizeMerchant(merchant);

  await db.transaction(async (tx) => {
    for (const plan of plans) {
      const numericQuantity = Number(plan.quantity);
      const pricePerUnit =
        plan.line.price !== null && numericQuantity > 0
          ? (Number(plan.line.price) / numericQuantity).toFixed(4)
          : null;

      await tx.insert(inventoryStock).values({
        itemId: plan.line.itemId!,
        areaId: plan.areaId,
        quantity: plan.quantity,
        unit: plan.unit,
        source: 'purchase',
        pricePerUnit,
        originalQuantity: plan.quantity,
        addedAt,
      });

      const { lineKey, keyKind } = buildLineKey(plan.line.merchantCode, plan.line.rawText);

      await tx
        .insert(receiptLineLinks)
        .values({
          householdId,
          merchant: normalizedMerchant,
          lineKey,
          keyKind,
          itemId: plan.line.itemId!,
          unitsPerCount: plan.line.unitsPerCount!,
          useCount: 1,
          lastUsedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [receiptLineLinks.householdId, receiptLineLinks.merchant, receiptLineLinks.lineKey],
          set: {
            itemId: plan.line.itemId!,
            unitsPerCount: plan.line.unitsPerCount!,
            useCount: sql`${receiptLineLinks.useCount} + 1`,
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }

    await tx
      .update(receiptScans)
      .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(receiptScans.id, scanId));
  });

  emitInventoryEvent(householdId, { action: 'quantity_changed' });

  logger.info(
    { scanId, stockCreated: plans.length, ignoredCount },
    'Receipt scan confirmed'
  );

  return { stockCreated: plans.length, linksSaved: plans.length, ignoredCount };
}
