import ICAL from 'ical.js';
import { db } from '../../config/database.js';
import { calendars, calendarEvents, type CalendarEvent } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

export interface ParsedEvent {
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  recurrenceRule?: string;
  externalId?: string;
}

/**
 * Parse an iCal (.ics) file content and extract events
 */
export function parseIcsContent(icsContent: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  try {
    const jcalData = ICAL.parse(icsContent);
    const comp = new ICAL.Component(jcalData);

    const vevents = comp.getAllSubcomponents('vevent');

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);

      // Skip cancelled events
      const status = vevent.getFirstPropertyValue('status');
      if (status && status.toLowerCase() === 'cancelled') {
        continue;
      }

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

      // Get UID for external ID tracking
      const uid = event.uid;

      events.push({
        title: event.summary || 'Untitled Event',
        description: event.description || undefined,
        location: event.location || undefined,
        startTime: startDate.toJSDate(),
        endTime: endDate ? endDate.toJSDate() : startDate.toJSDate(),
        allDay: isAllDay,
        recurrenceRule,
        externalId: uid,
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

  for (const event of parsedEvents) {
    try {
      // Check for duplicate
      if (skipDuplicates && event.externalId && existingExternalIds.has(event.externalId)) {
        skipped++;
        continue;
      }

      // Insert event
      await db.insert(calendarEvents).values({
        calendarId,
        createdById,
        title: event.title,
        description: event.description || null,
        location: event.location || null,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        recurrenceRule: event.recurrenceRule || null,
        externalId: event.externalId,
      });

      imported++;
    } catch (error) {
      errors.push(`Failed to import event "${event.title}": ${(error as Error).message}`);
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

    // Start time
    const startTime = ICAL.Time.fromJSDate(new Date(event.startTime), event.allDay);
    if (event.allDay) {
      startTime.isDate = true;
    }
    vevent.updatePropertyWithValue('dtstart', startTime);

    // End time
    const endTime = ICAL.Time.fromJSDate(new Date(event.endTime), event.allDay);
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

    // Timestamps
    const dtstamp = ICAL.Time.fromJSDate(new Date(), false);
    vevent.updatePropertyWithValue('dtstamp', dtstamp);

    const created = ICAL.Time.fromJSDate(new Date(event.createdAt), false);
    vevent.updatePropertyWithValue('created', created);

    const lastModified = ICAL.Time.fromJSDate(new Date(event.updatedAt), false);
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

  // Get events
  const events = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.calendarId, calendarId),
    orderBy: (e, { asc }) => [asc(e.startTime)],
  });

  // Filter by date range if specified
  let filteredEvents = events;
  if (options.startDate) {
    filteredEvents = filteredEvents.filter(
      (e) => new Date(e.endTime) >= options.startDate!
    );
  }
  if (options.endDate) {
    filteredEvents = filteredEvents.filter(
      (e) => new Date(e.startTime) <= options.endDate!
    );
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
