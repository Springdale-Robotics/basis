import { randomBytes } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireInventoryAccess } from '../../middleware/permission.middleware.js';
import {
  receiptScans,
  receiptScanLines,
  receiptLineLinks,
  inventoryItems,
  inventoryAreas,
} from '../../db/schema/index.js';
import { queueReceiptParse } from '../../jobs/index.js';
import { isOcrAvailable } from './receipt-ocr.js';
import { isStructurerAvailable } from './receipt-structurer.js';
import { createScan, getScan, rematchScanLines, confirmScan } from './receipts.service.js';
import {
  updateScanSchema,
  updateLineSchema,
  createItemForLineSchema,
  listScansQuerySchema,
  updateLinkSchema,
  listLinksQuerySchema,
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

      // Bound the upload at the multipart layer. The app-wide limit is far
      // looser (MAX_UPLOAD_SIZE_MB), so without this the whole file is resident
      // in memory before createScan's own size check ever runs — the tighter
      // limit would reject after the damage, not prevent it.
      const data = await request.file({
        limits: { fileSize: config.RECEIPT_MAX_SIZE_MB * 1024 * 1024 },
      });
      if (!data) throw Errors.validation('No file uploaded');

      let buffer: Buffer;
      try {
        buffer = await data.toBuffer();
      } catch (error) {
        if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
          throw Errors.validation(
            `Image size exceeds maximum of ${config.RECEIPT_MAX_SIZE_MB}MB`
          );
        }
        throw error;
      }

      // Read fields only AFTER the stream is consumed. @fastify/multipart
      // populates `fields` as it parses, so a client that appends the file
      // before its other fields — the natural FormData order — would otherwise
      // hand us an empty object and we would silently drop defaultAreaId.
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

  // Serves the original photo so OCR errors can be checked against the source.
  // Fetched directly by <img src>, not through the API client.
  app.get<{ Params: { id: string } }>(
    '/scans/:id/image',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request, reply) => {
      const scan = await requireScan(request.params.id, request.user!.householdId);
      if (!scan.imagePath) {
        // Pruned by the retention sweep, or never stored.
        throw Errors.notFound('Receipt image', request.params.id);
      }

      try {
        const buffer = await readFile(scan.imagePath);
        return reply
          .header('Content-Type', scan.imageMimeType ?? 'image/jpeg')
          .header('Cache-Control', 'private, max-age=3600')
          .send(buffer);
      } catch {
        throw Errors.notFound('Receipt image', request.params.id);
      }
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

  app.post<{ Params: { id: string } }>(
    '/scans/:id/confirm',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const result = await confirmScan(request.params.id, request.user!.householdId);
      return { success: true, data: result };
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

  // Learned merchant/line -> item mappings. This is the only visibility
  // surface for state confirmScan applies silently on every future scan, so
  // list, correction (PATCH), and forgetting (DELETE) all live here.
  app.get<{ Querystring: { merchant?: string; search?: string; limit?: number } }>(
    '/links',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const query = listLinksQuerySchema.parse(request.query);

      const conditions = [eq(receiptLineLinks.householdId, request.user!.householdId)];
      if (query.merchant) {
        conditions.push(eq(receiptLineLinks.merchant, query.merchant.toLowerCase()));
      }
      if (query.search) {
        conditions.push(ilike(receiptLineLinks.lineKey, `%${query.search}%`));
      }

      const links = await db
        .select({
          id: receiptLineLinks.id,
          merchant: receiptLineLinks.merchant,
          lineKey: receiptLineLinks.lineKey,
          keyKind: receiptLineLinks.keyKind,
          itemId: receiptLineLinks.itemId,
          itemName: inventoryItems.name,
          unitsPerCount: receiptLineLinks.unitsPerCount,
          itemUnit: inventoryItems.defaultUnit,
          useCount: receiptLineLinks.useCount,
          lastUsedAt: receiptLineLinks.lastUsedAt,
          lastRawText: receiptLineLinks.lastRawText,
        })
        .from(receiptLineLinks)
        .innerJoin(inventoryItems, eq(inventoryItems.id, receiptLineLinks.itemId))
        .where(and(...conditions))
        .orderBy(desc(receiptLineLinks.useCount))
        .limit(query.limit);

      return { success: true, data: { links } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/links/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const link = await db.query.receiptLineLinks.findFirst({
        where: and(
          eq(receiptLineLinks.id, request.params.id),
          eq(receiptLineLinks.householdId, request.user!.householdId)
        ),
      });
      if (!link) throw Errors.notFound('Receipt line link', request.params.id);

      const input = updateLinkSchema.parse(request.body);
      if (input.itemId) {
        await requireItem(input.itemId, request.user!.householdId);
      }

      await db
        .update(receiptLineLinks)
        .set({
          ...(input.itemId ? { itemId: input.itemId } : {}),
          ...(input.unitsPerCount ? { unitsPerCount: input.unitsPerCount.toFixed(3) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(receiptLineLinks.id, link.id));

      return { success: true, data: { message: 'Link updated' } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/links/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const deleted = await db
        .delete(receiptLineLinks)
        .where(
          and(
            eq(receiptLineLinks.id, request.params.id),
            eq(receiptLineLinks.householdId, request.user!.householdId)
          )
        )
        .returning({ id: receiptLineLinks.id });

      if (deleted.length === 0) {
        throw Errors.notFound('Receipt line link', request.params.id);
      }

      return { success: true, data: { message: 'Link forgotten' } };
    }
  );
}
