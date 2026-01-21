import { Job } from 'bullmq';
import { db } from '../config/database.js';
import {
  backups,
  backupSchedules,
  households,
  users,
  calendars,
  calendarEvents,
  recipes,
  inventoryItems,
  tasks,
  lists,
  listItems,
} from '../db/schema/index.js';
import { eq, lt } from 'drizzle-orm';
import { config } from '../config/index.js';
import { encrypt } from '../lib/encryption.js';
import { logger } from '../lib/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { BackupJobData } from './index.js';

export async function processBackupJob(job: Job<BackupJobData>): Promise<void> {
  const { householdId, scheduleId, includeFiles, encryptionKey } = job.data;

  const log = logger.child({ jobId: job.id, householdId, scheduleId });
  log.info('Starting backup job');

  const backupId = randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${householdId}-${timestamp}.json`;
  const storagePath = path.join(config.STORAGE_PATH, 'backups', householdId, filename);

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(storagePath), { recursive: true });

    // Gather all household data
    const backupData = await gatherCompleteBackupData(householdId, includeFiles);

    // Optionally encrypt
    let finalData: string;
    let isEncrypted = false;

    if (encryptionKey) {
      const encrypted = await encrypt(JSON.stringify(backupData), encryptionKey);
      finalData = JSON.stringify({ encrypted: true, data: encrypted });
      isEncrypted = true;
    } else {
      finalData = JSON.stringify(backupData, null, 2);
    }

    // Write backup file
    await fs.writeFile(storagePath, finalData);
    const stats = await fs.stat(storagePath);

    // Create database record
    await db.insert(backups).values({
      id: backupId,
      householdId,
      scheduleId: scheduleId || null,
      name: `Backup ${timestamp}`,
      storagePath,
      sizeBytes: stats.size,
      isEncrypted,
      status: 'completed',
      completedAt: new Date(),
    });

    // Update schedule if applicable
    if (scheduleId) {
      await db
        .update(backupSchedules)
        .set({
          lastRunAt: new Date(),
          nextRunAt: calculateNextRun(scheduleId),
          updatedAt: new Date(),
        })
        .where(eq(backupSchedules.id, scheduleId));
    }

    // Clean up old backups based on retention policy
    if (scheduleId) {
      await cleanupOldBackups(householdId, scheduleId);
    }

    log.info({ backupId, sizeBytes: stats.size }, 'Backup completed successfully');
  } catch (error) {
    log.error({ error }, 'Backup job failed');

    // Record failed backup
    await db.insert(backups).values({
      id: backupId,
      householdId,
      scheduleId: scheduleId || null,
      name: `Failed Backup ${timestamp}`,
      storagePath: '',
      sizeBytes: 0,
      isEncrypted: false,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

async function gatherCompleteBackupData(householdId: string, includeFiles: boolean): Promise<any> {
  const log = logger.child({ householdId });
  log.debug('Gathering backup data');

  // Fetch household
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });

  // Fetch users (without sensitive data)
  const userList = await db.query.users.findMany({
    where: eq(users.householdId, householdId),
    columns: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  // Fetch calendars and events
  const calendarList = await db.query.calendars.findMany({
    where: eq(calendars.householdId, householdId),
  });

  const eventList = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.householdId, householdId),
  });

  // Fetch recipes
  const recipeList = await db.query.recipes.findMany({
    where: eq(recipes.householdId, householdId),
  });

  // Fetch inventory
  const inventoryList = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  // Fetch tasks
  const taskList = await db.query.tasks.findMany({
    where: eq(tasks.householdId, householdId),
  });

  // Fetch lists and items
  const listList = await db.query.lists.findMany({
    where: eq(lists.householdId, householdId),
  });

  const listItemList: any[] = [];
  for (const list of listList) {
    const items = await db.query.listItems.findMany({
      where: eq(listItems.listId, list.id),
    });
    listItemList.push(...items);
  }

  return {
    version: '1.0',
    createdAt: new Date().toISOString(),
    householdId,
    data: {
      household: household ? {
        id: household.id,
        name: household.name,
        timezone: household.timezone,
        settings: household.settings,
      } : null,
      users: userList,
      calendars: calendarList,
      events: eventList,
      recipes: recipeList,
      inventory: inventoryList,
      tasks: taskList,
      lists: listList,
      listItems: listItemList,
      // Files are stored separately and linked by path
      // In a real implementation, you might also backup file metadata
    },
    metadata: {
      userCount: userList.length,
      calendarCount: calendarList.length,
      eventCount: eventList.length,
      recipeCount: recipeList.length,
      inventoryCount: inventoryList.length,
      taskCount: taskList.length,
      listCount: listList.length,
    },
  };
}

async function calculateNextRun(scheduleId: string): Promise<Date> {
  // In a real implementation, parse the cron expression
  // For now, default to 24 hours from now
  const nextRun = new Date();
  nextRun.setHours(nextRun.getHours() + 24);
  return nextRun;
}

async function cleanupOldBackups(householdId: string, scheduleId: string): Promise<void> {
  const schedule = await db.query.backupSchedules.findFirst({
    where: eq(backupSchedules.id, scheduleId),
  });

  if (!schedule) return;

  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - schedule.retentionDays);

  // Find old backups
  const oldBackups = await db.query.backups.findMany({
    where: eq(backups.householdId, householdId),
  });

  const toDelete = oldBackups.filter(
    (b) => b.scheduleId === scheduleId && b.createdAt < retentionDate
  );

  for (const backup of toDelete) {
    // Delete file
    if (backup.storagePath) {
      try {
        await fs.unlink(backup.storagePath);
      } catch {
        // File might not exist
      }
    }

    // Delete record
    await db.delete(backups).where(eq(backups.id, backup.id));
  }

  if (toDelete.length > 0) {
    logger.info({ householdId, count: toDelete.length }, 'Cleaned up old backups');
  }
}
