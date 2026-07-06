import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { eventReminders, calendarEvents, calendars, notifications } from '../db/schema/index.js';
import { eq, and, sql, gte } from 'drizzle-orm';
import { emitNotification } from '../websocket/events.js';
import { expandRecurrence, isRecurringMaster } from '../modules/calendars/recurrence.service.js';
import { logger } from '../lib/logger.js';

export interface CalendarReminderJobData {
  type: 'check_reminders';
}

/**
 * Grace period after an occurrence starts during which a late reminder is
 * still worth sending (worker downtime, clock skew). Anything older is stale:
 * a reminder for an event that started an hour ago is noise.
 */
const STALE_GRACE_MS = 15 * 60 * 1000;

/**
 * Process calendar reminder check job — runs every minute.
 *
 * One-shot events: fire once at (start − minutesBefore), then mark sent.
 * Stale reminders (event started > grace ago) are marked sent WITHOUT
 * notifying — previously a reminder created for a past event fired
 * immediately.
 *
 * Recurring events: the reminder row stays unsent forever; each due
 * occurrence is expanded from the RRULE (in the calendar's timezone) and
 * deduplicated against the notifications table per occurrence instant.
 * Previously the series fired exactly once, computed from the master row.
 */
export async function processCalendarReminderJob(job: Job<CalendarReminderJobData>): Promise<void> {
  const log = logger.child({ jobId: job.id });
  log.debug('Processing calendar reminder job');

  try {
    const now = new Date();

    const reminders = await db.query.eventReminders.findMany({
      where: and(eq(eventReminders.sent, false)),
    });

    if (reminders.length === 0) {
      log.debug('No pending reminders found');
      return;
    }

    for (const reminder of reminders) {
      try {
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

        const calendar = await db.query.calendars.findFirst({
          where: eq(calendars.id, event.calendarId),
        });
        if (!calendar) {
          continue;
        }

        if (event.recurrenceRule && isRecurringMaster(event)) {
          await processRecurringReminder(reminder, event, calendar, now, log);
        } else {
          await processOneShotReminder(reminder, event, calendar.householdId, now, log);
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

type Reminder = typeof eventReminders.$inferSelect;
type CalEvent = typeof calendarEvents.$inferSelect;
type Calendar = typeof calendars.$inferSelect;

async function processOneShotReminder(
  reminder: Reminder,
  event: CalEvent,
  householdId: string,
  now: Date,
  log: typeof logger,
): Promise<void> {
  const eventStart = new Date(event.startTime);
  const reminderTime = new Date(eventStart.getTime() - reminder.minutesBefore * 60 * 1000);

  if (reminderTime > now) return;

  // Stale: the event already started (past the grace window). Mark sent
  // without notifying — nobody wants a reminder for last Tuesday.
  const isStale = eventStart.getTime() < now.getTime() - STALE_GRACE_MS;
  if (!isStale) {
    await sendEventReminder(householdId, reminder.userId, event, eventStart, reminder.minutesBefore);
    log.debug({ reminderId: reminder.id, eventId: event.id }, 'Reminder sent');
  }

  await db
    .update(eventReminders)
    .set({ sent: true, sentAt: now })
    .where(eq(eventReminders.id, reminder.id));
}

async function processRecurringReminder(
  reminder: Reminder,
  master: CalEvent,
  calendar: Calendar,
  now: Date,
  log: typeof logger,
): Promise<void> {
  // An occurrence is due when its reminder time has arrived and it hasn't
  // started more than the grace period ago:
  //   occStart − minutesBefore <= now  AND  occStart >= now − grace
  const windowStart = new Date(now.getTime() - STALE_GRACE_MS);
  const windowEnd = new Date(now.getTime() + reminder.minutesBefore * 60 * 1000 + 60 * 1000);

  const exceptions = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.recurringEventId, master.id),
  });

  const instances = expandRecurrence(master, windowStart, windowEnd, exceptions, calendar.timezone);

  for (const instance of instances) {
    if (instance.isCancelled) continue;
    // A moved occurrence keeps its own reminder timing via its new start.
    const occurrenceStart = instance.exceptionEvent
      ? new Date(instance.exceptionEvent.startTime)
      : instance.date;

    const reminderTime = new Date(occurrenceStart.getTime() - reminder.minutesBefore * 60 * 1000);
    if (reminderTime > now) continue;
    if (occurrenceStart.getTime() < now.getTime() - STALE_GRACE_MS) continue;

    // Dedupe per occurrence — the reminder row itself never flips to sent.
    if (await occurrenceAlreadyNotified(calendar.householdId, master.id, occurrenceStart, reminder.userId)) {
      continue;
    }

    const eventForMessage = instance.exceptionEvent ?? master;
    await sendEventReminder(
      calendar.householdId,
      reminder.userId,
      eventForMessage,
      occurrenceStart,
      reminder.minutesBefore,
    );
    log.debug(
      { reminderId: reminder.id, eventId: master.id, occurrence: occurrenceStart.toISOString() },
      'Recurring reminder sent',
    );
  }
}

/** Has this occurrence already produced a reminder notification? */
async function occurrenceAlreadyNotified(
  householdId: string,
  masterEventId: string,
  occurrenceStart: Date,
  userId: string | null,
): Promise<boolean> {
  const conditions = [
    eq(notifications.householdId, householdId),
    eq(notifications.type, 'task_due'),
    sql`${notifications.data}->>'resourceId' = ${masterEventId}`,
    sql`${notifications.data}->>'occurrenceStartTime' = ${occurrenceStart.toISOString()}`,
    // Only look at recent rows — the occurrence instant makes this precise,
    // the time bound just keeps the scan cheap.
    gte(notifications.createdAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
  ];
  if (userId) {
    conditions.push(eq(notifications.userId, userId));
  }
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

/**
 * Send an event reminder notification for a specific occurrence.
 */
async function sendEventReminder(
  householdId: string,
  userId: string | null,
  event: CalEvent,
  occurrenceStart: Date,
  minutesBefore: number
): Promise<void> {
  const timeString = event.allDay
    ? occurrenceStart.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : occurrenceStart.toLocaleString(undefined, {
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

  // Create notification in database. occurrenceStartTime keys the recurring
  // per-occurrence dedupe above.
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
        resourceId: event.recurringEventId ?? event.id,
        itemName: event.title,
        occurrenceStartTime: occurrenceStart.toISOString(),
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
