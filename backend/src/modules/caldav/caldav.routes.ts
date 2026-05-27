import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull, or } from 'drizzle-orm';
import { basicAuthMiddleware } from '../../middleware/basic-auth.middleware.js';
import { logger } from '../../lib/logger.js';
import { db } from '../../config/database.js';
import { calendarEvents, calendars } from '../../db/schema/index.js';
import {
  filterAccessibleCalendars,
  getEffectivePermission,
} from '../calendars/access.service.js';
import { eventEtag, getCalendarSyncState } from './sync.service.js';
import {
  applyPutBody,
  loadEventResource,
  parseEventUrlSlug,
  parsePutBody,
  renderEventResourceIcs,
} from './events.service.js';
import {
  escapeXml,
  multistatus,
  parsePropfindRequestedProps,
  response,
  wantsProp,
} from './xml.js';

/**
 * CalDAV server (RFC 4791 + WebDAV RFC 4918, RFC 6578 sync, RFC 6638 deferred).
 * Mounted at /dav/*. Authenticated via HTTP Basic against app_passwords —
 * cookie sessions are not accepted here.
 *
 * Fastify 4.x doesn't expose addHttpMethod (added in v5). We patch find-my-way's
 * supportedMethods array at registration time so Fastify accepts our custom
 * verbs (PROPFIND, REPORT, MKCALENDAR, etc.).
 */
const WEBDAV_METHODS = [
  'PROPFIND',
  'PROPPATCH',
  'REPORT',
  'MKCALENDAR',
  'MKCOL',
  'COPY',
  'MOVE',
] as const;

const DAV_HEADER_VALUE = '1, 2, 3, calendar-access';

function setDavHeaders(reply: FastifyReply): void {
  reply.header('DAV', DAV_HEADER_VALUE);
  reply.header('MS-Author-Via', 'DAV'); // Outlook/Exchange compat
}

async function registerWebDavMethods(app: FastifyInstance): Promise<void> {
  const maybe = app as unknown as { addHttpMethod?: (m: string, opts?: { hasBody?: boolean }) => void };
  if (typeof maybe.addHttpMethod === 'function') {
    for (const m of WEBDAV_METHODS) maybe.addHttpMethod(m, { hasBody: true });
    return;
  }
  // Fastify 4.x — reach into the router and add our methods to its
  // supportedMethods. find-my-way itself accepts arbitrary method strings;
  // the validation is in Fastify's `route()`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = (app as any).router ?? (app as any)[Symbol.for('fastify.router')];
  if (router && Array.isArray(router.supportedMethods)) {
    for (const m of WEBDAV_METHODS) {
      if (!router.supportedMethods.includes(m)) router.supportedMethods.push(m);
    }
  }
}

// URL helpers for the CalDAV namespace. Keep them in one place so the server
// composes outbound hrefs identically to how it parses inbound URLs.
const principalUrl = (userId: string): string => `/dav/principals/users/${userId}/`;
const calendarHomeUrl = (userId: string): string => `/dav/calendars/${userId}/`;
const calendarUrl = (userId: string, calendarId: string): string =>
  `/dav/calendars/${userId}/${calendarId}/`;

export async function caldavRoutes(app: FastifyInstance): Promise<void> {
  await registerWebDavMethods(app);

  // Content type parsers are registered globally in app.ts so this prefix
  // and /.well-known/caldav share the same XML/text/calendar handling.


  // ─── OPTIONS — capability advertisement ───────────────────────────────
  // Apple Calendar, macOS Calendar, DAVx5 all probe with OPTIONS first.
  // Without the DAV header, no client recognizes us as a CalDAV server.
  for (const url of ['/', '/principals/users/:userId/', '/calendars/:userId/', '/calendars/:userId/:calendarId/']) {
    app.route({
      method: 'OPTIONS',
      url,
      preHandler: [basicAuthMiddleware('caldav')],
      handler: async (_req: FastifyRequest, reply: FastifyReply) => {
        setDavHeaders(reply);
        reply.header(
          'Allow',
          'OPTIONS, GET, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL'
        );
        reply.code(200).send();
      },
    });
  }

  // ─── PROPFIND on /dav/ — discovery entrypoint ──────────────────────────
  // Returns current-user-principal so the client knows where to look next.
  app.route({
    method: 'PROPFIND' as never,
    url: '/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user!;
      const requested = parsePropfindRequestedProps(request.body as string | undefined);
      const props: string[] = [];
      if (wantsProp(requested, 'current-user-principal')) {
        props.push(
          `        <d:current-user-principal><d:href>${escapeXml(principalUrl(user.id))}</d:href></d:current-user-principal>\n`
        );
      }
      if (wantsProp(requested, 'principal-url')) {
        props.push(
          `        <d:principal-URL><d:href>${escapeXml(principalUrl(user.id))}</d:href></d:principal-URL>\n`
        );
      }
      if (wantsProp(requested, 'resourcetype')) {
        props.push(`        <d:resourcetype><d:collection/></d:resourcetype>\n`);
      }
      const xml = multistatus([
        response({ href: '/dav/', found: props.join('') }),
      ]);
      setDavHeaders(reply);
      reply.code(207).type('application/xml; charset=utf-8').send(xml);
    },
  });

  // ─── PROPFIND on /dav/principals/users/:userId/ — principal resource ──
  app.route({
    method: 'PROPFIND' as never,
    url: '/principals/users/:userId/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        // Don't enumerate other principals — return 403 before any property work.
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const requested = parsePropfindRequestedProps(request.body as string | undefined);
      const props: string[] = [];
      if (wantsProp(requested, 'resourcetype')) {
        props.push(`        <d:resourcetype><d:principal/><d:collection/></d:resourcetype>\n`);
      }
      if (wantsProp(requested, 'displayname')) {
        props.push(`        <d:displayname>${escapeXml(user.displayName || user.email)}</d:displayname>\n`);
      }
      if (wantsProp(requested, 'principal-url')) {
        props.push(
          `        <d:principal-URL><d:href>${escapeXml(principalUrl(user.id))}</d:href></d:principal-URL>\n`
        );
      }
      if (wantsProp(requested, 'current-user-principal')) {
        props.push(
          `        <d:current-user-principal><d:href>${escapeXml(principalUrl(user.id))}</d:href></d:current-user-principal>\n`
        );
      }
      if (wantsProp(requested, 'calendar-home-set')) {
        props.push(
          `        <c:calendar-home-set><d:href>${escapeXml(calendarHomeUrl(user.id))}</d:href></c:calendar-home-set>\n`
        );
      }
      if (wantsProp(requested, 'calendar-user-address-set')) {
        props.push(
          `        <c:calendar-user-address-set><d:href>mailto:${escapeXml(user.email)}</d:href></c:calendar-user-address-set>\n`
        );
      }
      const xml = multistatus([
        response({ href: principalUrl(user.id), found: props.join('') }),
      ]);
      setDavHeaders(reply);
      reply.code(207).type('application/xml; charset=utf-8').send(xml);
    },
  });

  // ─── PROPFIND on /dav/calendars/:userId/ — calendar home ──────────────
  // Depth: 0 returns the home collection itself; Depth: 1 enumerates the
  // user's calendars (owned + accessible via calendar_access rules).
  app.route({
    method: 'PROPFIND' as never,
    url: '/calendars/:userId/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const depth = (request.headers['depth'] as string | undefined) ?? '0';
      const requested = parsePropfindRequestedProps(request.body as string | undefined);

      const responses: string[] = [];
      // Self
      const selfProps: string[] = [];
      if (wantsProp(requested, 'resourcetype')) {
        selfProps.push(`        <d:resourcetype><d:collection/></d:resourcetype>\n`);
      }
      if (wantsProp(requested, 'displayname')) {
        selfProps.push(`        <d:displayname>Calendars</d:displayname>\n`);
      }
      responses.push(
        response({ href: calendarHomeUrl(user.id), found: selfProps.join('') })
      );

      if (depth !== '0') {
        const allHouseholdCalendars = await db.query.calendars.findMany({
          where: eq(calendars.householdId, user.householdId),
          columns: { id: true, name: true, color: true },
        });
        const accessMap = await filterAccessibleCalendars(
          user.id,
          user.householdId,
          allHouseholdCalendars.map((c) => c.id)
        );
        for (const cal of allHouseholdCalendars) {
          const level = accessMap.get(cal.id);
          if (!level) continue;
          const props: string[] = [];
          if (wantsProp(requested, 'resourcetype')) {
            props.push(
              `        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>\n`
            );
          }
          if (wantsProp(requested, 'displayname')) {
            props.push(`        <d:displayname>${escapeXml(cal.name)}</d:displayname>\n`);
          }
          if (wantsProp(requested, 'calendar-color')) {
            props.push(`        <a:calendar-color>${escapeXml(cal.color)}ff</a:calendar-color>\n`);
          }
          if (wantsProp(requested, 'supported-calendar-component-set')) {
            props.push(
              `        <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>\n`
            );
          }
          responses.push(
            response({ href: calendarUrl(user.id, cal.id), found: props.join('') })
          );
        }
      }

      const xml = multistatus(responses);
      setDavHeaders(reply);
      reply.code(207).type('application/xml; charset=utf-8').send(xml);
    },
  });

  // ─── Stubs for the rest (3e–3g will fill these in) ────────────────────
  const notImplemented = async (request: FastifyRequest, reply: FastifyReply) => {
    setDavHeaders(reply);
    logger.debug(
      { method: request.method, url: request.url, user: request.user?.email },
      'CalDAV method stubbed'
    );
    reply.code(501).send({
      error: 'Not Implemented',
      method: request.method,
      message: 'This CalDAV method is not yet implemented on this server.',
    });
  };

  // ─── GET event resource ────────────────────────────────────────────────
  app.route({
    method: 'GET',
    url: '/calendars/:userId/:calendarId/:eventUid',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string; eventUid: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const level = await getEffectivePermission(
        user.id,
        user.householdId,
        request.params.calendarId
      );
      if (!level || level === 'view_busy') {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const resourceId = parseEventUrlSlug(request.params.eventUid);
      const resource = await loadEventResource(request.params.calendarId, resourceId);
      if (!resource) {
        setDavHeaders(reply);
        reply.code(404).send();
        return;
      }
      const calendar = await db.query.calendars.findFirst({
        where: eq(calendars.id, request.params.calendarId),
        columns: { timezone: true },
      });
      const ics = renderEventResourceIcs(
        resource.master,
        resource.exceptions,
        calendar?.timezone ?? 'UTC',
        resource.attendeesByEventId,
        resource.remindersByEventId
      );
      setDavHeaders(reply);
      reply
        .header('ETag', eventEtag(resource.master.id, resource.master.revision))
        .type('text/calendar; charset=utf-8')
        .send(ics);
    },
  });

  // ─── PUT event resource (create or update) ────────────────────────────
  app.route({
    method: 'PUT',
    url: '/calendars/:userId/:calendarId/:eventUid',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string; eventUid: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const level = await getEffectivePermission(
        user.id,
        user.householdId,
        request.params.calendarId
      );
      if (level !== 'edit') {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const resourceId = parseEventUrlSlug(request.params.eventUid);
      const ifMatch = request.headers['if-match'] as string | undefined;
      const ifNoneMatch = request.headers['if-none-match'] as string | undefined;
      const existing = await loadEventResource(request.params.calendarId, resourceId);
      if (ifNoneMatch === '*' && existing) {
        setDavHeaders(reply);
        reply.code(412).send(); // Precondition Failed
        return;
      }
      if (ifMatch && existing) {
        const currentEtag = eventEtag(existing.master.id, existing.master.revision);
        if (ifMatch !== currentEtag && ifMatch !== '*') {
          setDavHeaders(reply);
          reply.code(412).send();
          return;
        }
      }
      const bodyText = request.body as string | undefined;
      if (!bodyText) {
        setDavHeaders(reply);
        reply.code(400).send({ error: 'Empty PUT body' });
        return;
      }
      let parsed;
      try {
        parsed = parsePutBody(bodyText);
      } catch (err) {
        setDavHeaders(reply);
        reply
          .code(400)
          .send({ error: 'Invalid VCALENDAR', detail: (err as Error).message });
        return;
      }
      const master = await applyPutBody(request.params.calendarId, resourceId, parsed);
      const newEtag = eventEtag(master.id, master.revision);
      setDavHeaders(reply);
      reply
        .header('ETag', newEtag)
        .code(existing ? 204 : 201)
        .send();
    },
  });

  // ─── DELETE event resource ────────────────────────────────────────────
  app.route({
    method: 'DELETE',
    url: '/calendars/:userId/:calendarId/:eventUid',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string; eventUid: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const level = await getEffectivePermission(
        user.id,
        user.householdId,
        request.params.calendarId
      );
      if (level !== 'edit') {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const resourceId = parseEventUrlSlug(request.params.eventUid);
      const existing = await loadEventResource(request.params.calendarId, resourceId);
      if (!existing) {
        setDavHeaders(reply);
        reply.code(404).send();
        return;
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      if (ifMatch && ifMatch !== '*') {
        const currentEtag = eventEtag(existing.master.id, existing.master.revision);
        if (ifMatch !== currentEtag) {
          setDavHeaders(reply);
          reply.code(412).send();
          return;
        }
      }
      // Cascade deletes exception rows. Triggers journal the change.
      await db.delete(calendarEvents).where(eq(calendarEvents.id, existing.master.id));
      setDavHeaders(reply);
      reply.code(204).send();
    },
  });
  // ─── REPORT — calendar-query, calendar-multiget, sync-collection ──────
  app.route({
    method: 'REPORT' as never,
    url: '/calendars/:userId/:calendarId/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const level = await getEffectivePermission(
        user.id,
        user.householdId,
        request.params.calendarId
      );
      if (!level) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const body = (request.body as string | undefined) ?? '';
      const lower = body.toLowerCase();
      const calendar = await db.query.calendars.findFirst({
        where: eq(calendars.id, request.params.calendarId),
      });
      if (!calendar || calendar.householdId !== user.householdId) {
        setDavHeaders(reply);
        reply.code(404).send();
        return;
      }
      const calHref = calendarUrl(user.id, calendar.id);

      if (lower.includes('<sync-collection') || lower.includes(':sync-collection')) {
        return handleSyncCollection(request, reply, calendar.id, calHref);
      }
      if (lower.includes('calendar-multiget')) {
        return handleCalendarMultiget(request, reply, calendar.id, calHref, body);
      }
      if (lower.includes('calendar-query')) {
        return handleCalendarQuery(request, reply, calendar.id, calHref, body, calendar.timezone);
      }
      if (lower.includes('free-busy-query')) {
        // Minimal stub: respond 200 OK with empty free-busy. Real free/busy
        // aggregation lands in a later iteration; this lets clients move on.
        setDavHeaders(reply);
        reply.code(200).type('text/calendar; charset=utf-8').send(
          `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Basis//CalDAV//EN\r\nBEGIN:VFREEBUSY\r\nEND:VFREEBUSY\r\nEND:VCALENDAR\r\n`
        );
        return;
      }
      setDavHeaders(reply);
      reply.code(400).send({ error: 'Unsupported REPORT' });
    },
  });

  // ─── PROPPATCH — update calendar properties (displayname, color) ──────
  app.route({
    method: 'PROPPATCH' as never,
    url: '/calendars/:userId/:calendarId/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const level = await getEffectivePermission(
        user.id,
        user.householdId,
        request.params.calendarId
      );
      if (level !== 'edit') {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const body = (request.body as string | undefined) ?? '';
      const updates: Partial<{ color: string }> = {};
      // displayname changes via PROPPATCH are REFUSED. iOS Calendar aggressively
      // renames synced calendars to mirror its local labels ("Home", "Family
      // Calendar", localization keys, etc.). The web UI is the source of truth
      // for calendar names — clients have to use the REST API to rename. We
      // signal this honestly to the client via per-property 403 in the
      // multistatus response (RFC 4918 §9.2.1) so iOS stops retrying.
      const dn = body.match(/<(?:[\w-]+:)?displayname>([^<]+)</i);
      const displaynameRequested = !!dn;
      const color = body.match(/<(?:[\w-]+:)?calendar-color>(#[0-9a-fA-F]{6,8})/);
      if (color) updates.color = color[1].slice(0, 7);

      if (Object.keys(updates).length) {
        await db
          .update(calendars)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(calendars.id, request.params.calendarId));
      }
      if (displaynameRequested) {
        logger.debug(
          { calendarId: request.params.calendarId, attemptedName: dn?.[1]?.trim() },
          'Refused PROPPATCH displayname (CalDAV clients cannot rename calendars)'
        );
      }
      const href = calendarUrl(user.id, request.params.calendarId);
      // Build a multistatus that splits per-property status: applied props get
      // 200 OK, refused props get 403 Forbidden. Mixed-status responses are
      // standard for PROPPATCH (RFC 4918 §9.2).
      const okProps = updates.color ? `        <a:calendar-color/>\n` : '';
      const forbiddenProps = displaynameRequested ? `        <d:displayname/>\n` : '';
      const propstats: string[] = [];
      if (okProps) {
        propstats.push(
          `    <d:propstat>\n      <d:prop>\n${okProps}      </d:prop>\n      <d:status>HTTP/1.1 200 OK</d:status>\n    </d:propstat>`
        );
      }
      if (forbiddenProps) {
        propstats.push(
          `    <d:propstat>\n      <d:prop>\n${forbiddenProps}      </d:prop>\n      <d:status>HTTP/1.1 403 Forbidden</d:status>\n      <d:responsedescription>Calendar names are managed via the Basis web UI; CalDAV clients cannot rename them.</d:responsedescription>\n    </d:propstat>`
        );
      }
      const xml = multistatus([
        `  <d:response>\n    <d:href>${escapeXml(href)}</d:href>\n${propstats.join('\n')}\n  </d:response>`,
      ]);
      setDavHeaders(reply);
      reply.code(207).type('application/xml; charset=utf-8').send(xml);
    },
  });
  // ─── MKCALENDAR — create a calendar collection ────────────────────────
  app.route({
    method: 'MKCALENDAR' as never,
    url: '/calendars/:userId/:calendarId/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const existing = await db.query.calendars.findFirst({
        where: eq(calendars.id, request.params.calendarId),
      });
      if (existing) {
        setDavHeaders(reply);
        reply.code(405).header('Allow', 'GET').send(); // Method Not Allowed
        return;
      }
      const body = (request.body as string | undefined) ?? '';
      const dn = body.match(/<(?:[\w-]+:)?displayname>([^<]+)</i);
      const color = body.match(/<(?:[\w-]+:)?calendar-color>(#[0-9a-fA-F]{6,8})/);
      const rawName = dn?.[1]?.trim();
      // Block iOS's habit of auto-creating Reminders/Tasks calendars on every
      // sync via MKCALENDAR with a localization key. We don't support VTODO
      // yet; pretending we do would just leave dead containers around.
      // Returning 403 makes iOS stop retrying; 409 would also work.
      if (rawName && isIosLocalizationKey(rawName)) {
        setDavHeaders(reply);
        reply
          .header('Content-Type', 'application/xml; charset=utf-8')
          .code(403)
          .send(`<?xml version="1.0" encoding="UTF-8"?>\n<error xmlns="DAV:"><cannot-modify-protected-property/></error>`);
        return;
      }
      const name = humanizeCalendarName(rawName || 'New Calendar');

      await db.insert(calendars).values({
        id: request.params.calendarId,
        householdId: user.householdId,
        ownerId: user.id,
        name,
        color: color?.[1]?.slice(0, 7) ?? '#3B82F6',
      });
      setDavHeaders(reply);
      reply.code(201).send();
    },
  });
  // ─── PROPFIND on a calendar collection ─────────────────────────────────
  // Depth 0: the calendar's own properties.
  // Depth 1: the calendar's properties + all event resources (with ETags).
  app.route({
    method: 'PROPFIND' as never,
    url: '/calendars/:userId/:calendarId/',
    preHandler: [basicAuthMiddleware('caldav')],
    handler: async (
      request: FastifyRequest<{ Params: { userId: string; calendarId: string } }>,
      reply: FastifyReply
    ) => {
      const user = request.user!;
      if (request.params.userId !== user.id) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const level = await getEffectivePermission(
        user.id,
        user.householdId,
        request.params.calendarId
      );
      if (!level) {
        setDavHeaders(reply);
        reply.code(403).send();
        return;
      }
      const calendar = await db.query.calendars.findFirst({
        where: eq(calendars.id, request.params.calendarId),
      });
      if (!calendar || calendar.householdId !== user.householdId) {
        setDavHeaders(reply);
        reply.code(404).send();
        return;
      }
      const depth = (request.headers['depth'] as string | undefined) ?? '0';
      const requested = parsePropfindRequestedProps(request.body as string | undefined);
      const syncState = await getCalendarSyncState(calendar.id);
      const calHref = calendarUrl(user.id, calendar.id);

      const calProps: string[] = [];
      if (wantsProp(requested, 'resourcetype')) {
        calProps.push(`        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>\n`);
      }
      if (wantsProp(requested, 'displayname')) {
        calProps.push(`        <d:displayname>${escapeXml(calendar.name)}</d:displayname>\n`);
      }
      if (wantsProp(requested, 'calendar-description')) {
        calProps.push(`        <c:calendar-description></c:calendar-description>\n`);
      }
      if (wantsProp(requested, 'calendar-color')) {
        calProps.push(`        <a:calendar-color>${escapeXml(calendar.color)}ff</a:calendar-color>\n`);
      }
      if (wantsProp(requested, 'calendar-timezone')) {
        calProps.push(
          `        <c:calendar-timezone>BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nBEGIN:VTIMEZONE\\r\\nTZID:${escapeXml(calendar.timezone)}\\r\\nEND:VTIMEZONE\\r\\nEND:VCALENDAR</c:calendar-timezone>\n`
        );
      }
      if (wantsProp(requested, 'supported-calendar-component-set')) {
        calProps.push(
          `        <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>\n`
        );
      }
      if (wantsProp(requested, 'getctag')) {
        calProps.push(`        <cs:getctag>${escapeXml(syncState.ctag)}</cs:getctag>\n`);
      }
      if (wantsProp(requested, 'sync-token')) {
        calProps.push(
          `        <d:sync-token>http://homemanager/sync/${syncState.syncToken}</d:sync-token>\n`
        );
      }
      if (wantsProp(requested, 'current-user-privilege-set')) {
        calProps.push(privilegeSetXml(level));
      }
      if (wantsProp(requested, 'owner')) {
        calProps.push(
          `        <d:owner><d:href>${escapeXml(principalUrl(user.id))}</d:href></d:owner>\n`
        );
      }

      const responses = [response({ href: calHref, found: calProps.join('') })];

      if (depth !== '0') {
        const events = await db.query.calendarEvents.findMany({
          where: and(
            eq(calendarEvents.calendarId, calendar.id),
            // Only master rows or non-recurring rows — exceptions are bundled with their masters.
            or(
              isNull(calendarEvents.recurringEventId),
              eq(calendarEvents.recurrenceStatus, 'master')
            )
          ),
          columns: { id: true, revision: true },
        });
        for (const ev of events) {
          const eventProps: string[] = [];
          const etag = eventEtag(ev.id, ev.revision);
          if (wantsProp(requested, 'getetag')) {
            eventProps.push(`        <d:getetag>${escapeXml(etag)}</d:getetag>\n`);
          }
          if (wantsProp(requested, 'getcontenttype')) {
            eventProps.push(
              `        <d:getcontenttype>text/calendar; charset=utf-8; component=VEVENT</d:getcontenttype>\n`
            );
          }
          if (wantsProp(requested, 'resourcetype')) {
            eventProps.push(`        <d:resourcetype/>\n`);
          }
          responses.push(
            response({
              href: `${calHref}${ev.id}.ics`,
              found: eventProps.join(''),
            })
          );
        }
      }

      setDavHeaders(reply);
      reply.code(207).type('application/xml; charset=utf-8').send(multistatus(responses));
    },
  });
}

/**
 * iOS Calendar sends localization keys (e.g. "DEFAULT_TASK_CALENDAR_NAME")
 * in MKCALENDAR + PROPPATCH instead of real names — it expects clients to
 * translate them locally. Web UI users see the raw key, which looks broken.
 * Map known keys to friendly defaults; leave anything else alone.
 */
const IOS_NAME_TRANSLATIONS: Record<string, string> = {
  DEFAULT_TASK_CALENDAR_NAME: 'Reminders',
  DEFAULT_CALENDAR_NAME: 'iPhone Calendar',
  HOME_CALENDAR: 'iPhone Home',
  WORK_CALENDAR: 'iPhone Work',
  PERSONAL_CALENDAR: 'iPhone Personal',
};
function humanizeCalendarName(raw: string): string {
  if (IOS_NAME_TRANSLATIONS[raw]) return IOS_NAME_TRANSLATIONS[raw];
  // Anything that looks like an all-caps placeholder key → generic fallback.
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(raw)) return 'iPhone Calendar';
  return raw;
}

function isIosLocalizationKey(raw: string): boolean {
  return raw in IOS_NAME_TRANSLATIONS || /^[A-Z][A-Z0-9_]{4,}$/.test(raw);
}

// ─── REPORT handlers ────────────────────────────────────────────────────

async function handleSyncCollection(
  request: FastifyRequest,
  reply: FastifyReply,
  calendarId: string,
  calHref: string
): Promise<void> {
  const body = (request.body as string | undefined) ?? '';
  // Sync token format: "http://homemanager/sync/<integer>" or just the integer.
  let since = 0;
  const tokenMatch = body.match(/<sync-token[^>]*>(.*?)<\/[\w-]*:?sync-token>/i);
  if (tokenMatch?.[1]) {
    const m = tokenMatch[1].match(/(\d+)/);
    since = m ? parseInt(m[1], 10) : 0;
  }
  const { listChangesSince, getCalendarSyncState } = await import('./sync.service.js');
  const changes = await listChangesSince(calendarId, since);
  const syncState = await getCalendarSyncState(calendarId);

  // Collapse multiple entries per UID to the latest state.
  const latest = new Map<string, (typeof changes)[number]>();
  for (const c of changes) latest.set(c.eventUid, c);

  const responses: string[] = [];
  for (const c of latest.values()) {
    const href = `${calHref}${c.eventUid}.ics`;
    if (c.changeType === 'delete') {
      responses.push(
        `  <d:response>\n    <d:href>${escapeXml(href)}</d:href>\n    <d:status>HTTP/1.1 404 Not Found</d:status>\n  </d:response>`
      );
    } else {
      const ev = await db.query.calendarEvents.findFirst({
        where: eq(calendarEvents.id, c.eventUid),
        columns: { id: true, revision: true },
      });
      if (!ev) continue;
      const etag = eventEtag(ev.id, ev.revision);
      responses.push(
        response({
          href,
          found: `        <d:getetag>${escapeXml(etag)}</d:getetag>\n`,
        })
      );
    }
  }
  // Append the new sync-token at the end.
  const tail = `  <d:sync-token>http://homemanager/sync/${syncState.syncToken}</d:sync-token>`;
  const xml = multistatus(responses) + tail;
  setDavHeaders(reply);
  reply.code(207).type('application/xml; charset=utf-8').send(xml);
}

async function handleCalendarMultiget(
  request: FastifyRequest,
  reply: FastifyReply,
  calendarId: string,
  _calHref: string,
  body: string
): Promise<void> {
  // Parse <d:href>...</d:href> elements
  const hrefs: string[] = [];
  const hrefRe = /<[\w-]+:?href[^>]*>([^<]+)<\/[\w-]+:?href>/gi;
  for (const m of body.matchAll(hrefRe)) {
    hrefs.push(m[1].trim());
  }
  const responses: string[] = [];
  for (const href of hrefs) {
    const slug = href.split('/').pop() ?? '';
    const resourceId = slug.replace(/\.ics$/i, '');
    const resource = await db.query.calendarEvents.findFirst({
      where: and(eq(calendarEvents.id, resourceId), eq(calendarEvents.calendarId, calendarId)),
    });
    if (!resource) {
      responses.push(
        `  <d:response>\n    <d:href>${escapeXml(href)}</d:href>\n    <d:status>HTTP/1.1 404 Not Found</d:status>\n  </d:response>`
      );
      continue;
    }
    const { loadEventResource, renderEventResourceIcs } = await import('./events.service.js');
    const r = await loadEventResource(calendarId, resourceId);
    if (!r) {
      responses.push(
        `  <d:response>\n    <d:href>${escapeXml(href)}</d:href>\n    <d:status>HTTP/1.1 404 Not Found</d:status>\n  </d:response>`
      );
      continue;
    }
    const calendarRow = await db.query.calendars.findFirst({
      where: eq(calendars.id, calendarId),
      columns: { timezone: true },
    });
    const ics = renderEventResourceIcs(
      r.master,
      r.exceptions,
      calendarRow?.timezone ?? 'UTC',
      r.attendeesByEventId,
      r.remindersByEventId
    );
    const etag = eventEtag(r.master.id, r.master.revision);
    responses.push(
      response({
        href,
        found:
          `        <d:getetag>${escapeXml(etag)}</d:getetag>\n` +
          `        <c:calendar-data>${escapeXml(ics)}</c:calendar-data>\n`,
      })
    );
  }
  setDavHeaders(reply);
  reply.code(207).type('application/xml; charset=utf-8').send(multistatus(responses));
}

async function handleCalendarQuery(
  request: FastifyRequest,
  reply: FastifyReply,
  calendarId: string,
  calHref: string,
  body: string,
  calendarTimezone: string
): Promise<void> {
  // Extract time-range start/end if present (handles `<time-range>` or `<c:time-range>`).
  const tr = body.match(/<(?:[\w-]+:)?time-range\s+start="([^"]+)"\s+end="([^"]+)"/i);
  const start = tr ? parseIcsDate(tr[1]) : null;
  const end = tr ? parseIcsDate(tr[2]) : null;

  const masters = await db.query.calendarEvents.findMany({
    where: and(
      eq(calendarEvents.calendarId, calendarId),
      // Only master/standalone rows; exceptions bundled at render time.
      or(
        isNull(calendarEvents.recurringEventId),
        eq(calendarEvents.recurrenceStatus, 'master')
      )
    ),
  });

  const responses: string[] = [];
  for (const m of masters) {
    if (start && end) {
      // Cheap pre-filter for non-recurring events. Recurring events: include
      // if RRULE expansion is needed (we don't filter precisely here — the
      // client can re-filter on its end).
      if (!m.recurrenceRule) {
        if (new Date(m.endTime) < start) continue;
        if (new Date(m.startTime) > end) continue;
      }
    }
    const { loadEventResource, renderEventResourceIcs } = await import('./events.service.js');
    const r = await loadEventResource(calendarId, m.id);
    if (!r) continue;
    const ics = renderEventResourceIcs(
      r.master,
      r.exceptions,
      calendarTimezone,
      r.attendeesByEventId,
      r.remindersByEventId
    );
    const etag = eventEtag(r.master.id, r.master.revision);
    const href = `${calHref}${m.id}.ics`;
    responses.push(
      response({
        href,
        found:
          `        <d:getetag>${escapeXml(etag)}</d:getetag>\n` +
          `        <c:calendar-data>${escapeXml(ics)}</c:calendar-data>\n`,
      })
    );
  }

  setDavHeaders(reply);
  reply.code(207).type('application/xml; charset=utf-8').send(multistatus(responses));
}

function parseIcsDate(s: string): Date {
  // Accept either basic "20260601T120000Z" or ISO format.
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  }
  return new Date(s);
}

function privilegeSetXml(level: 'view_busy' | 'view' | 'edit'): string {
  const privileges: string[] = [];
  if (level === 'view_busy') {
    privileges.push('<d:read-free-busy/>');
  } else if (level === 'view') {
    privileges.push('<d:read/>');
  } else {
    privileges.push('<d:read/>', '<d:write/>', '<d:write-content/>', '<d:write-properties/>');
  }
  const inner = privileges.map((p) => `          <d:privilege>${p}</d:privilege>`).join('\n');
  return `        <d:current-user-privilege-set>\n${inner}\n        </d:current-user-privilege-set>\n`;
}

/**
 * .well-known/caldav — RFC 6764 service discovery endpoint. Apple Calendar
 * and other auto-discovery clients hit this before they know the real URL.
 * Returns 301 to the canonical /dav/ root so the client follows the rewrite.
 *
 * iOS specifically sends PROPFIND (not GET) here and includes a body, so we
 * need the content-type parser (registered globally) to accept it. We use an
 * explicit code+Location header send instead of reply.redirect() so the
 * redirect is method-agnostic.
 */
export async function caldavWellKnownRoutes(app: FastifyInstance): Promise<void> {
  app.route({
    method: ['GET', 'PROPFIND' as never],
    url: '/caldav',
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('DAV', DAV_HEADER_VALUE);
      reply.header('Location', '/dav/').code(301).send();
    },
  });
}

/**
 * iOS Calendar (and some other clients) probe a handful of common CalDAV root
 * paths even after seeing the .well-known redirect. Catching them here as
 * permanent redirects into /dav/ keeps the discovery walk on the happy path
 * instead of bailing with a "cannot connect" error.
 *
 * Registered at the root app level (no prefix) since these paths live outside
 * /dav and /.well-known by design — they're the legacy/historical URLs that
 * pre-RFC-6764 clients still try.
 */
export async function caldavRootProbeRoutes(app: FastifyInstance): Promise<void> {
  // Don't register GET on these — the SPA root (`/`) needs to render normally.
  // PROPFIND is what CalDAV clients use, plus OPTIONS for capability probing.
  const probes: { from: string; to: string }[] = [
    { from: '/', to: '/dav/' },
    { from: '/principals', to: '/dav/principals/' },
    { from: '/principals/', to: '/dav/principals/' },
    { from: '/calendar', to: '/dav/' },
    { from: '/calendar/', to: '/dav/' },
    { from: '/caldav', to: '/dav/' },
    { from: '/caldav/', to: '/dav/' },
  ];
  for (const { from, to } of probes) {
    app.route({
      method: ['PROPFIND' as never, 'OPTIONS'],
      url: from,
      handler: async (_req: FastifyRequest, reply: FastifyReply) => {
        reply.header('DAV', DAV_HEADER_VALUE);
        reply.header('Location', to).code(301).send();
      },
    });
  }
}
