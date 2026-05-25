import { randomUUID } from 'crypto';
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

function eventUrl(calendarId: string, eventId: string): string {
  return `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${calendarId}/${eventId}.ics`;
}

// iCalendar line folding wraps lines past column 75 with a continuation
// space. Unfold so regex assertions can match values that span lines.
function unfold(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, '');
}

const sampleIcs = (uid: string, title: string) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:${uid}
SUMMARY:${title}
DTSTART:20260601T120000Z
DTEND:20260601T130000Z
DTSTAMP:20260601T000000Z
END:VEVENT
END:VCALENDAR
`;

describe('CalDAV event resources (Phase 3e)', () => {
  it('PUT creates a new event, GET returns it, DELETE removes it', async () => {
    const resourceId = '11111111-2222-3333-4444-555555555555';
    const putUrl = eventUrl(ctx.calendarId, resourceId);

    // PUT (create)
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'Roundtrip event'),
    });
    expect([201, 204]).toContain(putRes.status);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();

    // GET
    const getRes = await fetch(putUrl, {
      method: 'GET',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toMatch(/text\/calendar/);
    const body = await getRes.text();
    expect(body).toContain('SUMMARY:Roundtrip event');
    expect(body).toContain(`UID:${resourceId}@homemanager`);
    expect(getRes.headers.get('etag')).toBe(etag);

    // DELETE
    const delRes = await fetch(putUrl, {
      method: 'DELETE',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
    expect(delRes.status).toBe(204);

    // GET 404 after delete
    const getAfter = await fetch(putUrl, {
      method: 'GET',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
    expect(getAfter.status).toBe(404);
  });

  it('PUT with If-None-Match: * rejects when resource already exists', async () => {
    const resourceId = '22222222-2222-3333-4444-555555555555';
    const url = eventUrl(ctx.calendarId, resourceId);

    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'Original'),
    });

    const second = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'Conflict'),
    });
    expect(second.status).toBe(412);

    // Cleanup
    await db.delete(calendarEvents).where(eq(calendarEvents.id, resourceId));
  });

  it('PUT with stale If-Match returns 412', async () => {
    const resourceId = '33333333-2222-3333-4444-555555555555';
    const url = eventUrl(ctx.calendarId, resourceId);
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'v1'),
    });

    const stale = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-Match': '"not-the-real-etag"',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'v2'),
    });
    expect(stale.status).toBe(412);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, resourceId));
  });

  it('PUT update bumps the ETag', async () => {
    const resourceId = '44444444-2222-3333-4444-555555555555';
    const url = eventUrl(ctx.calendarId, resourceId);

    const create = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'v1'),
    });
    const etag1 = create.headers.get('etag');

    const update = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-Match': etag1 ?? '',
      },
      body: sampleIcs(`${resourceId}@homemanager`, 'v2'),
    });
    expect(update.status).toBe(204);
    const etag2 = update.headers.get('etag');
    expect(etag2).toBeTruthy();
    expect(etag2).not.toBe(etag1);

    await db.delete(calendarEvents).where(eq(calendarEvents.id, resourceId));
  });

  it('ATTENDEE round-trip preserves email, CN, PARTSTAT, ROLE', async () => {
    const resourceId = randomUUID();
    const url = eventUrl(ctx.calendarId, resourceId);
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:${resourceId}@homemanager
SUMMARY:Family dinner
DTSTART:20260901T180000Z
DTEND:20260901T190000Z
DTSTAMP:20260901T000000Z
ORGANIZER;CN=Sam:mailto:sam@example.com
ATTENDEE;CN=Sam;PARTSTAT=ACCEPTED;ROLE=CHAIR;RSVP=TRUE:mailto:sam@example.com
ATTENDEE;CN=Alex;PARTSTAT=TENTATIVE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:alex@example.com
END:VEVENT
END:VCALENDAR
`;
    const put = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: ics,
    });
    expect(put.status).toBe(201);

    const get = await fetch(url, {
      method: 'GET',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
    expect(get.status).toBe(200);
    const body = unfold(await get.text());
    expect(body).toMatch(/ATTENDEE[^\r\n]*sam@example\.com/);
    expect(body).toMatch(/ATTENDEE[^\r\n]*alex@example\.com/);
    expect(body).toMatch(/PARTSTAT=ACCEPTED/);
    expect(body).toMatch(/PARTSTAT=TENTATIVE/);
    expect(body).toMatch(/ROLE=CHAIR/);
    expect(body).toMatch(/ROLE=REQ-PARTICIPANT/);
    expect(body).toMatch(/CN=Sam/);
    expect(body).toMatch(/CN=Alex/);

    // Cleanup
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
  });

  it('VALARM round-trip preserves trigger minutes + action', async () => {
    const resourceId = randomUUID();
    const url = eventUrl(ctx.calendarId, resourceId);
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:${resourceId}@homemanager
SUMMARY:Dentist
DTSTART:20261001T090000Z
DTEND:20261001T100000Z
DTSTAMP:20261001T000000Z
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
DESCRIPTION:Dentist soon
END:VALARM
BEGIN:VALARM
TRIGGER:-PT1H
ACTION:EMAIL
DESCRIPTION:Dentist later
END:VALARM
END:VEVENT
END:VCALENDAR
`;
    const put = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'text/calendar',
        'If-None-Match': '*',
      },
      body: ics,
    });
    expect(put.status).toBe(201);

    const get = await fetch(url, {
      method: 'GET',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
    expect(get.status).toBe(200);
    const body = unfold(await get.text());
    // Two VALARM blocks should survive
    const valarmCount = (body.match(/BEGIN:VALARM/g) ?? []).length;
    expect(valarmCount).toBe(2);
    // Triggers normalized to ICAL's preferred form — accept either compact or
    // expanded duration as long as 15 minutes / 1 hour are conveyed.
    expect(body).toMatch(/TRIGGER[^]*(-PT15M|-PT0H15M)/);
    expect(body).toMatch(/TRIGGER[^]*(-PT1H|-PT60M)/);
    expect(body).toMatch(/ACTION:DISPLAY/);
    expect(body).toMatch(/ACTION:EMAIL/);

    // Cleanup
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
  });
});
