import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { calendars, calendarEvents, calendarVisibility } from '../../db/schema/index.js';
import { eq, and, gte, lte, or } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { hexColorSchema, calendarTypeSchema, iCalRRuleSchema } from '../../lib/validators.js';

const createCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  color: hexColorSchema.default('#3B82F6'),
  pattern: z.string().max(50).default('solid'),
  type: calendarTypeSchema.default('individual'),
});

const updateCalendarSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  color: hexColorSchema.optional(),
  pattern: z.string().max(50).optional(),
});

const createEventSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  allDay: z.boolean().default(false),
  recurrenceRule: iCalRRuleSchema,
});

const updateEventSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  recurrenceRule: iCalRRuleSchema,
});

const dateRangeQuery = z.object({
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
});

export async function calendarsRoutes(app: FastifyInstance): Promise<void> {
  // List calendars
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const calendarList = await db.query.calendars.findMany({
        where: eq(calendars.householdId, request.user!.householdId),
        orderBy: (c, { asc }) => [asc(c.name)],
      });

      return { success: true, data: { calendars: calendarList } };
    }
  );

  // Create calendar
  app.post(
    '/',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createCalendarSchema.parse(request.body);

      const [calendar] = await db
        .insert(calendars)
        .values({
          householdId: request.user!.householdId,
          ownerId: input.type === 'individual' ? request.user!.id : null,
          name: input.name,
          color: input.color,
          pattern: input.pattern,
          type: input.type,
        })
        .returning();

      return { success: true, data: { calendar } };
    }
  );

  // Get calendar by ID
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.id),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      return { success: true, data: { calendar } };
    }
  );

  // Update calendar
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = updateCalendarSchema.parse(request.body);

      const [updated] = await db
        .update(calendars)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(calendars.id, request.params.id),
            eq(calendars.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Calendar');
      }

      return { success: true, data: { calendar: updated } };
    }
  );

  // Delete calendar
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(calendars)
        .where(
          and(
            eq(calendars.id, request.params.id),
            eq(calendars.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Calendar deleted' } };
    }
  );

  // Get events for a calendar
  app.get<{ Params: { calendarId: string }; Querystring: { start?: string; end?: string } }>(
    '/:calendarId/events',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { start, end } = dateRangeQuery.parse(request.query);

      const conditions = [eq(calendarEvents.calendarId, request.params.calendarId)];

      if (start) {
        conditions.push(gte(calendarEvents.endTime, start));
      }
      if (end) {
        conditions.push(lte(calendarEvents.startTime, end));
      }

      const events = await db.query.calendarEvents.findMany({
        where: and(...conditions),
        orderBy: (e, { asc }) => [asc(e.startTime)],
      });

      return { success: true, data: { events } };
    }
  );

  // Create event
  app.post<{ Params: { calendarId: string } }>(
    '/:calendarId/events',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createEventSchema.parse(request.body);

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      const [event] = await db
        .insert(calendarEvents)
        .values({
          calendarId: request.params.calendarId,
          title: input.title,
          description: input.description,
          startTime: input.startTime,
          endTime: input.endTime,
          allDay: input.allDay,
          recurrenceRule: input.recurrenceRule,
        })
        .returning();

      return { success: true, data: { event } };
    }
  );

  // Get event by ID
  app.get<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, request.params.id),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      return { success: true, data: { event } };
    }
  );

  // Update event
  app.patch<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = updateEventSchema.parse(request.body);

      const [updated] = await db
        .update(calendarEvents)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(calendarEvents.id, request.params.id),
            eq(calendarEvents.calendarId, request.params.calendarId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Event');
      }

      return { success: true, data: { event: updated } };
    }
  );

  // Delete event
  app.delete<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, request.params.id),
            eq(calendarEvents.calendarId, request.params.calendarId)
          )
        );

      return { success: true, data: { message: 'Event deleted' } };
    }
  );

  // Get all events across calendars (aggregated view)
  app.get(
    '/events',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { start, end } = dateRangeQuery.parse(request.query);

      // Get all calendar IDs for household
      const householdCalendars = await db.query.calendars.findMany({
        where: eq(calendars.householdId, request.user!.householdId),
        columns: { id: true },
      });

      const calendarIds = householdCalendars.map((c) => c.id);

      if (calendarIds.length === 0) {
        return { success: true, data: { events: [] } };
      }

      const conditions = [
        or(...calendarIds.map((id) => eq(calendarEvents.calendarId, id))),
      ];

      if (start) {
        conditions.push(gte(calendarEvents.endTime, new Date(start as any)));
      }
      if (end) {
        conditions.push(lte(calendarEvents.startTime, new Date(end as any)));
      }

      const events = await db.query.calendarEvents.findMany({
        where: and(...conditions),
        orderBy: (e, { asc }) => [asc(e.startTime)],
      });

      return { success: true, data: { events } };
    }
  );

  // Calendar visibility settings
  app.get<{ Params: { id: string } }>(
    '/:id/visibility',
    { preHandler: [authMiddleware] },
    async (request) => {
      const visibility = await db.query.calendarVisibility.findMany({
        where: eq(calendarVisibility.calendarId, request.params.id),
      });

      return { success: true, data: { visibility } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/:id/visibility',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { scopeType, scopeId, isVisible } = z
        .object({
          scopeType: z.enum(['user', 'device', 'household']),
          scopeId: z.string().uuid(),
          isVisible: z.boolean(),
        })
        .parse(request.body);

      // Upsert visibility setting
      const existing = await db.query.calendarVisibility.findFirst({
        where: and(
          eq(calendarVisibility.calendarId, request.params.id),
          eq(calendarVisibility.scopeType, scopeType),
          eq(calendarVisibility.scopeId, scopeId)
        ),
      });

      let result;
      if (existing) {
        [result] = await db
          .update(calendarVisibility)
          .set({ isVisible })
          .where(eq(calendarVisibility.id, existing.id))
          .returning();
      } else {
        [result] = await db
          .insert(calendarVisibility)
          .values({
            calendarId: request.params.id,
            scopeType,
            scopeId,
            isVisible,
          })
          .returning();
      }

      return { success: true, data: { visibility: result } };
    }
  );
}
