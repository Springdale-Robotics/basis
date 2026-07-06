import { randomUUID } from 'crypto';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  calendarEvents,
  calendars,
  eventReminders,
  households,
  notifications,
  users,
} from '../../src/db/schema/index.js';
import { processCalendarReminderJob } from '../../src/jobs/calendar-reminder.worker.js';

/**
 * July 2026 review, calendar HIGH #3: reminders computed fire time from the
 * master row only — a recurring series fired once (immediately, if the series
 * started in the past) and went sent=true forever; reminders for past events
 * fired on creation. Now: per-occurrence expansion with dedupe, and stale
 * reminders are retired silently.
 */

let hhId: string;
let userId: string;
let calendarId: string;

const fakeJob = { id: 'test-job', data: { type: 'check_reminders' } } as Job<{ type: 'check_reminders' }>;

async function notificationCount(eventId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.householdId, hhId),
        sql`${notifications.data}->>'resourceId' = ${eventId}`,
      ),
    );
  return rows.length;
}

beforeAll(async () => {
  hhId = randomUUID();
  await db.insert(households).values({ id: hhId, name: `Reminder Test ${hhId.slice(0, 8)}` });
  const [user] = await db
    .insert(users)
    .values({
      householdId: hhId,
      email: `reminder-${hhId.slice(0, 8)}@test.local`,
      passwordHash: 'x',
      displayName: 'Reminder Tester',
      role: 'admin',
    })
    .returning({ id: users.id });
  userId = user.id;
  const [cal] = await db
    .insert(calendars)
    .values({ householdId: hhId, name: 'Reminders', timezone: 'UTC', createdBy: userId })
    .returning({ id: calendars.id });
  calendarId = cal.id;
});

afterAll(async () => {
  // Delete events before the calendar: the calendar_changes trigger reads the
  // calendar's sync_token, which is gone mid-cascade if the calendar row
  // deletes first.
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calendarId));
  await db.delete(calendars).where(eq(calendars.id, calendarId));
  await db.delete(households).where(eq(households.id, hhId));
});

describe('calendar reminder worker', () => {
  it('retires a reminder for a long-past event without notifying', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Yesterday meeting',
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 23 * 60 * 60 * 1000),
      })
      .returning({ id: calendarEvents.id });
    const [reminder] = await db
      .insert(eventReminders)
      .values({ eventId: event.id, userId, minutesBefore: 15 })
      .returning({ id: eventReminders.id });

    await processCalendarReminderJob(fakeJob);

    const [row] = await db
      .select()
      .from(eventReminders)
      .where(eq(eventReminders.id, reminder.id));
    expect(row.sent).toBe(true);
    expect(await notificationCount(event.id)).toBe(0);
  });

  it('fires a due one-shot reminder exactly once', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Imminent meeting',
        startTime: new Date(Date.now() + 10 * 60 * 1000),
        endTime: new Date(Date.now() + 70 * 60 * 1000),
      })
      .returning({ id: calendarEvents.id });
    await db.insert(eventReminders).values({ eventId: event.id, userId, minutesBefore: 15 });

    await processCalendarReminderJob(fakeJob);
    await processCalendarReminderJob(fakeJob);

    expect(await notificationCount(event.id)).toBe(1);
  });

  it('fires per-occurrence for a recurring series and dedupes replays', async () => {
    // Daily series that started three days ago; the next occurrence is in
    // ten minutes, inside the 15-minute reminder lead.
    const firstStart = new Date(Date.now() + 10 * 60 * 1000 - 3 * 24 * 60 * 60 * 1000);
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: 'Daily standup',
        startTime: firstStart,
        endTime: new Date(firstStart.getTime() + 30 * 60 * 1000),
        recurrenceRule: 'FREQ=DAILY',
        recurrenceStatus: 'master',
      })
      .returning({ id: calendarEvents.id });
    const [reminder] = await db
      .insert(eventReminders)
      .values({ eventId: event.id, userId, minutesBefore: 15 })
      .returning({ id: eventReminders.id });

    await processCalendarReminderJob(fakeJob);
    await processCalendarReminderJob(fakeJob);

    // Exactly one notification for today's occurrence, none for the past ones
    expect(await notificationCount(event.id)).toBe(1);

    // The reminder row must stay unsent so tomorrow's occurrence can fire
    const [row] = await db
      .select()
      .from(eventReminders)
      .where(eq(eventReminders.id, reminder.id));
    expect(row.sent).toBe(false);
  });
});
