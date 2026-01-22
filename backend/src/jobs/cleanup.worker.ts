import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { sessions, notifications, auditLogs, files, leftovers } from '../db/schema/index.js';
import { lt, and, isNotNull } from 'drizzle-orm';
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
    }

    log.info('Cleanup job completed');
  } catch (error) {
    log.error({ error }, 'Cleanup job failed');
    throw error;
  }
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = new Date();

  // Delete expired sessions from database
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id, token: sessions.token });

  // Also clean up Redis session cache
  const pipeline = redis.pipeline();
  for (const session of result) {
    pipeline.del(`session:${session.token}`);
  }
  await pipeline.exec();

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
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, cutoff))
    .returning({ id: auditLogs.id });

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

async function cleanupOrphanedFiles(householdId?: string): Promise<void> {
  // Find files that exist on disk but not in database, or vice versa
  // This is a safety check that should be run periodically

  const log = logger.child({ householdId });

  // Get all files from database
  const dbFiles = await db.query.files.findMany({
    columns: { id: true, storagePath: true },
  });

  const dbPaths = new Set(dbFiles.map((f) => f.storagePath));
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
