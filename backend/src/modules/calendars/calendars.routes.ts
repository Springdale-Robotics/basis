import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  calendars,
  calendarEvents,
  calendarVisibility,
  eventAttendees,
  eventReminders,
  users,
} from '../../db/schema/index.js';
import { eq, and, gte, lte, or, inArray, ilike, sql } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { hexColorSchema, calendarTypeSchema, iCalRRuleSchema } from '../../lib/validators.js';
import { emitCalendarEvent } from '../../websocket/events.js';
import { logger } from '../../lib/logger.js';
import {
  parseIcsContent,
  importIcsToCalendar,
  exportCalendarToIcs,
  exportAllCalendarsToIcs,
} from './ics.service.js';

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
  location: z.string().max(500).optional(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date(),
  allDay: z.boolean().default(false),
  color: hexColorSchema.optional(),
  recurrenceRule: iCalRRuleSchema,
  attendees: z.array(z.object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    displayName: z.string().max(255).optional(),
  })).optional(),
  reminders: z.array(z.object({
    type: z.enum(['notification', 'email', 'push']).default('notification'),
    minutesBefore: z.number().int().min(0).max(40320), // Max 4 weeks
  })).optional(),
});

const updateEventSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  location: z.string().max(500).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  color: hexColorSchema.optional().nullable(),
  recurrenceRule: iCalRRuleSchema,
});

const rsvpStatusSchema = z.enum(['pending', 'accepted', 'declined', 'maybe']);

const addAttendeeSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  displayName: z.string().max(255).optional(),
}).refine(data => data.userId || data.email, {
  message: 'Either userId or email is required',
});

const addReminderSchema = z.object({
  type: z.enum(['notification', 'email', 'push']).default('notification'),
  minutesBefore: z.number().int().min(0).max(40320),
});

const searchEventsSchema = z.object({
  q: z.string().min(1).optional(),
  calendarIds: z.string().optional(), // Comma-separated calendar IDs
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
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
      logger.info({ calendarId: request.params.id }, 'Delete calendar request received');

      // First check if calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.id),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        logger.warn({ calendarId: request.params.id }, 'Calendar not found for deletion');
        throw Errors.notFound('Calendar');
      }

      // Prevent deletion of synced calendars (use disconnect instead)
      if (calendar.isSynced) {
        logger.warn({ calendarId: request.params.id }, 'Attempted to delete synced calendar');
        throw Errors.forbidden('Cannot delete synced calendar. Disconnect it first.');
      }

      logger.info({ calendarId: request.params.id, calendarName: calendar.name }, 'Deleting calendar');

      await db
        .delete(calendars)
        .where(eq(calendars.id, request.params.id));

      logger.info({ calendarId: request.params.id }, 'Calendar deleted successfully');

      // Emit WebSocket event to notify other clients
      try {
        emitCalendarEvent(request.user!.householdId, {
          eventId: '',
          calendarId: request.params.id,
          action: 'deleted',
        });
      } catch (e) {
        logger.error({ error: e, calendarId: request.params.id }, 'Failed to emit calendar delete event');
      }

      const response = { success: true, data: { message: 'Calendar deleted' } };
      logger.info({ calendarId: request.params.id, response }, 'Returning delete response');
      return response;
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

      // Check if calendar is read-only
      if (calendar.isReadOnly) {
        throw Errors.forbidden('Calendar is read-only');
      }

      const [event] = await db
        .insert(calendarEvents)
        .values({
          calendarId: request.params.calendarId,
          createdById: request.user!.id,
          title: input.title,
          description: input.description,
          location: input.location,
          startTime: input.startTime,
          endTime: input.endTime,
          allDay: input.allDay,
          color: input.color,
          recurrenceRule: input.recurrenceRule,
        })
        .returning();

      // Add attendees if provided
      if (input.attendees && input.attendees.length > 0) {
        const attendeeValues = input.attendees.map((attendee) => ({
          eventId: event.id,
          userId: attendee.userId,
          email: attendee.email,
          displayName: attendee.displayName,
          isOrganizer: false,
        }));

        // Add organizer as attendee
        attendeeValues.unshift({
          eventId: event.id,
          userId: request.user!.id,
          email: undefined,
          displayName: undefined,
          isOrganizer: true,
        });

        await db.insert(eventAttendees).values(attendeeValues);
      }

      // Add reminders if provided
      if (input.reminders && input.reminders.length > 0) {
        const reminderValues = input.reminders.map((reminder) => ({
          eventId: event.id,
          userId: request.user!.id,
          reminderType: reminder.type,
          minutesBefore: reminder.minutesBefore,
        }));

        await db.insert(eventReminders).values(reminderValues);
      }

      // Emit WebSocket event
      emitCalendarEvent(request.user!.householdId, {
        eventId: event.id,
        calendarId: event.calendarId,
        action: 'created',
        event: event as Record<string, unknown>,
      });

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

      // Verify calendar exists and is not read-only
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      if (calendar.isReadOnly) {
        throw Errors.forbidden('Calendar is read-only');
      }

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

      // Emit WebSocket event
      emitCalendarEvent(request.user!.householdId, {
        eventId: updated.id,
        calendarId: updated.calendarId,
        action: 'updated',
        event: updated as Record<string, unknown>,
      });

      return { success: true, data: { event: updated } };
    }
  );

  // Delete event
  app.delete<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      // Verify calendar exists and is not read-only
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      if (calendar.isReadOnly) {
        throw Errors.forbidden('Calendar is read-only');
      }

      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, request.params.id),
            eq(calendarEvents.calendarId, request.params.calendarId)
          )
        );

      // Emit WebSocket event
      emitCalendarEvent(request.user!.householdId, {
        eventId: request.params.id,
        calendarId: request.params.calendarId,
        action: 'deleted',
      });

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

  // ========== Event Attendees (Invitations & RSVP) ==========

  // Get attendees for an event
  app.get<{ Params: { calendarId: string; eventId: string } }>(
    '/:calendarId/events/:eventId/attendees',
    { preHandler: [authMiddleware] },
    async (request) => {
      const attendees = await db.query.eventAttendees.findMany({
        where: eq(eventAttendees.eventId, request.params.eventId),
        orderBy: (a, { desc }) => [desc(a.isOrganizer), a.displayName],
      });

      // Fetch user details for attendees with userId
      const userIds = attendees
        .filter((a) => a.userId)
        .map((a) => a.userId as string);

      let userMap: Record<string, { displayName: string; email: string; avatarUrl?: string }> = {};
      if (userIds.length > 0) {
        const userRecords = await db.query.users.findMany({
          where: inArray(users.id, userIds),
          columns: { id: true, displayName: true, email: true, avatarUrl: true },
        });
        userMap = Object.fromEntries(
          userRecords.map((u) => [u.id, { displayName: u.displayName, email: u.email, avatarUrl: u.avatarUrl || undefined }])
        );
      }

      const enrichedAttendees = attendees.map((a) => ({
        ...a,
        user: a.userId ? userMap[a.userId] : null,
      }));

      return { success: true, data: { attendees: enrichedAttendees } };
    }
  );

  // Add attendee to event
  app.post<{ Params: { calendarId: string; eventId: string } }>(
    '/:calendarId/events/:eventId/attendees',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = addAttendeeSchema.parse(request.body);

      // Verify event exists
      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, request.params.eventId),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      // Check if attendee already exists
      const existingAttendee = await db.query.eventAttendees.findFirst({
        where: and(
          eq(eventAttendees.eventId, request.params.eventId),
          input.userId
            ? eq(eventAttendees.userId, input.userId)
            : eq(eventAttendees.email, input.email!)
        ),
      });

      if (existingAttendee) {
        throw Errors.conflict('Attendee already invited');
      }

      const [attendee] = await db
        .insert(eventAttendees)
        .values({
          eventId: request.params.eventId,
          userId: input.userId,
          email: input.email,
          displayName: input.displayName,
        })
        .returning();

      return { success: true, data: { attendee } };
    }
  );

  // Update RSVP status
  app.patch<{ Params: { calendarId: string; eventId: string; attendeeId: string } }>(
    '/:calendarId/events/:eventId/attendees/:attendeeId/rsvp',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { status } = z.object({ status: rsvpStatusSchema }).parse(request.body);

      // Verify the attendee belongs to the current user
      const attendee = await db.query.eventAttendees.findFirst({
        where: and(
          eq(eventAttendees.id, request.params.attendeeId),
          eq(eventAttendees.eventId, request.params.eventId)
        ),
      });

      if (!attendee) {
        throw Errors.notFound('Attendee');
      }

      // Only allow user to update their own RSVP (unless admin)
      if (attendee.userId !== request.user!.id && request.user!.role !== 'admin') {
        throw Errors.forbidden('You can only update your own RSVP');
      }

      const [updated] = await db
        .update(eventAttendees)
        .set({
          rsvpStatus: status,
          rsvpAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(eventAttendees.id, request.params.attendeeId))
        .returning();

      return { success: true, data: { attendee: updated } };
    }
  );

  // Remove attendee from event
  app.delete<{ Params: { calendarId: string; eventId: string; attendeeId: string } }>(
    '/:calendarId/events/:eventId/attendees/:attendeeId',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(eventAttendees)
        .where(
          and(
            eq(eventAttendees.id, request.params.attendeeId),
            eq(eventAttendees.eventId, request.params.eventId)
          )
        );

      return { success: true, data: { message: 'Attendee removed' } };
    }
  );

  // ========== Event Reminders ==========

  // Get reminders for an event
  app.get<{ Params: { calendarId: string; eventId: string } }>(
    '/:calendarId/events/:eventId/reminders',
    { preHandler: [authMiddleware] },
    async (request) => {
      const reminders = await db.query.eventReminders.findMany({
        where: and(
          eq(eventReminders.eventId, request.params.eventId),
          eq(eventReminders.userId, request.user!.id)
        ),
        orderBy: (r, { asc }) => [asc(r.minutesBefore)],
      });

      return { success: true, data: { reminders } };
    }
  );

  // Add reminder to event
  app.post<{ Params: { calendarId: string; eventId: string } }>(
    '/:calendarId/events/:eventId/reminders',
    { preHandler: [authMiddleware] },
    async (request) => {
      const input = addReminderSchema.parse(request.body);

      // Verify event exists
      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, request.params.eventId),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      const [reminder] = await db
        .insert(eventReminders)
        .values({
          eventId: request.params.eventId,
          userId: request.user!.id,
          reminderType: input.type,
          minutesBefore: input.minutesBefore,
        })
        .returning();

      return { success: true, data: { reminder } };
    }
  );

  // Delete reminder
  app.delete<{ Params: { calendarId: string; eventId: string; reminderId: string } }>(
    '/:calendarId/events/:eventId/reminders/:reminderId',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(eventReminders)
        .where(
          and(
            eq(eventReminders.id, request.params.reminderId),
            eq(eventReminders.eventId, request.params.eventId),
            eq(eventReminders.userId, request.user!.id)
          )
        );

      return { success: true, data: { message: 'Reminder deleted' } };
    }
  );

  // ========== Search ==========

  // Search events across calendars
  app.get(
    '/events/search',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { q, calendarIds, start, end, limit, offset } = searchEventsSchema.parse(request.query);

      // Get all calendar IDs for household
      const householdCalendars = await db.query.calendars.findMany({
        where: eq(calendars.householdId, request.user!.householdId),
        columns: { id: true },
      });

      let targetCalendarIds = householdCalendars.map((c) => c.id);

      // Filter by specified calendar IDs if provided
      if (calendarIds) {
        const specifiedIds = calendarIds.split(',').map((id) => id.trim());
        targetCalendarIds = targetCalendarIds.filter((id) => specifiedIds.includes(id));
      }

      if (targetCalendarIds.length === 0) {
        return { success: true, data: { events: [], total: 0 } };
      }

      const conditions = [
        inArray(calendarEvents.calendarId, targetCalendarIds),
      ];

      // Add text search if query provided
      if (q) {
        conditions.push(
          or(
            ilike(calendarEvents.title, `%${q}%`),
            ilike(calendarEvents.description, `%${q}%`),
            ilike(calendarEvents.location, `%${q}%`)
          )!
        );
      }

      // Add date range filters
      if (start) {
        conditions.push(gte(calendarEvents.endTime, start));
      }
      if (end) {
        conditions.push(lte(calendarEvents.startTime, end));
      }

      const events = await db.query.calendarEvents.findMany({
        where: and(...conditions),
        orderBy: (e, { asc }) => [asc(e.startTime)],
        limit,
        offset,
      });

      // Get total count for pagination
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(calendarEvents)
        .where(and(...conditions));

      return { success: true, data: { events, total: count } };
    }
  );

  // ========== Get Event with Details ==========

  // Get event with attendees and reminders
  app.get<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id/details',
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

      // Get attendees
      const attendees = await db.query.eventAttendees.findMany({
        where: eq(eventAttendees.eventId, request.params.id),
      });

      // Get user's reminders
      const reminders = await db.query.eventReminders.findMany({
        where: and(
          eq(eventReminders.eventId, request.params.id),
          eq(eventReminders.userId, request.user!.id)
        ),
      });

      // Get creator info
      let creator = null;
      if (event.createdById) {
        creator = await db.query.users.findFirst({
          where: eq(users.id, event.createdById),
          columns: { id: true, displayName: true, email: true, avatarUrl: true },
        });
      }

      return {
        success: true,
        data: {
          event: {
            ...event,
            creator,
            attendees,
            reminders,
          },
        },
      };
    }
  );

  // ========== ICS Import/Export ==========

  // Import events from ICS file
  app.post<{ Params: { id: string } }>(
    '/:id/import',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      // Get multipart file
      const data = await request.file();
      if (!data) {
        throw Errors.badRequest('No file uploaded');
      }

      // Read file content
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const icsContent = Buffer.concat(chunks).toString('utf-8');

      // Validate it's an ICS file
      if (!icsContent.includes('BEGIN:VCALENDAR')) {
        throw Errors.badRequest('Invalid ICS file');
      }

      // Import events
      const result = await importIcsToCalendar(
        request.params.id,
        request.user!.householdId,
        icsContent,
        {
          skipDuplicates: true,
          createdById: request.user!.id,
        }
      );

      return {
        success: true,
        data: result,
      };
    }
  );

  // Export calendar to ICS file
  app.get<{ Params: { id: string }; Querystring: { start?: string; end?: string } }>(
    '/:id/export',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const startDate = request.query.start ? new Date(request.query.start) : undefined;
      const endDate = request.query.end ? new Date(request.query.end) : undefined;

      const { content, filename } = await exportCalendarToIcs(
        request.params.id,
        request.user!.householdId,
        { startDate, endDate }
      );

      reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    }
  );

  // Export all calendars to ICS file
  app.get(
    '/export/all',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { content, filename } = await exportAllCalendarsToIcs(
        request.user!.householdId
      );

      reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    }
  );
}
