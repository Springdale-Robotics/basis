import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { sessions, notifications, auditLog, leftovers, receiptScans, recipeImportSessions } from '../db/schema/index.js';
import { lt, and, isNotNull, inArray, eq } from 'drizzle-orm';
import { redis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import * as fs from 'fs/promises';
import type { CleanupJobData } from './index.js';

export async function processCleanupJob(job: Job<CleanupJobData>): Promise<void> {
  const { type, householdId } = job.data;

  const log = logger.child({ jobId: job.id, type, householdId });
  log.info('Starting cleanup job');

  try {
    switch (type) {
      case 'expired_sessions':
        await cleanupExpiredSessions();
        break;
      case 'old_notifications':
        await cleanupOldNotifications();
        break;
      case 'old_audit_logs':
        await cleanupOldAuditLogs();
        break;
      case 'orphaned_files':
        await cleanupOrphanedFiles(householdId);
        break;
      case 'old_leftovers':
        await cleanupOldLeftovers();
        break;
      case 'old_receipt_scans':
        await cleanupOldReceiptScans();
        break;
      case 'old_import_sessions':
        await cleanupOldImportSessions();
        break;
      case 'abandoned_image_scans': {
        const { cleanupAbandonedImageScans } = await import(
          '../modules/image-parse/image-parse.service.js'
        );
        await cleanupAbandonedImageScans();
        break;
      }
    }

    log.info('Cleanup job completed');
  } catch (error) {
    log.error({ error }, 'Cleanup job failed');
    throw error;
  }
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = new Date();

  // Delete expired sessions from database. Sessions are validated directly
  // against this table on each request (no Redis session cache exists), so
  // removing the rows is sufficient.
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });

  logger.info({ count: result.length }, 'Cleaned up expired sessions');
}

async function cleanupOldNotifications(): Promise<void> {
  // Keep notifications for 30 days for read, 90 days for unread
  const readCutoff = new Date();
  readCutoff.setDate(readCutoff.getDate() - 30);

  const unreadCutoff = new Date();
  unreadCutoff.setDate(unreadCutoff.getDate() - 90);

  // Delete read notifications older than 30 days
  const readResult = await db
    .delete(notifications)
    .where(
      and(
        isNotNull(notifications.readAt),
        lt(notifications.createdAt, readCutoff)
      )
    )
    .returning({ id: notifications.id });

  // Delete unread notifications older than 90 days
  const unreadResult = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, unreadCutoff))
    .returning({ id: notifications.id });

  logger.info(
    { readCount: readResult.length, unreadCount: unreadResult.length },
    'Cleaned up old notifications'
  );
}

async function cleanupOldAuditLogs(): Promise<void> {
  // Keep audit logs for 1 year
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  const result = await db
    .delete(auditLog)
    .where(lt(auditLog.createdAt, cutoff))
    .returning({ id: auditLog.id });

  logger.info({ count: result.length }, 'Cleaned up old audit logs');
}

async function cleanupOldLeftovers(): Promise<void> {
  // Keep finished leftovers for 30 days, then delete them
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const result = await db
    .delete(leftovers)
    .where(
      and(
        isNotNull(leftovers.finishedAt),
        lt(leftovers.finishedAt, cutoff)
      )
    )
    .returning({ id: leftovers.id });

  logger.info({ count: result.length }, 'Cleaned up old finished leftovers');
}

/**
 * Receipt scans age on two clocks. A confirmed scan's image is dead weight
 * after a week, but the record and its OCR text are cheap history worth
 * keeping. An abandoned review is swept whole after 30 days — unlike
 * image-parse sessions there is no hard expiry, because coming back to a
 * half-reviewed receipt is the normal case.
 */
async function cleanupOldReceiptScans(): Promise<void> {
  const now = Date.now();
  const imageCutoff = new Date(now - config.RECEIPT_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const scanCutoff = new Date(now - config.RECEIPT_SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Abandoned reviews (and failed parses) go away entirely.
  const stale = await db
    .delete(receiptScans)
    .where(
      and(
        inArray(receiptScans.status, ['review', 'processing', 'failed']),
        lt(receiptScans.updatedAt, scanCutoff)
      )
    )
    .returning({ id: receiptScans.id, imagePath: receiptScans.imagePath });

  for (const scan of stale) {
    if (!scan.imagePath) continue;
    try {
      await fs.unlink(scan.imagePath);
    } catch {
      // Already gone; nothing to do.
    }
  }

  // Confirmed scans keep their record, lose their image.
  const confirmed = await db
    .select({ id: receiptScans.id, imagePath: receiptScans.imagePath })
    .from(receiptScans)
    .where(
      and(
        eq(receiptScans.status, 'confirmed'),
        lt(receiptScans.confirmedAt, imageCutoff),
        isNotNull(receiptScans.imagePath)
      )
    );

  for (const scan of confirmed) {
    await db
      .update(receiptScans)
      .set({ imagePath: null })
      .where(eq(receiptScans.id, scan.id));
    if (scan.imagePath) {
      try {
        await fs.unlink(scan.imagePath);
      } catch {
        // Already gone.
      }
    }
  }

  logger.info(
    { deletedScans: stale.length, imagesPruned: confirmed.length },
    'Cleaned up old receipt scans'
  );
}

async function cleanupOrphanedFiles(householdId?: string): Promise<void> {
  // Find files that exist on disk but not in database, or vice versa
  // This is a safety check that should be run periodically

  const log = logger.child({ householdId });

  // Get all files from database
  const dbFiles = await db.query.files.findMany({
    columns: { id: true, storagePath: true },
  });

  let orphanedCount = 0;

  // Check each file's existence
  for (const file of dbFiles) {
    try {
      await fs.access(file.storagePath);
    } catch {
      // File doesn't exist on disk, mark for cleanup
      log.warn({ fileId: file.id, path: file.storagePath }, 'Database record exists but file missing');
      orphanedCount++;
    }
  }

  // Optionally scan storage directory for orphaned files
  // (files that exist on disk but not in database)
  // This would require walking the storage directory

  log.info({ orphanedCount }, 'Orphaned file check completed');
}

// Additional cleanup utilities
export async function cleanupUserData(userId: string): Promise<void> {
  // Clean up all user-related cached data
  const keys = await redis.keys(`user:${userId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  logger.info({ userId, keysRemoved: keys.length }, 'User cache cleaned up');
}

export async function cleanupHouseholdCache(householdId: string): Promise<void> {
  // Clean up all household-related cached data
  const keys = await redis.keys(`household:${householdId}:*`);
  const onlineKey = `online:${householdId}`;

  const allKeys = [...keys, onlineKey];
  if (allKeys.length > 0) {
    await redis.del(...allKeys);
  }

  logger.info({ householdId, keysRemoved: allKeys.length }, 'Household cache cleaned up');
}

/**
 * Sweep recipe import sessions that are done with.
 *
 * Every session carries its own source in `source_data` — for a PDF import,
 * the whole file as base64 — and nothing ever deleted them, so a household
 * that imported forty recipes kept forty copies of the source indefinitely.
 * Receipt scans already had this; recipe imports were simply missed.
 *
 * Confirmed and cancelled sessions are finished business and go after a short
 * grace period. Sessions that expired without being confirmed (including
 * failed ones) go once they are well past their expiry, so a user who comes
 * back to a stale tab still gets "this import expired" rather than "not
 * found".
 */
async function cleanupOldImportSessions(): Promise<void> {
  const settledCutoff = new Date();
  settledCutoff.setDate(settledCutoff.getDate() - 1);

  const abandonedCutoff = new Date();
  abandonedCutoff.setDate(abandonedCutoff.getDate() - 7);

  const settled = await db
    .delete(recipeImportSessions)
    .where(
      and(
        inArray(recipeImportSessions.status, ['confirmed', 'cancelled']),
        lt(recipeImportSessions.createdAt, settledCutoff)
      )
    )
    .returning({ id: recipeImportSessions.id });

  const abandoned = await db
    .delete(recipeImportSessions)
    .where(lt(recipeImportSessions.expiresAt, abandonedCutoff))
    .returning({ id: recipeImportSessions.id });

  logger.info(
    { settled: settled.length, abandoned: abandoned.length },
    'Cleaned up old recipe import sessions'
  );
}
