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
import { eq, and, gte, lte, or, inArray, ilike, sql, isNull, isNotNull } from 'drizzle-orm';
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
import {
  expandRecurrence,
  createVirtualInstance,
  addExDate,
  truncateRRule,
  presetToRRule,
  parseInstanceId,
  isRecurringMaster,
} from './recurrence.service.js';

const createCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  color: hexColorSchema.default('#3B82F6'),
  colorIndex: z.number().int().min(0).max(11).default(0),
  pattern: z.string().max(50).default('solid'),
  type: calendarTypeSchema.default('individual'),
});

const updateCalendarSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  color: hexColorSchema.optional(),
  colorIndex: z.number().int().min(0).max(11).optional(),
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
  // Scope for editing recurring events: 'single' | 'all' | 'following'
  scope: z.enum(['single', 'all', 'following']).optional(),
  // Original start time for identifying the instance when editing a single occurrence
  originalStartTime: z.coerce.date().optional(),
});

const deleteEventSchema = z.object({
  // Scope for deleting recurring events: 'single' | 'all' | 'following'
  scope: z.enum(['single', 'all', 'following']).optional(),
  // Original start time for identifying the instance when deleting a single occurrence
  originalStartTime: z.coerce.date().optional(),
});

const createExceptionSchema = z.object({
  originalStartTime: z.coerce.date(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  location: z.string().max(500).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  color: hexColorSchema.optional().nullable(),
  cancelled: z.boolean().optional(),
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
  expandRecurring: z.coerce.boolean().optional().default(true),
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
          colorIndex: input.colorIndex,
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

  // Get events for a calendar (with recurrence expansion)
  app.get<{ Params: { calendarId: string }; Querystring: { start?: string; end?: string; expandRecurring?: string } }>(
    '/:calendarId/events',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { start, end, expandRecurring } = dateRangeQuery.parse(request.query);

      // Get all master events and non-recurring events
      // For recurring events, include masters that may have instances in the range
      const baseConditions = [
        eq(calendarEvents.calendarId, request.params.calendarId),
        // Exclude exception instances - they'll be handled during expansion
        or(
          isNull(calendarEvents.recurringEventId),
          eq(calendarEvents.recurrenceStatus, 'master')
        ),
      ];

      // Non-recurring events: filter by date range normally
      // Recurring events: include if they could have instances in the range
      const dateConditions = start && end ? or(
        // Non-recurring events in the date range
        and(
          isNull(calendarEvents.recurrenceRule),
          gte(calendarEvents.endTime, start),
          lte(calendarEvents.startTime, end)
        ),
        // Recurring masters that started before the end of our range
        and(
          isNotNull(calendarEvents.recurrenceRule),
          lte(calendarEvents.startTime, end)
        )
      ) : undefined;

      const events = await db.query.calendarEvents.findMany({
        where: and(...baseConditions, dateConditions),
        orderBy: (e, { asc }) => [asc(e.startTime)],
      });

      // If not expanding recurring events, return as-is
      if (!expandRecurring || !start || !end) {
        return { success: true, data: { events } };
      }

      // Get all exception instances for recurring events in this calendar
      const masterEventIds = events
        .filter(e => e.recurrenceRule && isRecurringMaster(e))
        .map(e => e.id);

      let exceptions: typeof events = [];
      if (masterEventIds.length > 0) {
        exceptions = await db.query.calendarEvents.findMany({
          where: and(
            eq(calendarEvents.calendarId, request.params.calendarId),
            inArray(calendarEvents.recurringEventId, masterEventIds)
          ),
        });
      }

      // Expand recurring events
      const expandedEvents: any[] = [];

      for (const event of events) {
        if (event.recurrenceRule && isRecurringMaster(event)) {
          // Get exceptions for this master event
          const eventExceptions = exceptions.filter(ex => ex.recurringEventId === event.id);

          // Expand recurrence
          const instances = expandRecurrence(event, start, end, eventExceptions);

          for (const instance of instances) {
            if (instance.isCancelled) {
              // Skip cancelled instances
              continue;
            }

            if (instance.exceptionEvent) {
              // Use the exception event data
              expandedEvents.push({
                ...instance.exceptionEvent,
                isVirtualInstance: false,
                masterId: event.id,
                masterEvent: event,
              });
            } else {
              // Create virtual instance with reference to master event
              const virtualInstance = createVirtualInstance(event, instance.date);
              expandedEvents.push({
                ...virtualInstance,
                masterEvent: event,
              });
            }
          }
        } else {
          // Non-recurring event
          expandedEvents.push(event);
        }
      }

      // Sort by start time
      expandedEvents.sort((a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      return { success: true, data: { events: expandedEvents } };
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
      // Check if this is a virtual instance ID (masterId_timestamp)
      const instanceInfo = parseInstanceId(request.params.id);
      const eventId = instanceInfo ? instanceInfo.masterId : request.params.id;

      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      // If this is a virtual instance, adjust the times
      if (instanceInfo) {
        const duration = new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
        const instanceDate = new Date(instanceInfo.timestamp);
        return {
          success: true,
          data: {
            event: {
              ...event,
              id: request.params.id, // Keep the virtual instance ID
              startTime: instanceDate,
              endTime: new Date(instanceDate.getTime() + duration),
              isVirtualInstance: true,
              masterId: eventId,
            },
          },
        };
      }

      return { success: true, data: { event } };
    }
  );

  // Update event (with recurring event scope support)
  app.patch<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = updateEventSchema.parse(request.body);
      const { scope, originalStartTime, ...updateData } = input;

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

      // Check if this is a virtual instance ID (masterId_timestamp)
      const instanceInfo = parseInstanceId(request.params.id);

      // Get the event (or master event if virtual instance)
      const eventId = instanceInfo ? instanceInfo.masterId : request.params.id;
      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      // Handle recurring event updates based on scope
      if (event.recurrenceRule && isRecurringMaster(event)) {
        const effectiveScope = scope || 'all';
        const instanceDate = instanceInfo
          ? new Date(instanceInfo.timestamp)
          : originalStartTime || new Date(event.startTime);

        if (effectiveScope === 'single') {
          // Create an exception for this single instance
          const [exception] = await db
            .insert(calendarEvents)
            .values({
              calendarId: event.calendarId,
              createdById: request.user!.id,
              title: updateData.title || event.title,
              description: updateData.description !== undefined ? updateData.description : event.description,
              location: updateData.location !== undefined ? updateData.location : event.location,
              startTime: updateData.startTime || instanceDate,
              endTime: updateData.endTime || new Date(instanceDate.getTime() + (new Date(event.endTime).getTime() - new Date(event.startTime).getTime())),
              allDay: updateData.allDay !== undefined ? updateData.allDay : event.allDay,
              color: updateData.color !== undefined ? updateData.color : event.color,
              recurringEventId: event.id,
              originalStartTime: instanceDate,
              recurrenceStatus: 'exception',
            })
            .returning();

          // Emit WebSocket event
          emitCalendarEvent(request.user!.householdId, {
            eventId: exception.id,
            calendarId: exception.calendarId,
            action: 'created',
            event: exception as Record<string, unknown>,
          });

          return { success: true, data: { event: exception } };
        } else if (effectiveScope === 'following') {
          // Truncate the original event's RRULE to end before this instance
          const truncatedRule = truncateRRule(event.recurrenceRule, new Date(instanceDate.getTime() - 86400000));

          // Update the original master event with truncated rule
          await db
            .update(calendarEvents)
            .set({
              recurrenceRule: truncatedRule,
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, event.id));

          // Create a new recurring event starting from this instance
          const [newEvent] = await db
            .insert(calendarEvents)
            .values({
              calendarId: event.calendarId,
              createdById: request.user!.id,
              title: updateData.title || event.title,
              description: updateData.description !== undefined ? updateData.description : event.description,
              location: updateData.location !== undefined ? updateData.location : event.location,
              startTime: updateData.startTime || instanceDate,
              endTime: updateData.endTime || new Date(instanceDate.getTime() + (new Date(event.endTime).getTime() - new Date(event.startTime).getTime())),
              allDay: updateData.allDay !== undefined ? updateData.allDay : event.allDay,
              color: updateData.color !== undefined ? updateData.color : event.color,
              recurrenceRule: updateData.recurrenceRule || event.recurrenceRule,
              recurrenceStatus: 'master',
            })
            .returning();

          // Delete future exceptions from the original event that are after this date
          await db
            .delete(calendarEvents)
            .where(
              and(
                eq(calendarEvents.recurringEventId, event.id),
                gte(calendarEvents.originalStartTime, instanceDate)
              )
            );

          // Emit WebSocket events
          emitCalendarEvent(request.user!.householdId, {
            eventId: event.id,
            calendarId: event.calendarId,
            action: 'updated',
            event: { ...event, recurrenceRule: truncatedRule } as Record<string, unknown>,
          });

          emitCalendarEvent(request.user!.householdId, {
            eventId: newEvent.id,
            calendarId: newEvent.calendarId,
            action: 'created',
            event: newEvent as Record<string, unknown>,
          });

          return { success: true, data: { event: newEvent } };
        }
        // scope === 'all' falls through to regular update below
      }

      // Regular update (non-recurring or 'all' scope)
      const [updated] = await db
        .update(calendarEvents)
        .set({ ...updateData, updatedAt: new Date() })
        .where(
          and(
            eq(calendarEvents.id, event.id),
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

  // Delete event (with recurring event scope support)
  app.delete<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = deleteEventSchema.parse(request.body || {});
      const { scope, originalStartTime } = input;

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

      // Check if this is a virtual instance ID (masterId_timestamp)
      const instanceInfo = parseInstanceId(request.params.id);

      // Get the event (or master event if virtual instance)
      const eventId = instanceInfo ? instanceInfo.masterId : request.params.id;
      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      // Handle recurring event deletions based on scope
      if (event.recurrenceRule && isRecurringMaster(event)) {
        const effectiveScope = scope || 'all';
        const instanceDate = instanceInfo
          ? new Date(instanceInfo.timestamp)
          : originalStartTime || new Date(event.startTime);

        if (effectiveScope === 'single') {
          // Add EXDATE to exclude this single instance
          const newExDates = addExDate(event.recurrenceExDates, instanceDate);

          await db
            .update(calendarEvents)
            .set({
              recurrenceExDates: newExDates,
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, event.id));

          // Also delete any exception for this instance
          await db
            .delete(calendarEvents)
            .where(
              and(
                eq(calendarEvents.recurringEventId, event.id),
                eq(calendarEvents.originalStartTime, instanceDate)
              )
            );

          // Emit WebSocket event
          emitCalendarEvent(request.user!.householdId, {
            eventId: event.id,
            calendarId: event.calendarId,
            action: 'updated',
            event: { ...event, recurrenceExDates: newExDates } as Record<string, unknown>,
          });

          return { success: true, data: { message: 'Instance deleted' } };
        } else if (effectiveScope === 'following') {
          // Truncate RRULE with UNTIL before this instance
          const truncatedRule = truncateRRule(event.recurrenceRule, new Date(instanceDate.getTime() - 86400000));

          // Update master event with truncated rule
          await db
            .update(calendarEvents)
            .set({
              recurrenceRule: truncatedRule,
              updatedAt: new Date(),
            })
            .where(eq(calendarEvents.id, event.id));

          // Delete all exceptions on or after this date
          await db
            .delete(calendarEvents)
            .where(
              and(
                eq(calendarEvents.recurringEventId, event.id),
                gte(calendarEvents.originalStartTime, instanceDate)
              )
            );

          // Emit WebSocket event
          emitCalendarEvent(request.user!.householdId, {
            eventId: event.id,
            calendarId: event.calendarId,
            action: 'updated',
            event: { ...event, recurrenceRule: truncatedRule } as Record<string, unknown>,
          });

          return { success: true, data: { message: 'This and following events deleted' } };
        }
        // scope === 'all' falls through to delete master event below
      }

      // Delete the event (and cascade to exceptions if it's a master)
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, event.id),
            eq(calendarEvents.calendarId, request.params.calendarId)
          )
        );

      // Emit WebSocket event
      emitCalendarEvent(request.user!.householdId, {
        eventId: event.id,
        calendarId: request.params.calendarId,
        action: 'deleted',
      });

      return { success: true, data: { message: 'Event deleted' } };
    }
  );

  // Create exception for a recurring event instance
  app.post<{ Params: { calendarId: string; id: string } }>(
    '/:calendarId/events/:id/exceptions',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createExceptionSchema.parse(request.body);

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

      // Get the master event
      const masterEvent = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, request.params.id),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!masterEvent) {
        throw Errors.notFound('Event');
      }

      if (!masterEvent.recurrenceRule || !isRecurringMaster(masterEvent)) {
        throw Errors.badRequest('Event is not a recurring master event');
      }

      // Check if exception already exists for this instance
      const existingException = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.recurringEventId, masterEvent.id),
          eq(calendarEvents.originalStartTime, input.originalStartTime)
        ),
      });

      if (existingException) {
        throw Errors.conflict('Exception already exists for this instance');
      }

      // Create the exception
      const duration = new Date(masterEvent.endTime).getTime() - new Date(masterEvent.startTime).getTime();
      const [exception] = await db
        .insert(calendarEvents)
        .values({
          calendarId: masterEvent.calendarId,
          createdById: request.user!.id,
          title: input.title || masterEvent.title,
          description: input.description !== undefined ? input.description : masterEvent.description,
          location: input.location !== undefined ? input.location : masterEvent.location,
          startTime: input.startTime || input.originalStartTime,
          endTime: input.endTime || new Date(input.originalStartTime.getTime() + duration),
          allDay: input.allDay !== undefined ? input.allDay : masterEvent.allDay,
          color: input.color !== undefined ? input.color : masterEvent.color,
          recurringEventId: masterEvent.id,
          originalStartTime: input.originalStartTime,
          recurrenceStatus: input.cancelled ? 'cancelled' : 'exception',
        })
        .returning();

      // Emit WebSocket event
      emitCalendarEvent(request.user!.householdId, {
        eventId: exception.id,
        calendarId: exception.calendarId,
        action: 'created',
        event: exception as Record<string, unknown>,
      });

      return { success: true, data: { exception } };
    }
  );

  // Delete a single instance of a recurring event (by original start time)
  app.delete<{ Params: { calendarId: string; id: string; originalStartTime: string } }>(
    '/:calendarId/events/:id/instances/:originalStartTime',
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

      // Get the master event
      const masterEvent = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, request.params.id),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!masterEvent) {
        throw Errors.notFound('Event');
      }

      if (!masterEvent.recurrenceRule || !isRecurringMaster(masterEvent)) {
        throw Errors.badRequest('Event is not a recurring master event');
      }

      const instanceDate = new Date(request.params.originalStartTime);

      // Add EXDATE to exclude this instance
      const newExDates = addExDate(masterEvent.recurrenceExDates, instanceDate);

      await db
        .update(calendarEvents)
        .set({
          recurrenceExDates: newExDates,
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, masterEvent.id));

      // Delete any existing exception for this instance
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.recurringEventId, masterEvent.id),
            eq(calendarEvents.originalStartTime, instanceDate)
          )
        );

      // Emit WebSocket event
      emitCalendarEvent(request.user!.householdId, {
        eventId: masterEvent.id,
        calendarId: masterEvent.calendarId,
        action: 'updated',
        event: { ...masterEvent, recurrenceExDates: newExDates } as Record<string, unknown>,
      });

      return { success: true, data: { message: 'Instance cancelled' } };
    }
  );

  // Get all events across calendars (aggregated view with recurrence expansion)
  app.get(
    '/events',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { start, end, expandRecurring } = dateRangeQuery.parse(request.query);

      // Get all calendar IDs for household
      const householdCalendars = await db.query.calendars.findMany({
        where: eq(calendars.householdId, request.user!.householdId),
        columns: { id: true },
      });

      const calendarIds = householdCalendars.map((c) => c.id);

      if (calendarIds.length === 0) {
        return { success: true, data: { events: [] } };
      }

      // Build conditions excluding exception instances
      // For recurring events, we need to include masters that may have instances in the range
      // even if the master's start date is before the range
      const baseConditions = [
        inArray(calendarEvents.calendarId, calendarIds),
        or(
          isNull(calendarEvents.recurringEventId),
          eq(calendarEvents.recurrenceStatus, 'master')
        ),
      ];

      // Non-recurring events: filter by date range normally
      // Recurring events: include if they could have instances in the range
      const dateConditions = start && end ? or(
        // Non-recurring events in the date range
        and(
          isNull(calendarEvents.recurrenceRule),
          gte(calendarEvents.endTime, new Date(start as any)),
          lte(calendarEvents.startTime, new Date(end as any))
        ),
        // Recurring masters that started before the end of our range
        // (we'll filter their instances during expansion)
        and(
          isNotNull(calendarEvents.recurrenceRule),
          lte(calendarEvents.startTime, new Date(end as any))
        )
      ) : undefined;

      const events = await db.query.calendarEvents.findMany({
        where: and(...baseConditions, dateConditions),
        orderBy: (e, { asc }) => [asc(e.startTime)],
      });

      // If not expanding recurring events, return as-is
      if (!expandRecurring || !start || !end) {
        return { success: true, data: { events } };
      }

      // Get all exception instances for recurring events
      const masterEventIds = events
        .filter(e => e.recurrenceRule && isRecurringMaster(e))
        .map(e => e.id);

      let exceptions: typeof events = [];
      if (masterEventIds.length > 0) {
        exceptions = await db.query.calendarEvents.findMany({
          where: and(
            inArray(calendarEvents.calendarId, calendarIds),
            inArray(calendarEvents.recurringEventId, masterEventIds)
          ),
        });
      }

      // Expand recurring events
      const expandedEvents: any[] = [];

      for (const event of events) {
        if (event.recurrenceRule && isRecurringMaster(event)) {
          // Get exceptions for this master event
          const eventExceptions = exceptions.filter(ex => ex.recurringEventId === event.id);

          // Expand recurrence
          const instances = expandRecurrence(event, start, end, eventExceptions);

          for (const instance of instances) {
            if (instance.isCancelled) {
              continue;
            }

            if (instance.exceptionEvent) {
              expandedEvents.push({
                ...instance.exceptionEvent,
                isVirtualInstance: false,
                masterId: event.id,
                masterEvent: event,
              });
            } else {
              const virtualInstance = createVirtualInstance(event, instance.date);
              expandedEvents.push({
                ...virtualInstance,
                masterEvent: event,
              });
            }
          }
        } else {
          expandedEvents.push(event);
        }
      }

      // Sort by start time
      expandedEvents.sort((a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );

      return { success: true, data: { events: expandedEvents } };
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
      // Check if this is a virtual instance ID (masterId_timestamp)
      const instanceInfo = parseInstanceId(request.params.id);
      const eventId = instanceInfo ? instanceInfo.masterId : request.params.id;

      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, eventId),
          eq(calendarEvents.calendarId, request.params.calendarId)
        ),
      });

      if (!event) {
        throw Errors.notFound('Event');
      }

      // Get attendees (from master event)
      const attendees = await db.query.eventAttendees.findMany({
        where: eq(eventAttendees.eventId, eventId),
      });

      // Get user's reminders (from master event)
      const reminders = await db.query.eventReminders.findMany({
        where: and(
          eq(eventReminders.eventId, eventId),
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

      // If this is a virtual instance, adjust the times
      let eventData = event;
      if (instanceInfo) {
        const duration = new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
        const instanceDate = new Date(instanceInfo.timestamp);
        eventData = {
          ...event,
          id: request.params.id, // Keep the virtual instance ID
          startTime: instanceDate,
          endTime: new Date(instanceDate.getTime() + duration),
          isVirtualInstance: true,
          masterId: eventId,
        } as typeof event;
      }

      return {
        success: true,
        data: {
          event: {
            ...eventData,
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
