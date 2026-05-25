import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDAVClient, type DAVCalendar } from 'tsdav';
import { setupCalDavTest, type CalDavTestContext } from './harness.js';

/**
 * End-to-end smoke test driving the CalDAV server through a real client
 * library (tsdav). Covers the full happy path: discovery → list calendars →
 * create → fetch → update → delete. Catches protocol-level mismatches that
 * raw fetch tests miss (header capitalization, content-type negotiation,
 * XML namespace expectations, ETag handling).
 */

let ctx: CalDavTestContext;

beforeAll(async () => {
  ctx = await setupCalDavTest();
});

afterAll(async () => {
  await ctx?.close();
});

describe('tsdav client end-to-end smoke', () => {
  it('discovers calendars and round-trips an event via tsdav', async () => {
    const client = await createDAVClient({
      serverUrl: ctx.baseUrl,
      credentials: { username: ctx.email, password: ctx.appPasswordSecret },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    // Discovery + list — tsdav walks .well-known, principal, calendar-home.
    const calendars: DAVCalendar[] = await client.fetchCalendars();
    expect(calendars.length).toBeGreaterThan(0);
    const family = calendars.find((c) => c.displayName === 'Family Calendar');
    expect(family).toBeDefined();
    expect(family!.url).toContain(`/dav/calendars/${ctx.userId}/`);

    // Create an event via tsdav's createCalendarObject.
    const uid = randomUUID();
    const iCalString = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//tsdav-smoke//EN
BEGIN:VEVENT
UID:${uid}@homemanager
SUMMARY:tsdav smoke event
DTSTART:20271001T120000Z
DTEND:20271001T130000Z
DTSTAMP:20271001T000000Z
END:VEVENT
END:VCALENDAR
`;
    const createRes = await client.createCalendarObject({
      calendar: family!,
      filename: `${uid}.ics`,
      iCalString,
    });
    expect(createRes.ok).toBe(true);
    expect(createRes.status).toBeGreaterThanOrEqual(200);
    expect(createRes.status).toBeLessThan(300);

    // Fetch back via tsdav.
    const objects = await client.fetchCalendarObjects({ calendar: family! });
    const created = objects.find((o) => o.data?.includes('tsdav smoke event'));
    expect(created).toBeDefined();
    expect(created!.etag).toBeTruthy();
    expect(created!.data).toContain(`UID:${uid}@homemanager`);

    // Update via tsdav (sends If-Match with the previously-fetched ETag).
    const updatedICal = iCalString.replace('tsdav smoke event', 'tsdav smoke event v2');
    const updateRes = await client.updateCalendarObject({
      calendarObject: {
        ...created!,
        data: updatedICal,
      },
    });
    expect(updateRes.ok).toBe(true);

    // Re-fetch and confirm the change.
    const refetched = await client.fetchCalendarObjects({ calendar: family! });
    const updated = refetched.find((o) => o.data?.includes('tsdav smoke event v2'));
    expect(updated).toBeDefined();
    expect(updated!.etag).not.toBe(created!.etag);

    // Delete via tsdav.
    const deleteRes = await client.deleteCalendarObject({
      calendarObject: updated!,
    });
    expect(deleteRes.ok).toBe(true);

    // Confirm gone.
    const finalList = await client.fetchCalendarObjects({ calendar: family! });
    expect(finalList.find((o) => o.url === updated!.url)).toBeUndefined();
  }, 60_000); // 60s per test budget — argon2 per request adds up.
});
