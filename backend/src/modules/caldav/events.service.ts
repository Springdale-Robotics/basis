import ICAL from 'ical.js';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  calendarEvents,
  eventAttendees,
  eventReminders,
  type EventAttendee,
  type EventReminder,
  type RsvpStatus,
  type ReminderType,
} from '../../db/schema/index.js';
import type { CalendarEvent } from '../../db/schema/index.js';

/**
 * Look up a CalDAV event resource by its URL slug (= master row's UUID).
 * Returns the master row, its exception rows, and all attendees + reminders
 * indexed by event id (so the renderer can emit them per-VEVENT).
 */
export async function loadEventResource(
  calendarId: string,
  resourceId: string
): Promise<{
  master: CalendarEvent;
  exceptions: CalendarEvent[];
  attendeesByEventId: Map<string, EventAttendee[]>;
  remindersByEventId: Map<string, EventReminder[]>;
} | null> {
  const master = await db.query.calendarEvents.findFirst({
    where: and(
      eq(calendarEvents.id, resourceId),
      eq(calendarEvents.calendarId, calendarId)
    ),
  });
  if (!master) return null;
  // The URL must point at a master/standalone row, not an exception.
  if (master.recurringEventId) return null;
  const exceptions = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.recurringEventId, master.id),
  });
  const allEventIds = [master.id, ...exceptions.map((e) => e.id)];
  const [attendees, reminders] = await Promise.all([
    db.query.eventAttendees.findMany({
      where: inArray(eventAttendees.eventId, allEventIds),
    }),
    db.query.eventReminders.findMany({
      where: inArray(eventReminders.eventId, allEventIds),
    }),
  ]);
  const attendeesByEventId = new Map<string, EventAttendee[]>();
  for (const a of attendees) {
    const arr = attendeesByEventId.get(a.eventId) ?? [];
    arr.push(a);
    attendeesByEventId.set(a.eventId, arr);
  }
  const remindersByEventId = new Map<string, EventReminder[]>();
  for (const r of reminders) {
    const arr = remindersByEventId.get(r.eventId) ?? [];
    arr.push(r);
    remindersByEventId.set(r.eventId, arr);
  }
  return { master, exceptions, attendeesByEventId, remindersByEventId };
}

// ─── iCalendar ↔ DB mappings ────────────────────────────────────────────────

const PARTSTAT_TO_RSVP: Record<string, RsvpStatus> = {
  'NEEDS-ACTION': 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'maybe',
  DELEGATED: 'pending',
};
const RSVP_TO_PARTSTAT: Record<RsvpStatus, string> = {
  pending: 'NEEDS-ACTION',
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  maybe: 'TENTATIVE',
};

const ACTION_TO_REMINDER: Record<string, ReminderType> = {
  DISPLAY: 'notification',
  EMAIL: 'email',
  AUDIO: 'notification',
};
const REMINDER_TO_ACTION: Record<ReminderType, string> = {
  notification: 'DISPLAY',
  email: 'EMAIL',
  // No clean CalDAV equivalent for push — degrades to DISPLAY on the wire and
  // the round-trip will land as 'notification'. Acceptable; clients that
  // implement push do it via their own channel anyway.
  push: 'DISPLAY',
};

/**
 * Render a master + exceptions as a single VCALENDAR with shared UID.
 * Apple Calendar and iOS require the whole series in one resource — our
 * existing public-ICS generator gives each row its own UID, which is wrong for
 * CalDAV's URL=resource model.
 */
export function renderEventResourceIcs(
  master: CalendarEvent,
  exceptions: CalendarEvent[],
  calendarTimezone: string,
  attendeesByEventId: Map<string, EventAttendee[]> = new Map(),
  remindersByEventId: Map<string, EventReminder[]> = new Map()
): string {
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.updatePropertyWithValue('version', '2.0');
  cal.updatePropertyWithValue('prodid', '-//Home Manager//CalDAV//EN');
  cal.updatePropertyWithValue('calscale', 'GREGORIAN');

  const uid = `${master.id}@homemanager`;

  appendVevent(cal, master, uid, calendarTimezone, /*isException*/ false, attendeesByEventId.get(master.id) ?? [], remindersByEventId.get(master.id) ?? []);
  for (const exc of exceptions) {
    appendVevent(cal, exc, uid, calendarTimezone, /*isException*/ true, attendeesByEventId.get(exc.id) ?? [], remindersByEventId.get(exc.id) ?? []);
  }
  return cal.toString();
}

function appendVevent(
  cal: ICAL.Component,
  event: CalendarEvent,
  sharedUid: string,
  _tz: string,
  isException: boolean,
  attendees: EventAttendee[],
  reminders: EventReminder[]
): void {
  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', sharedUid);
  vevent.updatePropertyWithValue('summary', event.title);
  if (event.description) vevent.updatePropertyWithValue('description', event.description);
  if (event.location) vevent.updatePropertyWithValue('location', event.location);

  const dtstart = ICAL.Time.fromJSDate(new Date(event.startTime), event.allDay);
  if (event.allDay) dtstart.isDate = true;
  vevent.updatePropertyWithValue('dtstart', dtstart);

  const dtend = ICAL.Time.fromJSDate(new Date(event.endTime), event.allDay);
  if (event.allDay) dtend.isDate = true;
  vevent.updatePropertyWithValue('dtend', dtend);

  if (event.recurrenceRule && !isException) {
    try {
      vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(event.recurrenceRule));
    } catch {
      /* skip invalid */
    }
  }
  if (event.recurrenceExDates && !isException) {
    try {
      for (const d of JSON.parse(event.recurrenceExDates) as string[]) {
        const t = ICAL.Time.fromJSDate(new Date(d), event.allDay);
        if (event.allDay) t.isDate = true;
        vevent.addPropertyWithValue('exdate', t);
      }
    } catch {
      /* skip */
    }
  }
  if (isException && event.originalStartTime) {
    const recurrenceId = ICAL.Time.fromJSDate(new Date(event.originalStartTime), event.allDay);
    if (event.allDay) recurrenceId.isDate = true;
    vevent.updatePropertyWithValue('recurrence-id', recurrenceId);
    if (event.recurrenceStatus === 'cancelled') {
      vevent.updatePropertyWithValue('status', 'CANCELLED');
    }
  }

  // ATTENDEE — emit one line per row. Organizer goes as a separate ORGANIZER
  // property too (some clients require both).
  const organizer = attendees.find((a) => a.isOrganizer);
  if (organizer?.email) {
    const orgProp = new ICAL.Property('organizer', vevent);
    orgProp.setValue(`mailto:${organizer.email}`);
    if (organizer.displayName) orgProp.setParameter('cn', organizer.displayName);
    vevent.addProperty(orgProp);
  }
  for (const att of attendees) {
    if (!att.email) continue; // ATTENDEE without an email isn't valid iCal
    const prop = new ICAL.Property('attendee', vevent);
    prop.setValue(`mailto:${att.email}`);
    if (att.displayName) prop.setParameter('cn', att.displayName);
    prop.setParameter('partstat', RSVP_TO_PARTSTAT[att.rsvpStatus]);
    prop.setParameter('role', att.isOrganizer ? 'CHAIR' : 'REQ-PARTICIPANT');
    prop.setParameter('rsvp', 'TRUE');
    vevent.addProperty(prop);
  }

  // VALARM — one per reminder row.
  for (const rem of reminders) {
    const alarm = new ICAL.Component('valarm');
    // TRIGGER: -PT<n>M means "n minutes BEFORE the event."
    const duration = new ICAL.Duration({
      isNegative: true,
      weeks: 0,
      days: 0,
      hours: Math.floor(rem.minutesBefore / 60),
      minutes: rem.minutesBefore % 60,
      seconds: 0,
    });
    alarm.updatePropertyWithValue('trigger', duration);
    alarm.updatePropertyWithValue('action', REMINDER_TO_ACTION[rem.reminderType]);
    alarm.updatePropertyWithValue('description', event.title || 'Reminder');
    vevent.addSubcomponent(alarm);
  }

  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), false));
  vevent.updatePropertyWithValue('created', ICAL.Time.fromJSDate(new Date(event.createdAt), false));
  vevent.updatePropertyWithValue(
    'last-modified',
    ICAL.Time.fromJSDate(new Date(event.updatedAt), false)
  );
  cal.addSubcomponent(vevent);
}

// ─── PUT parsing ────────────────────────────────────────────────────────────

export interface ParsedAttendee {
  email: string;
  displayName?: string;
  rsvpStatus: RsvpStatus;
  isOrganizer: boolean;
}

export interface ParsedReminder {
  minutesBefore: number;
  reminderType: ReminderType;
}

export interface ParsedPutEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  recurrenceRule?: string;
  recurrenceExDates?: string[];
  originalStartTime?: Date;
  status?: 'CANCELLED';
  attendees: ParsedAttendee[];
  reminders: ParsedReminder[];
}

export interface ParsedPutBody {
  uid: string;
  master?: ParsedPutEvent;
  exceptions: ParsedPutEvent[];
}

export function parsePutBody(body: string): ParsedPutBody {
  const jcal = ICAL.parse(body);
  const cal = new ICAL.Component(jcal);
  const vevents = cal.getAllSubcomponents('vevent');
  if (vevents.length === 0) {
    throw new Error('PUT body contains no VEVENT components');
  }
  const parsed = vevents.map((v) => parseVevent(v));
  const uid = parsed[0].uid;
  // Multi-VEVENT objects must share a UID per RFC 4791.
  for (const p of parsed) {
    if (p.uid !== uid) {
      throw new Error('All VEVENT components in a CalDAV resource must share a UID');
    }
  }
  return {
    uid,
    master: parsed.find((p) => !p.originalStartTime),
    exceptions: parsed.filter((p) => p.originalStartTime),
  };
}

function parseVevent(v: ICAL.Component): ParsedPutEvent {
  const uid = v.getFirstPropertyValue('uid')?.toString() ?? '';
  const title = v.getFirstPropertyValue('summary')?.toString() ?? '(untitled)';
  const description = v.getFirstPropertyValue('description')?.toString() ?? undefined;
  const location = v.getFirstPropertyValue('location')?.toString() ?? undefined;
  const dtstartProp = v.getFirstProperty('dtstart');
  const dtendProp = v.getFirstProperty('dtend');
  if (!dtstartProp || !dtendProp) throw new Error('VEVENT missing DTSTART/DTEND');
  const start = dtstartProp.getFirstValue() as ICAL.Time;
  const end = dtendProp.getFirstValue() as ICAL.Time;
  const allDay = !!start.isDate;
  const rrule = v.getFirstPropertyValue('rrule');
  const exdates: string[] = [];
  for (const p of v.getAllProperties('exdate')) {
    const val = p.getFirstValue() as ICAL.Time | undefined;
    if (val) exdates.push(val.toJSDate().toISOString());
  }
  const recurrenceId = v.getFirstPropertyValue('recurrence-id') as ICAL.Time | undefined;
  const status = v.getFirstPropertyValue('status')?.toString() === 'CANCELLED' ? 'CANCELLED' : undefined;

  // ATTENDEE — also pick up the organizer in case it's only declared via
  // ORGANIZER (not duplicated in ATTENDEE).
  const attendees: ParsedAttendee[] = [];
  const organizerProp = v.getFirstProperty('organizer');
  const organizerEmail = organizerProp ? parseMailto(organizerProp.getFirstValue()?.toString()) : null;
  for (const att of v.getAllProperties('attendee')) {
    const raw = att.getFirstValue()?.toString();
    const email = parseMailto(raw);
    if (!email) continue;
    const partstat = (att.getParameter('partstat') as string | undefined)?.toUpperCase() ?? 'NEEDS-ACTION';
    const role = (att.getParameter('role') as string | undefined)?.toUpperCase() ?? 'REQ-PARTICIPANT';
    attendees.push({
      email,
      displayName: (att.getParameter('cn') as string | undefined) ?? undefined,
      rsvpStatus: PARTSTAT_TO_RSVP[partstat] ?? 'pending',
      isOrganizer: role === 'CHAIR' || email === organizerEmail,
    });
  }
  // If an ORGANIZER was declared but not echoed in ATTENDEE, add it so we
  // don't lose the organizer flag on round-trip.
  if (organizerEmail && !attendees.some((a) => a.email === organizerEmail)) {
    attendees.push({
      email: organizerEmail,
      displayName: (organizerProp?.getParameter('cn') as string | undefined) ?? undefined,
      rsvpStatus: 'accepted', // Organizers implicitly accept their own events.
      isOrganizer: true,
    });
  }

  // VALARM — pull TRIGGER duration and ACTION.
  const reminders: ParsedReminder[] = [];
  for (const valarm of v.getAllSubcomponents('valarm')) {
    const trigger = valarm.getFirstPropertyValue('trigger');
    const action = valarm.getFirstPropertyValue('action')?.toString().toUpperCase() ?? 'DISPLAY';
    const minutes = triggerToMinutes(trigger);
    if (minutes == null) continue;
    reminders.push({
      minutesBefore: minutes,
      reminderType: ACTION_TO_REMINDER[action] ?? 'notification',
    });
  }

  return {
    uid,
    title,
    description,
    location,
    startTime: start.toJSDate(),
    endTime: end.toJSDate(),
    allDay,
    recurrenceRule: rrule ? (rrule as ICAL.Recur).toString() : undefined,
    recurrenceExDates: exdates.length ? exdates : undefined,
    originalStartTime: recurrenceId ? recurrenceId.toJSDate() : undefined,
    status,
    attendees,
    reminders,
  };
}

function parseMailto(raw: string | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:')) return raw.slice(7);
  // Some clients omit the scheme.
  if (raw.includes('@')) return raw;
  return null;
}

function triggerToMinutes(trigger: unknown): number | null {
  if (!trigger) return null;
  // ICAL.Duration with .isNegative + components in weeks/days/hours/minutes/seconds.
  // Convert to total minutes BEFORE the event (positive number).
  const d = trigger as ICAL.Duration & { toSeconds?: () => number };
  try {
    const seconds = typeof d.toSeconds === 'function' ? d.toSeconds() : null;
    if (seconds == null) return null;
    // Convention: positive minutesBefore = N minutes before the event.
    return Math.round((-seconds) / 60);
  } catch {
    return null;
  }
}

// ─── PUT apply ──────────────────────────────────────────────────────────────

/**
 * Apply a parsed PUT body to the database. Creates/updates the master row,
 * reconciles exception rows, and reconciles attendees + reminders per row.
 *
 * `resourceId` is the URL slug (= master row's UUID). For CREATE we use this as
 * the master id to keep the URL stable round-trip.
 *
 * Returns the master row after the write.
 */
export async function applyPutBody(
  calendarId: string,
  resourceId: string,
  body: ParsedPutBody
): Promise<CalendarEvent> {
  const existing = await db.query.calendarEvents.findFirst({
    where: and(
      eq(calendarEvents.id, resourceId),
      eq(calendarEvents.calendarId, calendarId)
    ),
  });
  const masterInput = body.master;

  let master: CalendarEvent;
  if (existing) {
    if (!masterInput) {
      throw new Error('PUT body missing master VEVENT for existing resource');
    }
    const [updated] = await db
      .update(calendarEvents)
      .set({
        title: masterInput.title,
        description: masterInput.description ?? null,
        location: masterInput.location ?? null,
        startTime: masterInput.startTime,
        endTime: masterInput.endTime,
        allDay: masterInput.allDay,
        recurrenceRule: masterInput.recurrenceRule ?? null,
        recurrenceExDates: masterInput.recurrenceExDates
          ? JSON.stringify(masterInput.recurrenceExDates)
          : null,
        recurrenceStatus: masterInput.recurrenceRule ? 'master' : null,
      })
      .where(eq(calendarEvents.id, existing.id))
      .returning();
    master = updated;
  } else {
    if (!masterInput) {
      throw new Error('PUT body missing master VEVENT for new resource');
    }
    const [created] = await db
      .insert(calendarEvents)
      .values({
        id: resourceId, // Use URL slug as the row id for stable round-trip.
        calendarId,
        title: masterInput.title,
        description: masterInput.description ?? null,
        location: masterInput.location ?? null,
        startTime: masterInput.startTime,
        endTime: masterInput.endTime,
        allDay: masterInput.allDay,
        recurrenceRule: masterInput.recurrenceRule ?? null,
        recurrenceExDates: masterInput.recurrenceExDates
          ? JSON.stringify(masterInput.recurrenceExDates)
          : null,
        recurrenceStatus: masterInput.recurrenceRule ? 'master' : null,
      })
      .returning();
    master = created;
  }

  await reconcileAttendeesAndReminders(master.id, masterInput.attendees, masterInput.reminders);

  // Reconcile exceptions: anything in body.exceptions becomes a row; anything
  // not in the body but currently a child row gets deleted.
  const existingExceptions = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.recurringEventId, master.id),
  });
  const bodyByOst = new Map<number, ParsedPutEvent>();
  for (const e of body.exceptions) {
    if (e.originalStartTime) bodyByOst.set(e.originalStartTime.getTime(), e);
  }

  const toDelete: string[] = [];
  for (const ex of existingExceptions) {
    if (!ex.originalStartTime) continue;
    const found = bodyByOst.get(new Date(ex.originalStartTime).getTime());
    if (!found) {
      toDelete.push(ex.id);
      continue;
    }
    await db
      .update(calendarEvents)
      .set({
        title: found.title,
        description: found.description ?? null,
        location: found.location ?? null,
        startTime: found.startTime,
        endTime: found.endTime,
        allDay: found.allDay,
        recurrenceStatus: found.status === 'CANCELLED' ? 'cancelled' : 'exception',
      })
      .where(eq(calendarEvents.id, ex.id));
    await reconcileAttendeesAndReminders(ex.id, found.attendees, found.reminders);
    bodyByOst.delete(new Date(ex.originalStartTime).getTime());
  }
  if (toDelete.length) {
    await db.delete(calendarEvents).where(inArray(calendarEvents.id, toDelete));
  }

  // Insert any remaining exception VEVENTs not matched above.
  for (const e of bodyByOst.values()) {
    if (!e.originalStartTime) continue;
    const [newRow] = await db
      .insert(calendarEvents)
      .values({
        calendarId,
        title: e.title,
        description: e.description ?? null,
        location: e.location ?? null,
        startTime: e.startTime,
        endTime: e.endTime,
        allDay: e.allDay,
        recurringEventId: master.id,
        originalStartTime: e.originalStartTime,
        recurrenceStatus: e.status === 'CANCELLED' ? 'cancelled' : 'exception',
      })
      .returning();
    await reconcileAttendeesAndReminders(newRow.id, e.attendees, e.reminders);
  }

  return master;
}

/**
 * Replace a row's attendees + reminders with the incoming set. Match attendees
 * by email so per-attendee user_id linkage is preserved when possible.
 */
async function reconcileAttendeesAndReminders(
  eventId: string,
  attendeesInput: ParsedAttendee[],
  remindersInput: ParsedReminder[]
): Promise<void> {
  // Attendees: match-by-email update; delete absent; insert new.
  const existing = await db.query.eventAttendees.findMany({
    where: eq(eventAttendees.eventId, eventId),
  });
  const incomingByEmail = new Map<string, ParsedAttendee>();
  for (const a of attendeesInput) {
    incomingByEmail.set(a.email.toLowerCase(), a);
  }
  const toRemove: string[] = [];
  for (const ex of existing) {
    const key = ex.email?.toLowerCase();
    if (!key || !incomingByEmail.has(key)) {
      toRemove.push(ex.id);
      continue;
    }
    const incoming = incomingByEmail.get(key)!;
    await db
      .update(eventAttendees)
      .set({
        displayName: incoming.displayName ?? null,
        rsvpStatus: incoming.rsvpStatus,
        isOrganizer: incoming.isOrganizer,
        updatedAt: new Date(),
      })
      .where(eq(eventAttendees.id, ex.id));
    incomingByEmail.delete(key);
  }
  if (toRemove.length) {
    await db.delete(eventAttendees).where(inArray(eventAttendees.id, toRemove));
  }
  for (const incoming of incomingByEmail.values()) {
    await db.insert(eventAttendees).values({
      eventId,
      email: incoming.email,
      displayName: incoming.displayName ?? null,
      rsvpStatus: incoming.rsvpStatus,
      isOrganizer: incoming.isOrganizer,
    });
  }

  // Reminders: simplest correct reconciliation — drop all and re-insert.
  // VALARMs don't carry stable identity on the wire, so matching by
  // (minutesBefore, type) is the best we can do.
  await db.delete(eventReminders).where(eq(eventReminders.eventId, eventId));
  for (const r of remindersInput) {
    await db.insert(eventReminders).values({
      eventId,
      reminderType: r.reminderType,
      minutesBefore: r.minutesBefore,
    });
  }
}

export function parseEventUrlSlug(slug: string): string {
  // ":eventUid" may arrive as "<uuid>.ics" or just "<uuid>".
  return slug.replace(/\.ics$/i, '');
}

// Silence unused-import warnings for callers that don't use these conditions.
export const _drizzleHelpers = { or, isNull };
