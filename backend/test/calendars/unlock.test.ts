import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendars, households } from '../../src/db/schema/index.js';
import { importIcsToCalendar } from '../../src/modules/calendars/ics.service.js';

let householdId: string;
let googleCalendarId: string;
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

// The Outlook-stays-read-only guarantee now lives at the route layer, in
// connect-writability.test.ts ("always connects read-only") and at the
// migration layer, in unlock-migration-scope.test.ts ("leaves a synced
// Outlook calendar locked") — both exercise real code paths rather than
// asserting a fixture back at itself. An earlier version of this file did
// the latter: insert a calendar with isReadOnly: true, then assert it reads
// back true. That's true regardless of anything this task changed — it
// would still pass if sync.routes.ts's Outlook branch were flipped to
// isReadOnly: false, since migrations had already run and no route was ever
// called. Removed rather than fixed in place, since the coverage it was
// gesturing at belongs where the actual behavior lives.
describe('unlock', () => {
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
