import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendarEvents } from '../../src/db/schema/index.js';
import { basicAuth, setupCalDavTest, type CalDavTestContext } from './harness.js';

/**
 * CalDAV cross-household isolation. CalDAV now runs under the same RLS context
 * as the cookie API (household resolved from the app-password), so one
 * household's credentials must not read another's calendar — enforced by both
 * the app-level access checks and the DB policies.
 */

let A: CalDavTestContext;
let B: CalDavTestContext;

beforeAll(async () => {
  A = await setupCalDavTest();
  B = await setupCalDavTest();
  await db.insert(calendarEvents).values({
    calendarId: B.calendarId,
    title: "B's private event",
    startTime: new Date('2026-07-15T10:00:00Z'),
    endTime: new Date('2026-07-15T11:00:00Z'),
  });
});

afterAll(async () => {
  // Delete events before close(): the household cascade + calendar_changes sync
  // trigger otherwise conflict when a calendar with events is dropped (a
  // pre-existing harness quirk, unrelated to RLS).
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, B.calendarId));
  await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, A.calendarId));
  await A.close();
  await B.close();
});

describe('CalDAV cross-household isolation', () => {
  it("household A's credentials cannot REPORT household B's calendar", async () => {
    const res = await fetch(`${A.baseUrl}/dav/calendars/${B.userId}/${B.calendarId}/`, {
      method: 'REPORT',
      headers: {
        Authorization: basicAuth(A.email, A.appPasswordSecret),
        'Content-Type': 'application/xml',
        Depth: '1',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>
</c:calendar-query>`,
    });
    // Denied (403/404) or an empty multistatus — never B's event data.
    const body = await res.text();
    expect(res.status).not.toBe(200);
    expect(body).not.toContain("B's private event");
  });

  it("household A's own calendar still works (positive control)", async () => {
    const res = await fetch(`${A.baseUrl}/dav/calendars/${A.userId}/${A.calendarId}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuth(A.email, A.appPasswordSecret),
        'Content-Type': 'application/xml',
        Depth: '0',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>`,
    });
    expect(res.status).toBe(207);
  });
});
