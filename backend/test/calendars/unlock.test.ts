import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendars, households } from '../../src/db/schema/index.js';
import { importIcsToCalendar } from '../../src/modules/calendars/ics.service.js';

let householdId: string;
let googleCalendarId: string;
let outlookCalendarId: string;
let localCalendarId: string;

beforeAll(async () => {
  const [household] = await db
    .insert(households)
    .values({ name: `unlock-${randomUUID()}` })
    .returning();
  householdId = household.id;

  const [google] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Google',
      type: 'synced',
      isSynced: true,
      isReadOnly: false,
      syncProvider: 'google',
      syncCalendarId: 'g@group.calendar.google.com',
    })
    .returning();
  googleCalendarId = google.id;

  const [outlook] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Outlook',
      type: 'synced',
      isSynced: true,
      isReadOnly: true,
      syncProvider: 'outlook',
      syncCalendarId: 'o-1',
    })
    .returning();
  outlookCalendarId = outlook.id;

  const [local] = await db
    .insert(calendars)
    .values({
      householdId,
      name: 'Local',
      type: 'individual',
      isSynced: false,
      isReadOnly: false,
    })
    .returning();
  localCalendarId = local.id;
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('unlock', () => {
  it('leaves Outlook calendars read-only — they have no outbound path', async () => {
    const outlook = await db.query.calendars.findFirst({
      where: eq(calendars.id, outlookCalendarId),
    });
    expect(outlook!.isReadOnly).toBe(true);
  });

  it('refuses an ICS import into a synced calendar even once it is writable', async () => {
    await expect(
      importIcsToCalendar(googleCalendarId, householdId, 'BEGIN:VCALENDAR\nEND:VCALENDAR')
    ).rejects.toThrow(/synced/i);
  });

  it('still allows an ICS import into a local (non-synced) calendar', async () => {
    const result = await importIcsToCalendar(
      localCalendarId,
      householdId,
      'BEGIN:VCALENDAR\nEND:VCALENDAR'
    );
    expect(result).toEqual({ imported: 0, skipped: 0, errors: [] });
  });
});
