import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { calendars } from '../db/schema/index.js';
import { eq, and, isNotNull } from 'drizzle-orm';
import { syncCalendarFromGoogle } from '../modules/calendars/google-sync.service.js';
import { syncCalendarFromOutlook } from '../modules/calendars/outlook-sync.service.js';
import { emitHouseholdEvent } from '../websocket/events.js';
import { logger } from '../lib/logger.js';
import { queueNotification } from './index.js';

export interface CalendarSyncJobData {
  type: 'sync_all' | 'sync_single';
  calendarId?: string;
  householdId?: string;
}

interface SyncResult {
  calendarId: string;
  calendarName: string;
  success: boolean;
  created?: number;
  updated?: number;
  deleted?: number;
  error?: string;
}

/**
 * Process calendar sync job
 * This job syncs all calendars with isSynced=true or a specific calendar
 */
export async function processCalendarSyncJob(job: Job<CalendarSyncJobData>): Promise<SyncResult[]> {
  const log = logger.child({ jobId: job.id, type: job.data.type });
  log.info('Processing calendar sync job');

  const results: SyncResult[] = [];

  try {
    let calendarsToSync;

    if (job.data.type === 'sync_single' && job.data.calendarId && job.data.householdId) {
      // Sync a specific calendar
      calendarsToSync = await db.query.calendars.findMany({
        where: and(
          eq(calendars.id, job.data.calendarId),
          eq(calendars.householdId, job.data.householdId),
          eq(calendars.isSynced, true),
          isNotNull(calendars.syncProvider)
        ),
      });
    } else {
      // Sync all calendars that have sync enabled
      calendarsToSync = await db.query.calendars.findMany({
        where: and(
          eq(calendars.isSynced, true),
          isNotNull(calendars.syncProvider)
        ),
      });
    }

    if (calendarsToSync.length === 0) {
      log.debug('No calendars to sync');
      return results;
    }

    log.info({ count: calendarsToSync.length }, 'Found calendars to sync');

    for (const calendar of calendarsToSync) {
      const calendarLog = log.child({
        calendarId: calendar.id,
        calendarName: calendar.name,
        provider: calendar.syncProvider,
      });

      try {
        // Emit sync started event
        emitHouseholdEvent(calendar.householdId, 'calendar:sync:started', {
          calendarId: calendar.id,
          calendarName: calendar.name,
        });

        let syncResult: { created: number; updated: number; deleted: number };

        if (calendar.syncProvider === 'google') {
          calendarLog.info('Syncing from Google Calendar');
          syncResult = await syncCalendarFromGoogle(calendar.id, calendar.householdId);
        } else if (calendar.syncProvider === 'outlook') {
          calendarLog.info('Syncing from Outlook Calendar');
          syncResult = await syncCalendarFromOutlook(calendar.id, calendar.householdId);
        } else {
          calendarLog.warn('Unknown sync provider');
          continue;
        }

        results.push({
          calendarId: calendar.id,
          calendarName: calendar.name,
          success: true,
          ...syncResult,
        });

        // Emit sync completed event
        emitHouseholdEvent(calendar.householdId, 'calendar:sync:completed', {
          calendarId: calendar.id,
          calendarName: calendar.name,
          result: syncResult,
        });

        calendarLog.info(syncResult, 'Calendar sync completed');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        calendarLog.error({ error }, 'Failed to sync calendar');

        results.push({
          calendarId: calendar.id,
          calendarName: calendar.name,
          success: false,
          error: errorMessage,
        });

        // Emit sync failed event
        emitHouseholdEvent(calendar.householdId, 'calendar:sync:failed', {
          calendarId: calendar.id,
          calendarName: calendar.name,
          error: errorMessage,
        });

        // Check for consecutive failures and notify after 3
        await handleSyncFailure(calendar.id, calendar.householdId, calendar.name, errorMessage);
      }
    }

    log.info({ results }, 'Calendar sync job completed');
    return results;
  } catch (error) {
    log.error({ error }, 'Failed to process calendar sync job');
    throw error;
  }
}

/**
 * Track consecutive sync failures and notify after threshold
 */
async function handleSyncFailure(
  calendarId: string,
  householdId: string,
  calendarName: string,
  errorMessage: string
): Promise<void> {
  // Get the current sync error count from the calendar record
  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  if (!calendar) return;

  // Parse the syncError field to track consecutive failures
  // Format: "error_message|count" or just "error_message" for first failure
  let failureCount = 1;
  if (calendar.syncError) {
    const parts = calendar.syncError.split('|count:');
    if (parts.length === 2) {
      failureCount = parseInt(parts[1], 10) + 1;
    }
  }

  // Update the sync error with failure count
  await db
    .update(calendars)
    .set({
      syncError: `${errorMessage}|count:${failureCount}`,
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, calendarId));

  // Send notification after 3 consecutive failures
  if (failureCount >= 3) {
    await queueNotification({
      type: 'sync_error',
      householdId,
      title: 'Calendar Sync Failed',
      message: `"${calendarName}" has failed to sync ${failureCount} times. Error: ${errorMessage}`,
      data: {
        calendarId,
        calendarName,
        failureCount,
        lastError: errorMessage,
      },
    });

    logger.warn(
      { calendarId, householdId, failureCount },
      'Calendar sync has failed multiple times, notification sent'
    );
  }
}
