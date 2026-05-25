import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { basicAuth, setupCalDavTest, type CalDavTestContext } from './harness.js';
import { db } from '../../src/config/database.js';
import { calendarEvents } from '../../src/db/schema/index.js';

let ctx: CalDavTestContext;

beforeAll(async () => {
  ctx = await setupCalDavTest();
});

afterAll(async () => {
  await ctx?.close();
});

describe('CalDAV REPORTs (Phase 3f)', () => {
  it('calendar-query with time-range returns matching events with calendar-data', async () => {
    // Clean slate so leftover events from other tests don't bleed in.
    await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, ctx.calendarId));

    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'In range',
        startTime: new Date('2026-07-10T10:00:00Z'),
        endTime: new Date('2026-07-10T11:00:00Z'),
      })
      .returning();
    const [outOfRange] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Out of range',
        startTime: new Date('2027-01-01T10:00:00Z'),
        endTime: new Date('2027-01-01T11:00:00Z'),
      })
      .returning();

    const res = await fetch(
      `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`,
      {
        method: 'REPORT',
        headers: {
          Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
          'Content-Type': 'application/xml',
          Depth: '1',
        },
        body: `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="20260701T000000Z" end="20260731T235959Z"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
      }
    );
    expect(res.status).toBe(207);
    const body = await res.text();
    if (body.includes(`/${outOfRange.id}.ics`)) {
      const idx = body.indexOf(outOfRange.id);
      console.error('OOR id at offset', idx, '|context:', body.slice(Math.max(0, idx - 100), idx + 400));
    }
    expect(body).toContain(`/dav/calendars/${ctx.userId}/${ctx.calendarId}/${event.id}.ics`);
    expect(body).toContain('calendar-data');
    expect(body).not.toContain(`/${outOfRange.id}.ics`);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
    await db.delete(calendarEvents).where(eq(calendarEvents.id, outOfRange.id));
  });

  it('sync-collection returns deltas since the client token', async () => {
    // Capture initial token
    const initial = await fetch(
      `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`,
      {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
          'Content-Type': 'application/xml',
          Depth: '0',
        },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><sync-token/></prop></propfind>',
      }
    );
    const initialBody = await initial.text();
    const m = initialBody.match(/<d:sync-token>([^<]+)<\/d:sync-token>/);
    const startToken = m?.[1] ?? 'http://homemanager/sync/0';

    // Add an event after the snapshot
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Delta event',
        startTime: new Date('2026-08-15T10:00:00Z'),
        endTime: new Date('2026-08-15T11:00:00Z'),
      })
      .returning();

    const res = await fetch(
      `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`,
      {
        method: 'REPORT',
        headers: {
          Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
          'Content-Type': 'application/xml',
          Depth: '1',
        },
        body: `<?xml version="1.0"?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token>${startToken}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/></d:prop>
</d:sync-collection>`,
      }
    );
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain(`/${event.id}.ics`);
    expect(body).toMatch(/<d:sync-token>http:\/\/homemanager\/sync\/\d+<\/d:sync-token>/);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('calendar-multiget returns the requested resources', async () => {
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'Multiget target',
        startTime: new Date('2026-09-01T10:00:00Z'),
        endTime: new Date('2026-09-01T11:00:00Z'),
      })
      .returning();
    const href = `/dav/calendars/${ctx.userId}/${ctx.calendarId}/${event.id}.ics`;
    const res = await fetch(
      `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`,
      {
        method: 'REPORT',
        headers: {
          Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
          'Content-Type': 'application/xml',
        },
        body: `<?xml version="1.0"?>
<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <d:href>${href}</d:href>
</c:calendar-multiget>`,
      }
    );
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain(href);
    expect(body).toContain('SUMMARY:Multiget target');

    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });
});
