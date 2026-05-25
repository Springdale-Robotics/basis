import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { basicAuth, setupCalDavTest, type CalDavTestContext } from './harness.js';

let ctx: CalDavTestContext;

beforeAll(async () => {
  ctx = await setupCalDavTest();
});

afterAll(async () => {
  await ctx?.close();
});

describe('CalDAV skeleton (Phase 3a)', () => {
  it('responds to OPTIONS / with the DAV capability header', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/`, {
      method: 'OPTIONS',
      headers: { Authorization: basicAuth(ctx.email, ctx.appPasswordSecret) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('dav')).toContain('calendar-access');
    expect(res.headers.get('allow')).toMatch(/PROPFIND/);
  });

  it('rejects unauthenticated OPTIONS with 401 + WWW-Authenticate', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/`, { method: 'OPTIONS' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic/);
  });

  it('rejects Basic auth with a bogus password', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/`, {
      method: 'OPTIONS',
      headers: { Authorization: basicAuth(ctx.email, 'not-a-real-password') },
    });
    expect(res.status).toBe(401);
  });

  it('redirects .well-known/caldav to /dav/', async () => {
    const res = await fetch(`${ctx.baseUrl}/.well-known/caldav`, {
      method: 'GET',
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/dav/');
  });

  it('PROPPATCH applies color but refuses displayname rename', async () => {
    const { db } = await import('../../src/config/database.js');
    const { calendars } = await import('../../src/db/schema/index.js');
    const { eq } = await import('drizzle-orm');

    // Capture pre-state so we can assert the name was NOT changed.
    const before = await db.query.calendars.findFirst({
      where: eq(calendars.id, ctx.calendarId),
      columns: { name: true, color: true },
    });

    const res = await fetch(`${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`, {
      method: 'PROPPATCH',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0"?>
<propertyupdate xmlns="DAV:" xmlns:a="http://apple.com/ns/ical/">
  <set><prop>
    <displayname>iOS Hijack Attempt</displayname>
    <a:calendar-color>#FF8800</a:calendar-color>
  </prop></set>
</propertyupdate>`,
    });
    expect(res.status).toBe(207);
    const body = await res.text();
    // Color applied with 200 OK, displayname refused with 403 Forbidden.
    expect(body).toMatch(/<a:calendar-color\/>[\s\S]*HTTP\/1\.1 200 OK/);
    expect(body).toMatch(/<d:displayname\/>[\s\S]*HTTP\/1\.1 403 Forbidden/);

    // Confirm DB: color updated, name untouched.
    const after = await db.query.calendars.findFirst({
      where: eq(calendars.id, ctx.calendarId),
      columns: { name: true, color: true },
    });
    expect(after?.name).toBe(before?.name);
    expect(after?.color).toBe('#FF8800');

    // Revert color
    await db
      .update(calendars)
      .set({ color: before?.color ?? '#3B82F6' })
      .where(eq(calendars.id, ctx.calendarId));
  });

  it('PROPFIND on /dav/ returns 207 multistatus with current-user-principal', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>',
    });
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain('<d:multistatus');
    expect(body).toContain('current-user-principal');
    expect(body).toContain(`/dav/principals/users/${ctx.userId}/`);
  });

  it('PROPFIND on principal returns calendar-home-set', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/principals/users/${ctx.userId}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><c:calendar-home-set/></prop></propfind>',
    });
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain('calendar-home-set');
    expect(body).toContain(`/dav/calendars/${ctx.userId}/`);
  });

  it('PROPFIND on calendar home (Depth 1) lists the user’s calendars', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/calendars/${ctx.userId}/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        Depth: '1',
        'Content-Type': 'application/xml',
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><displayname/><resourcetype/></prop></propfind>',
    });
    expect(res.status).toBe(207);
    const body = await res.text();
    // Calendar home itself
    expect(body).toContain(`<d:href>/dav/calendars/${ctx.userId}/</d:href>`);
    // At least one calendar collection
    expect(body).toContain(`<d:href>/dav/calendars/${ctx.userId}/${ctx.calendarId}/`);
    expect(body).toContain('<c:calendar/>');
  });

  it('PROPFIND on a calendar collection (Depth 0) returns calendar properties', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`,
      {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
          Depth: '0',
          'Content-Type': 'application/xml',
        },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><prop><displayname/><resourcetype/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token xmlns:d="DAV:"/></prop></propfind>',
      }
    );
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain('<d:displayname>Family Calendar</d:displayname>');
    expect(body).toContain('<c:calendar/>');
    expect(body).toContain('<c:comp name="VEVENT"/>');
    expect(body).toContain('<cs:getctag>');
    expect(body).toContain('<d:sync-token>http://homemanager/sync/');
  });

  it('PROPFIND on a calendar collection (Depth 1) enumerates events with ETags', async () => {
    // Seed an event directly so we have something to enumerate.
    const { db } = await import('../../src/config/database.js');
    const { calendarEvents } = await import('../../src/db/schema/index.js');
    const [event] = await db
      .insert(calendarEvents)
      .values({
        calendarId: ctx.calendarId,
        title: 'PROPFIND enum test',
        startTime: new Date('2026-06-15T12:00:00Z'),
        endTime: new Date('2026-06-15T13:00:00Z'),
      })
      .returning();

    const res = await fetch(
      `${ctx.baseUrl}/dav/calendars/${ctx.userId}/${ctx.calendarId}/`,
      {
        method: 'PROPFIND',
        headers: {
          Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
          Depth: '1',
          'Content-Type': 'application/xml',
        },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><getetag/><getcontenttype/></prop></propfind>',
      }
    );
    expect(res.status).toBe(207);
    const body = await res.text();
    expect(body).toContain(`<d:href>/dav/calendars/${ctx.userId}/${ctx.calendarId}/${event.id}.ics</d:href>`);
    expect(body).toMatch(/<d:getetag>(?:"|&quot;)[^<]+(?:"|&quot;)<\/d:getetag>/);
    expect(body).toContain('component=VEVENT');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
  });

  it('PROPFIND on a different user returns 403', async () => {
    const res = await fetch(`${ctx.baseUrl}/dav/principals/users/00000000-0000-0000-0000-000000000000/`, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuth(ctx.email, ctx.appPasswordSecret),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>',
    });
    expect(res.status).toBe(403);
  });
});
