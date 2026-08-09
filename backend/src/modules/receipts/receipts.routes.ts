import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireInventoryAccess } from '../../middleware/permission.middleware.js';
import {
  receiptScans,
  receiptScanLines,
  inventoryItems,
  inventoryAreas,
} from '../../db/schema/index.js';
import { queueReceiptParse } from '../../jobs/index.js';
import { isOcrAvailable } from './receipt-ocr.js';
import { isStructurerAvailable } from './receipt-structurer.js';
import { createScan, getScan, rematchScanLines } from './receipts.service.js';
import {
  updateScanSchema,
  updateLineSchema,
  createItemForLineSchema,
  listScansQuerySchema,
} from './receipts.schemas.js';

/** Load a scan, 404ing when it belongs to another household. */
async function requireScan(scanId: string, householdId: string) {
  const scan = await db.query.receiptScans.findFirst({
    where: and(eq(receiptScans.id, scanId), eq(receiptScans.householdId, householdId)),
  });
  if (!scan) throw Errors.notFound('Receipt scan', scanId);
  return scan;
}

/** A scan past review is a historical record — edits are refused, not ignored. */
function assertEditable(status: string): void {
  if (status === 'confirmed' || status === 'cancelled') {
    throw Errors.conflict(`This scan is ${status} and can no longer be edited`);
  }
}

async function requireLine(lineId: string, scanId: string, householdId: string) {
  const line = await db.query.receiptScanLines.findFirst({
    where: and(
      eq(receiptScanLines.id, lineId),
      eq(receiptScanLines.scanId, scanId),
      eq(receiptScanLines.householdId, householdId)
    ),
  });
  if (!line) throw Errors.notFound('Receipt line', lineId);
  return line;
}

async function requireItem(itemId: string, householdId: string) {
  const item = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId)),
  });
  if (!item) throw Errors.notFound('Inventory item', itemId);
  return item;
}

export default async function receiptsRoutes(app: FastifyInstance): Promise<void> {
  // Capability probe so the UI can disable the entry point rather than fail late
  app.get(
    '/status',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async () => {
      const [ocr, structurer] = await Promise.all([isOcrAvailable(), isStructurerAvailable()]);
      return {
        success: true,
        data: { available: ocr && structurer, ocrAvailable: ocr, structurerAvailable: structurer },
      };
    }
  );

  // Upload a receipt image
  app.post(
    '/scans',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const contentType = request.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        throw Errors.validation('Expected multipart/form-data');
      }

      const data = await request.file();
      if (!data) throw Errors.validation('No file uploaded');

      const fields = data.fields as Record<string, { value?: string }>;
      const defaultAreaId = fields?.defaultAreaId?.value || undefined;
      if (defaultAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, defaultAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', defaultAreaId);
      }

      const buffer = await data.toBuffer();
      const scanId = await createScan(
        request.user!.householdId,
        request.user!.id,
        buffer,
        data.mimetype,
        defaultAreaId
      );

      return { success: true, data: { id: scanId, status: 'processing' } };
    }
  );

  app.get<{ Querystring: { status?: string; limit?: number } }>(
    '/scans',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const query = listScansQuerySchema.parse(request.query);

      const where = query.status
        ? and(
            eq(receiptScans.householdId, request.user!.householdId),
            eq(receiptScans.status, query.status)
          )
        : eq(receiptScans.householdId, request.user!.householdId);

      const scans = await db
        .select()
        .from(receiptScans)
        .where(where)
        .orderBy(desc(receiptScans.createdAt))
        .limit(query.limit);

      return { success: true, data: { scans } };
    }
  );

  // Lightweight poll while parsing — avoids recomputing suggestions per tick
  app.get<{ Params: { id: string } }>(
    '/scans/:id/status',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      return {
        success: true,
        data: {
          status: scan.status,
          processingStage: scan.processingStage,
          errorMessage: scan.errorMessage,
        },
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/scans/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const scan = await getScan(request.params.id, request.user!.householdId);
      if (!scan) throw Errors.notFound('Receipt scan', request.params.id);
      return { success: true, data: { scan } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/scans/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);

      const input = updateScanSchema.parse(request.body);

      if (input.defaultAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, input.defaultAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', input.defaultAreaId);
      }

      await db
        .update(receiptScans)
        .set({
          ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
          ...(input.purchasedAt !== undefined
            ? { purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null }
            : {}),
          ...(input.defaultAreaId !== undefined ? { defaultAreaId: input.defaultAreaId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(receiptScans.id, scan.id));

      // A merchant change rewrites every link key on the scan, so unresolved
      // lines get another shot at matching.
      if (input.merchant !== undefined && input.merchant !== scan.merchant) {
        await rematchScanLines(scan.id, request.user!.householdId);
      }

      const updated = await getScan(scan.id, request.user!.householdId);
      return { success: true, data: { scan: updated } };
    }
  );

  app.patch<{ Params: { id: string; lineId: string } }>(
    '/scans/:id/lines/:lineId',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);
      const line = await requireLine(request.params.lineId, scan.id, request.user!.householdId);

      const input = updateLineSchema.parse(request.body);

      const resolution = input.resolution ?? line.resolution;
      const itemId = input.itemId !== undefined ? input.itemId : line.itemId;
      const unitsPerCount =
        input.unitsPerCount !== undefined
          ? input.unitsPerCount?.toFixed(3) ?? null
          : line.unitsPerCount;

      if (resolution === 'link') {
        if (!itemId) throw Errors.validation('A linked line needs an item');
        if (!unitsPerCount) {
          throw Errors.validation(
            'A linked line needs a conversion — how many units of the item is one of these?'
          );
        }
        await requireItem(itemId, request.user!.householdId);
      }

      if (input.targetAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, input.targetAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', input.targetAreaId);
      }

      // Ignoring is a clean slate: leaving a stale item behind would let a
      // later flip back to 'link' silently reuse a conversion the user never
      // reviewed.
      const cleared = resolution !== 'link';

      await db
        .update(receiptScanLines)
        .set({
          resolution,
          itemId: cleared ? null : itemId,
          unitsPerCount: cleared ? null : unitsPerCount,
          ...(input.targetAreaId !== undefined ? { targetAreaId: input.targetAreaId } : {}),
          ...(input.count !== undefined ? { count: input.count.toFixed(3) } : {}),
          ...(input.price !== undefined
            ? { price: input.price !== null ? input.price.toFixed(2) : null }
            : {}),
          ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
          updatedAt: new Date(),
        })
        .where(eq(receiptScanLines.id, line.id));

      const updated = await getScan(scan.id, request.user!.householdId);
      return { success: true, data: { scan: updated } };
    }
  );

  // Create a catalog item and link the line to it in one round trip. Two calls
  // would risk an orphan item if the client died between them.
  app.post<{ Params: { id: string; lineId: string } }>(
    '/scans/:id/lines/:lineId/create-item',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);
      const line = await requireLine(request.params.lineId, scan.id, request.user!.householdId);

      const input = createItemForLineSchema.parse(request.body);

      if (input.defaultAreaId) {
        const area = await db.query.inventoryAreas.findFirst({
          where: and(
            eq(inventoryAreas.id, input.defaultAreaId),
            eq(inventoryAreas.householdId, request.user!.householdId)
          ),
        });
        if (!area) throw Errors.notFound('Storage area', input.defaultAreaId);
      }

      const item = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(inventoryItems)
          .values({
            householdId: request.user!.householdId,
            name: input.name,
            internalId: `HM-${randomBytes(3).toString('hex').toUpperCase()}`,
            defaultUnit: input.defaultUnit,
            category: input.category,
            defaultAreaId: input.defaultAreaId,
          })
          .returning();

        await tx
          .update(receiptScanLines)
          .set({
            resolution: 'link',
            itemId: created.id,
            unitsPerCount: input.unitsPerCount.toFixed(3),
            updatedAt: new Date(),
          })
          .where(eq(receiptScanLines.id, line.id));

        return created;
      });

      const updated = await getScan(scan.id, request.user!.householdId);
      return { success: true, data: { item, scan: updated } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/scans/:id/reprocess',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      assertEditable(scan.status);
      if (!scan.imagePath) {
        throw Errors.validation('This scan has no stored image and cannot be reprocessed');
      }

      await db
        .update(receiptScans)
        .set({
          status: 'processing',
          processingStage: 'queued',
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(receiptScans.id, scan.id));

      await queueReceiptParse({ scanId: scan.id, householdId: request.user!.householdId });

      return { success: true, data: { id: scan.id, status: 'processing' } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/scans/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);

      if (scan.imagePath) {
        try {
          await unlink(scan.imagePath);
        } catch (error) {
          logger.warn({ scanId: scan.id, error }, 'Could not delete receipt image');
        }
      }

      // Lines cascade.
      await db.delete(receiptScans).where(eq(receiptScans.id, scan.id));

      return { success: true, data: { message: 'Scan deleted' } };
    }
  );
}
