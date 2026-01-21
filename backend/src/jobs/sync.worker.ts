import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { syncQueue as syncQueueTable, sharedResources } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { emitSyncEvent } from '../websocket/events.js';
import { logger } from '../lib/logger.js';
import type { SyncJobData } from './index.js';

export async function processSyncJob(job: Job<SyncJobData>): Promise<void> {
  const { fromHouseholdId, toHouseholdId, resourceType, resourceId, operation } = job.data;

  const log = logger.child({ jobId: job.id, resourceType, resourceId, operation });
  log.debug('Processing sync job');

  try {
    // Find sync queue entry
    const syncEntry = await db.query.syncQueue.findFirst({
      where: and(
        eq(syncQueueTable.fromHouseholdId, fromHouseholdId),
        eq(syncQueueTable.toHouseholdId, toHouseholdId),
        eq(syncQueueTable.resourceType, resourceType),
        eq(syncQueueTable.resourceId, resourceId)
      ),
    });

    if (!syncEntry) {
      log.warn('Sync entry not found, may have been processed already');
      return;
    }

    // Mark as in progress
    await db
      .update(syncQueueTable)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(syncQueueTable.id, syncEntry.id));

    // Perform sync based on operation
    switch (operation) {
      case 'share':
        await handleShareSync(fromHouseholdId, toHouseholdId, resourceType, resourceId);
        break;
      case 'update':
        await handleUpdateSync(fromHouseholdId, toHouseholdId, resourceType, resourceId);
        break;
      case 'delete':
        await handleDeleteSync(fromHouseholdId, toHouseholdId, resourceType, resourceId);
        break;
    }

    // Mark as completed
    await db
      .update(syncQueueTable)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(syncQueueTable.id, syncEntry.id));

    // Emit sync event to both households
    emitSyncEvent(fromHouseholdId, {
      syncId: syncEntry.id,
      resourceType,
      resourceId,
      action: 'completed',
      fromHouseholdId,
    });

    emitSyncEvent(toHouseholdId, {
      syncId: syncEntry.id,
      resourceType,
      resourceId,
      action: 'completed',
      fromHouseholdId,
    });

    log.debug('Sync job completed successfully');
  } catch (error) {
    log.error({ error }, 'Failed to process sync job');

    // Update sync entry with error
    const syncEntry = await db.query.syncQueue.findFirst({
      where: and(
        eq(syncQueueTable.fromHouseholdId, fromHouseholdId),
        eq(syncQueueTable.toHouseholdId, toHouseholdId),
        eq(syncQueueTable.resourceType, resourceType),
        eq(syncQueueTable.resourceId, resourceId)
      ),
    });

    if (syncEntry) {
      await db
        .update(syncQueueTable)
        .set({
          status: 'failed',
          lastError: error instanceof Error ? error.message : 'Unknown error',
          retryCount: syncEntry.retryCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(syncQueueTable.id, syncEntry.id));

      // Emit failure event
      emitSyncEvent(fromHouseholdId, {
        syncId: syncEntry.id,
        resourceType,
        resourceId,
        action: 'failed',
        fromHouseholdId,
      });
    }

    throw error;
  }
}

async function handleShareSync(
  fromHouseholdId: string,
  toHouseholdId: string,
  resourceType: string,
  resourceId: string
): Promise<void> {
  // Verify shared resource still exists
  const shared = await db.query.sharedResources.findFirst({
    where: and(
      eq(sharedResources.resourceType, resourceType),
      eq(sharedResources.resourceId, resourceId),
      eq(sharedResources.fromHouseholdId, fromHouseholdId),
      eq(sharedResources.toHouseholdId, toHouseholdId)
    ),
  });

  if (!shared) {
    throw new Error('Shared resource not found');
  }

  // The actual data sync would depend on the resource type
  // For now, we just mark it as synced
  // In a real implementation, you would:
  // 1. Fetch the resource data from the source household
  // 2. Create a reference or copy in the target household
  // 3. Update any relationship tables

  logger.debug({ resourceType, resourceId }, 'Share sync completed');
}

async function handleUpdateSync(
  fromHouseholdId: string,
  toHouseholdId: string,
  resourceType: string,
  resourceId: string
): Promise<void> {
  // Check if resource is still shared
  const shared = await db.query.sharedResources.findFirst({
    where: and(
      eq(sharedResources.resourceType, resourceType),
      eq(sharedResources.resourceId, resourceId),
      eq(sharedResources.fromHouseholdId, fromHouseholdId),
      eq(sharedResources.toHouseholdId, toHouseholdId)
    ),
  });

  if (!shared) {
    logger.warn({ resourceType, resourceId }, 'Resource no longer shared, skipping update sync');
    return;
  }

  // Update the synced data in target household
  // Implementation depends on resource type

  logger.debug({ resourceType, resourceId }, 'Update sync completed');
}

async function handleDeleteSync(
  fromHouseholdId: string,
  toHouseholdId: string,
  resourceType: string,
  resourceId: string
): Promise<void> {
  // Remove shared resource reference
  await db
    .delete(sharedResources)
    .where(
      and(
        eq(sharedResources.resourceType, resourceType),
        eq(sharedResources.resourceId, resourceId),
        eq(sharedResources.fromHouseholdId, fromHouseholdId),
        eq(sharedResources.toHouseholdId, toHouseholdId)
      )
    );

  // Clean up any synced data in target household
  // Implementation depends on resource type

  logger.debug({ resourceType, resourceId }, 'Delete sync completed');
}
