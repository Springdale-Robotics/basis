import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { eventReminders, calendarEvents, calendars, notifications } from '../db/schema/index.js';
import { eq, and, lte, gte, isNull } from 'drizzle-orm';
import { emitNotification } from '../websocket/events.js';
import { logger } from '../lib/logger.js';

export interface CalendarReminderJobData {
  type: 'check_reminders';
}

/**
 * Process calendar reminder check job
 * This job runs periodically to check for event reminders that need to be sent
 */
export async function processCalendarReminderJob(job: Job<CalendarReminderJobData>): Promise<void> {
  const log = logger.child({ jobId: job.id });
  log.debug('Processing calendar reminder job');

  try {
    const now = new Date();
    const lookAheadMinutes = 60; // Check reminders due in the next hour
    const lookAhead = new Date(now.getTime() + lookAheadMinutes * 60 * 1000);

    // Find all unsent reminders for events starting within the look-ahead window
    const reminders = await db.query.eventReminders.findMany({
      where: and(
        eq(eventReminders.sent, false)
      ),
    });

    if (reminders.length === 0) {
      log.debug('No pending reminders found');
      return;
    }

    log.info({ count: reminders.length }, 'Found pending reminders');

    for (const reminder of reminders) {
      try {
        // Get the event for this reminder
        const event = await db.query.calendarEvents.findFirst({
          where: eq(calendarEvents.id, reminder.eventId),
        });

        if (!event) {
          // Event was deleted, mark reminder as sent to clean up
          await db
            .update(eventReminders)
            .set({ sent: true, sentAt: now })
            .where(eq(eventReminders.id, reminder.id));
          continue;
        }

        // Get the calendar to find the household
        const calendar = await db.query.calendars.findFirst({
          where: eq(calendars.id, event.calendarId),
        });

        if (!calendar) {
          continue;
        }

        // Calculate when the reminder should be sent
        const eventStart = new Date(event.startTime);
        const reminderTime = new Date(eventStart.getTime() - reminder.minutesBefore * 60 * 1000);

        // Check if it's time to send this reminder
        if (reminderTime <= now) {
          // Time to send the reminder!
          await sendEventReminder(calendar.householdId, reminder.userId, event, reminder.minutesBefore);

          // Mark reminder as sent
          await db
            .update(eventReminders)
            .set({ sent: true, sentAt: now })
            .where(eq(eventReminders.id, reminder.id));

          log.debug({ reminderId: reminder.id, eventId: event.id }, 'Reminder sent');
        }
      } catch (error) {
        log.error({ error, reminderId: reminder.id }, 'Failed to process individual reminder');
        // Continue processing other reminders
      }
    }

    log.debug('Calendar reminder job completed');
  } catch (error) {
    log.error({ error }, 'Failed to process calendar reminder job');
    throw error;
  }
}

/**
 * Send an event reminder notification
 */
async function sendEventReminder(
  householdId: string,
  userId: string | null,
  event: typeof calendarEvents.$inferSelect,
  minutesBefore: number
): Promise<void> {
  const eventStart = new Date(event.startTime);
  const timeString = event.allDay
    ? eventStart.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : eventStart.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

  let title: string;
  if (minutesBefore === 0) {
    title = `Starting now: ${event.title}`;
  } else if (minutesBefore < 60) {
    title = `In ${minutesBefore} minutes: ${event.title}`;
  } else if (minutesBefore < 1440) {
    const hours = Math.floor(minutesBefore / 60);
    title = `In ${hours} hour${hours > 1 ? 's' : ''}: ${event.title}`;
  } else {
    const days = Math.floor(minutesBefore / 1440);
    title = `In ${days} day${days > 1 ? 's' : ''}: ${event.title}`;
  }

  const body = event.location
    ? `${timeString} at ${event.location}`
    : timeString;

  // Create notification in database
  const [notification] = await db
    .insert(notifications)
    .values({
      householdId,
      userId,
      type: 'task_due', // Using task_due as closest match, or we could add 'event_reminder'
      title,
      body,
      data: {
        resourceType: 'event',
        resourceId: event.id,
        itemName: event.title,
        actions: [
          {
            id: 'view',
            label: 'View Event',
            endpoint: `/calendar?event=${event.id}`,
          },
        ],
      },
    })
    .returning();

  // Emit real-time notification
  emitNotification(householdId, userId, {
    notificationId: notification.id,
    notification: {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      createdAt: notification.createdAt,
    },
  });
}
