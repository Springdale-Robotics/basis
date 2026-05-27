import ICAL from 'ical.js';
import { db } from '../../config/database.js';
import { calendars, calendarEvents, type CalendarEvent } from '../../db/schema/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

export interface ParsedEvent {
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  recurrenceRule?: string;
  recurrenceExDates?: string;  // JSON array of excluded ISO date strings
  recurrenceRDates?: string;   // JSON array of additional ISO date strings
  externalId?: string;
  // For exception instances
  recurringEventId?: string;
  originalStartTime?: Date;
  recurrenceStatus?: 'master' | 'exception' | 'cancelled';
}

/**
 * Parse an iCal (.ics) file content and extract events
 */
export function parseIcsContent(icsContent: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const uidToMasterIndex: Record<string, number> = {};

  try {
    const jcalData = ICAL.parse(icsContent);
    const comp = new ICAL.Component(jcalData);

    const vevents = comp.getAllSubcomponents('vevent');

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);

      // Check if this is a cancelled instance
      const status = vevent.getFirstPropertyValue('status');
      const isCancelled = status && status.toLowerCase() === 'cancelled';

      const startDate = event.startDate;
      const endDate = event.endDate;

      if (!startDate) continue;

      // Determine if all-day event
      const isAllDay = startDate.isDate;

      // Get recurrence rule
      let recurrenceRule: string | undefined;
      const rruleProp = vevent.getFirstProperty('rrule');
      if (rruleProp) {
        const rruleValue = rruleProp.getFirstValue();
        if (rruleValue) {
          recurrenceRule = rruleValue.toString();
        }
      }

      // Get EXDATE (excluded dates)
      let recurrenceExDates: string | undefined;
      const exdateProps = vevent.getAllProperties('exdate');
      if (exdateProps && exdateProps.length > 0) {
        const exDates: string[] = [];
        for (const exdateProp of exdateProps) {
          const exdateValue = exdateProp.getFirstValue();
          if (exdateValue) {
            exDates.push(exdateValue.toJSDate().toISOString());
          }
        }
        if (exDates.length > 0) {
          recurrenceExDates = JSON.stringify(exDates);
        }
      }

      // Get RDATE (additional dates)
      let recurrenceRDates: string | undefined;
      const rdateProps = vevent.getAllProperties('rdate');
      if (rdateProps && rdateProps.length > 0) {
        const rDates: string[] = [];
        for (const rdateProp of rdateProps) {
          const rdateValue = rdateProp.getFirstValue();
          if (rdateValue) {
            rDates.push(rdateValue.toJSDate().toISOString());
          }
        }
        if (rDates.length > 0) {
          recurrenceRDates = JSON.stringify(rDates);
        }
      }

      // Get UID for external ID tracking
      const uid = event.uid;

      // Check if this is an exception instance (has RECURRENCE-ID)
      const recurrenceIdProp = vevent.getFirstProperty('recurrence-id');
      let originalStartTime: Date | undefined;
      let recurringEventId: string | undefined;
      let recurrenceStatus: 'master' | 'exception' | 'cancelled' | undefined;

      if (recurrenceIdProp) {
        const recurrenceIdValue = recurrenceIdProp.getFirstValue();
        if (recurrenceIdValue) {
          originalStartTime = recurrenceIdValue.toJSDate();
          // The UID should match the master event's UID
          recurringEventId = uid;
          recurrenceStatus = isCancelled ? 'cancelled' : 'exception';
        }
      } else if (recurrenceRule) {
        recurrenceStatus = 'master';
        // Track master events by UID
        uidToMasterIndex[uid] = events.length;
      }

      events.push({
        title: event.summary || 'Untitled Event',
        description: event.description || undefined,
        location: event.location || undefined,
        startTime: startDate.toJSDate(),
        endTime: endDate ? endDate.toJSDate() : startDate.toJSDate(),
        allDay: isAllDay,
        recurrenceRule,
        recurrenceExDates,
        recurrenceRDates,
        externalId: uid,
        originalStartTime,
        recurringEventId,
        recurrenceStatus,
      });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to parse ICS content');
    throw new Error('Invalid ICS file format');
  }

  return events;
}

/**
 * Import events from an ICS file into a calendar
 */
export async function importIcsToCalendar(
  calendarId: string,
  householdId: string,
  icsContent: string,
  options: {
    skipDuplicates?: boolean;
    createdById?: string;
  } = {}
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const { skipDuplicates = true, createdById } = options;

  // Verify calendar exists and belongs to household
  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  if (!calendar || calendar.householdId !== householdId) {
    throw new Error('Calendar not found');
  }

  if (calendar.isReadOnly) {
    throw new Error('Calendar is read-only');
  }

  // Parse ICS content
  const parsedEvents = parseIcsContent(icsContent);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Get existing external IDs to check for duplicates
  let existingExternalIds = new Set<string>();
  if (skipDuplicates) {
    const existingEvents = await db.query.calendarEvents.findMany({
      where: eq(calendarEvents.calendarId, calendarId),
      columns: { externalId: true },
    });
    existingExternalIds = new Set(
      existingEvents
        .filter((e) => e.externalId)
        .map((e) => e.externalId!)
    );
  }

  // First pass: import master events and non-recurring events
  const externalIdToDbId: Record<string, string> = {};

  for (const event of parsedEvents) {
    try {
      // Skip exception instances in first pass
      if (event.recurrenceStatus === 'exception' || event.recurrenceStatus === 'cancelled') {
        continue;
      }

      // Check for duplicate
      if (skipDuplicates && event.externalId && existingExternalIds.has(event.externalId)) {
        skipped++;
        continue;
      }

      // Insert event
      const [inserted] = await db.insert(calendarEvents).values({
        calendarId,
        createdById,
        title: event.title,
        description: event.description || null,
        location: event.location || null,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        recurrenceRule: event.recurrenceRule || null,
        recurrenceExDates: event.recurrenceExDates || null,
        recurrenceRDates: event.recurrenceRDates || null,
        recurrenceStatus: event.recurrenceStatus || null,
        externalId: event.externalId,
      }).returning();

      if (event.externalId) {
        externalIdToDbId[event.externalId] = inserted.id;
      }

      imported++;
    } catch (error) {
      errors.push(`Failed to import event "${event.title}": ${(error as Error).message}`);
    }
  }

  // Second pass: import exception instances
  for (const event of parsedEvents) {
    try {
      if (event.recurrenceStatus !== 'exception' && event.recurrenceStatus !== 'cancelled') {
        continue;
      }

      // Find the master event by external ID (UID)
      const masterDbId = event.recurringEventId ? externalIdToDbId[event.recurringEventId] : null;
      if (!masterDbId && event.recurringEventId) {
        // Master event might already exist in the database
        const existingMaster = await db.query.calendarEvents.findFirst({
          where: eq(calendarEvents.externalId, event.recurringEventId),
        });
        if (existingMaster) {
          externalIdToDbId[event.recurringEventId] = existingMaster.id;
        }
      }

      const finalMasterId = event.recurringEventId ? externalIdToDbId[event.recurringEventId] : null;

      // Insert exception event
      await db.insert(calendarEvents).values({
        calendarId,
        createdById,
        title: event.title,
        description: event.description || null,
        location: event.location || null,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        recurringEventId: finalMasterId,
        originalStartTime: event.originalStartTime,
        recurrenceStatus: event.recurrenceStatus,
        externalId: event.externalId ? `${event.externalId}_${event.originalStartTime?.toISOString()}` : null,
      });

      imported++;
    } catch (error) {
      errors.push(`Failed to import exception "${event.title}": ${(error as Error).message}`);
    }
  }

  return { imported, skipped, errors };
}

/**
 * Generate ICS content from calendar events
 */
export function generateIcsContent(
  events: CalendarEvent[],
  calendarName: string = 'Home Manager Calendar'
): string {
  const comp = new ICAL.Component(['vcalendar', [], []]);

  // Set calendar properties
  comp.updatePropertyWithValue('version', '2.0');
  comp.updatePropertyWithValue('prodid', '-//Home Manager//Calendar//EN');
  comp.updatePropertyWithValue('calscale', 'GREGORIAN');
  comp.updatePropertyWithValue('method', 'PUBLISH');
  comp.updatePropertyWithValue('x-wr-calname', calendarName);

  for (const event of events) {
    const vevent = new ICAL.Component('vevent');

    // UID
    const uid = event.externalId || `${event.id}@homemanager`;
    vevent.updatePropertyWithValue('uid', uid);

    // Summary (title)
    vevent.updatePropertyWithValue('summary', event.title);

    // Description
    if (event.description) {
      vevent.updatePropertyWithValue('description', event.description);
    }

    // Location
    if (event.location) {
      vevent.updatePropertyWithValue('location', event.location);
    }

    // DB stores UTC timestamps. Pass useUTC=true so ical.js emits Z-suffixed
    // UTC instead of converting to server-local and writing a floating time.
    const startTime = ICAL.Time.fromJSDate(new Date(event.startTime), true);
    if (event.allDay) {
      startTime.isDate = true;
    }
    vevent.updatePropertyWithValue('dtstart', startTime);

    const endTime = ICAL.Time.fromJSDate(new Date(event.endTime), true);
    if (event.allDay) {
      endTime.isDate = true;
    }
    vevent.updatePropertyWithValue('dtend', endTime);

    // Recurrence rule
    if (event.recurrenceRule) {
      try {
        const rrule = ICAL.Recur.fromString(event.recurrenceRule);
        vevent.updatePropertyWithValue('rrule', rrule);
      } catch {
        // Skip invalid recurrence rules
      }
    }

    // EXDATE (excluded dates)
    if (event.recurrenceExDates) {
      try {
        const exDates = JSON.parse(event.recurrenceExDates);
        for (const exDateStr of exDates) {
          const exDate = ICAL.Time.fromJSDate(new Date(exDateStr), true);
          if (event.allDay) {
            exDate.isDate = true;
          }
          vevent.addPropertyWithValue('exdate', exDate);
        }
      } catch {
        // Skip invalid EXDATE
      }
    }

    // RDATE (additional dates)
    if (event.recurrenceRDates) {
      try {
        const rDates = JSON.parse(event.recurrenceRDates);
        for (const rDateStr of rDates) {
          const rDate = ICAL.Time.fromJSDate(new Date(rDateStr), true);
          if (event.allDay) {
            rDate.isDate = true;
          }
          vevent.addPropertyWithValue('rdate', rDate);
        }
      } catch {
        // Skip invalid RDATE
      }
    }

    // Exception instances have RECURRENCE-ID
    if (event.originalStartTime && event.recurringEventId) {
      const recurrenceId = ICAL.Time.fromJSDate(new Date(event.originalStartTime), true);
      if (event.allDay) {
        recurrenceId.isDate = true;
      }
      vevent.updatePropertyWithValue('recurrence-id', recurrenceId);

      // Cancelled instances have STATUS:CANCELLED
      if (event.recurrenceStatus === 'cancelled') {
        vevent.updatePropertyWithValue('status', 'CANCELLED');
      }
    }

    const dtstamp = ICAL.Time.fromJSDate(new Date(), true);
    vevent.updatePropertyWithValue('dtstamp', dtstamp);

    const created = ICAL.Time.fromJSDate(new Date(event.createdAt), true);
    vevent.updatePropertyWithValue('created', created);

    const lastModified = ICAL.Time.fromJSDate(new Date(event.updatedAt), true);
    vevent.updatePropertyWithValue('last-modified', lastModified);

    comp.addSubcomponent(vevent);
  }

  return comp.toString();
}

/**
 * Export a calendar's events to ICS format
 */
export async function exportCalendarToIcs(
  calendarId: string,
  householdId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
  } = {}
): Promise<{ content: string; filename: string }> {
  // Get calendar
  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  if (!calendar || calendar.householdId !== householdId) {
    throw new Error('Calendar not found');
  }

  // Get all events including master events and exception instances
  const events = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.calendarId, calendarId),
    orderBy: (e, { asc }) => [asc(e.startTime)],
  });

  // Filter by date range if specified (only for non-exception events)
  let filteredEvents = events;
  if (options.startDate || options.endDate) {
    filteredEvents = events.filter((e) => {
      // Always include exception instances if their master is included
      if (e.recurrenceStatus === 'exception' || e.recurrenceStatus === 'cancelled') {
        return true; // We'll filter these based on master inclusion later
      }

      const eventEnd = new Date(e.endTime);
      const eventStart = new Date(e.startTime);

      if (options.startDate && eventEnd < options.startDate) {
        return false;
      }
      if (options.endDate && eventStart > options.endDate) {
        return false;
      }
      return true;
    });
  }

  const content = generateIcsContent(filteredEvents, calendar.name);
  const filename = `${calendar.name.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;

  return { content, filename };
}

/**
 * Export all calendars from a household to ICS format
 */
export async function exportAllCalendarsToIcs(
  householdId: string
): Promise<{ content: string; filename: string }> {
  // Get all calendars
  const calendarList = await db.query.calendars.findMany({
    where: eq(calendars.householdId, householdId),
  });

  if (calendarList.length === 0) {
    throw new Error('No calendars found');
  }

  // Get all events from all calendars
  const allEvents: CalendarEvent[] = [];
  for (const calendar of calendarList) {
    const events = await db.query.calendarEvents.findMany({
      where: eq(calendarEvents.calendarId, calendar.id),
    });
    allEvents.push(...events);
  }

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const content = generateIcsContent(allEvents, 'Home Manager - All Calendars');
  const filename = 'homemanager_all_calendars.ics';

  return { content, filename };
}
