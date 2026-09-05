import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../../config/database.js';
import { calendars, calendarEvents } from '../../db/schema/index.js';
import type { Calendar } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { syncedEventUnchanged, missingEventInsideWindow } from './sync-reconcile.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export function createOAuth2Client(redirectUri?: string): OAuth2Client {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth credentials not configured');
  }

  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export function getAuthUrl(oauth2Client: OAuth2Client, state: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent', // Force consent to get refresh token
  });
}

export async function getTokensFromCode(
  oauth2Client: OAuth2Client,
  code: string
): Promise<{ access_token: string; refresh_token: string; expiry_date: number }> {
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Failed to get tokens from Google');
  }
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3600000,
  };
}

export async function refreshTokens(
  oauth2Client: OAuth2Client,
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return {
    access_token: credentials.access_token!,
    expiry_date: credentials.expiry_date || Date.now() + 3600000,
  };
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  primary?: boolean;
  // Google's own permission for this calendar under the connecting user's
  // account: 'owner' | 'writer' | 'reader' | 'freeBusyReader'. Carried
  // through so the picker (and, more importantly, /sync/google/complete) can
  // tell a calendar the household actually owns or can edit apart from one
  // they can only read — a partner's shared calendar, Holidays, a school
  // calendar. Previously fetched and silently discarded here, which is how
  // the unlock in phase 2 task 5 could otherwise make a read-only shared
  // calendar look connectable and writable.
  accessRole?: string;
}

/** Google roles that this app is willing to push local edits to. Reader and
 * freeBusyReader are exactly the roles Google itself won't accept a write
 * against — pushing to one of those doesn't fail occasionally, it fails
 * forever, on every item, on every sweep. */
const WRITABLE_GOOGLE_ACCESS_ROLES = new Set(['owner', 'writer']);

export function isWritableGoogleAccessRole(accessRole: string | undefined): boolean {
  return accessRole !== undefined && WRITABLE_GOOGLE_ACCESS_ROLES.has(accessRole);
}

export async function listGoogleCalendars(
  accessToken: string
): Promise<GoogleCalendarInfo[]> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const response = await calendar.calendarList.list();

  return (response.data.items || []).map((cal) => ({
    id: cal.id!,
    summary: cal.summary || 'Untitled Calendar',
    description: cal.description || undefined,
    backgroundColor: cal.backgroundColor || undefined,
    primary: cal.primary || false,
    accessRole: cal.accessRole || undefined,
  }));
}

/**
 * Re-reads a single calendar's access role directly from Google, rather than
 * trusting anything the client sent. /sync/google/complete's request body is
 * just `{ googleCalendarId }` with no re-validation against the token — a
 * client-side-only "hide read-only calendars in the picker" filter would be
 * cosmetic, not a guarantee. calendarList.get() only ever returns an entry
 * the authenticated user already has in their own calendar list, so this
 * can't be pointed at an arbitrary calendar the token holder has no
 * relationship to.
 */
export async function getGoogleCalendarAccessRole(
  accessToken: string,
  googleCalendarId: string
): Promise<string | undefined> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const response = await calendar.calendarList.get({ calendarId: googleCalendarId });
  return response.data.accessRole || undefined;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  recurrence?: string[];
  status?: string;
  // Google's own "last modified" stamp for this event, RFC3339. Stored in
  // calendar_events.remote_updated so the pull can tell an echo of our own
  // push apart from a genuine remote change.
  updated?: string;
  // For exception instances
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string };
}

export async function fetchGoogleEvents(
  accessToken: string,
  googleCalendarId: string,
  timeMin?: Date,
  timeMax?: Date
): Promise<GoogleCalendarEvent[]> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId: googleCalendarId,
    singleEvents: false, // Get recurring events as master events
    maxResults: 2500,
  };

  if (timeMin) {
    params.timeMin = timeMin.toISOString();
  }
  if (timeMax) {
    params.timeMax = timeMax.toISOString();
  }

  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      ...params,
      pageToken,
    });

    for (const event of response.data.items || []) {
      if (event.id) {
        events.push({
          id: event.id,
          summary: event.summary || undefined,
          description: event.description || undefined,
          location: event.location || undefined,
          start: event.start as GoogleCalendarEvent['start'],
          end: event.end as GoogleCalendarEvent['end'],
          recurrence: event.recurrence || undefined,
          status: event.status || undefined,
          updated: event.updated || undefined,
          recurringEventId: event.recurringEventId || undefined,
          originalStartTime: event.originalStartTime as GoogleCalendarEvent['originalStartTime'],
        });
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return events;
}

// Raw-error fallback cap. This text can end up unmediated in a text column
// and a websocket payload. Every renderer of calendar.syncError splits on
// `|count:` before display, but the half before that split is still this
// raw text with no length limit of its own, so an unrecognised, non-Error,
// non-string throw gets a bounded slice rather than an arbitrarily large
// JSON blob.
const MAX_RAW_ERROR_LENGTH = 500;

/**
 * Render whatever was thrown as a string, for the cases describeGoogleSyncError
 * doesn't recognise. `JSON.stringify` is typed as always returning `string`,
 * but it actually returns the *value* `undefined` for `undefined` input and
 * throws on a circular structure or a BigInt — either would otherwise violate
 * this module's `: string` contract silently, since TypeScript doesn't check
 * JSON.stringify's real runtime behaviour against its declared type.
 */
function stringifyUnknownError(err: unknown): string {
  let json: unknown;
  try {
    json = JSON.stringify(err);
  } catch {
    json = undefined;
  }

  if (typeof json !== 'string') {
    return 'An unrecognised Google Calendar sync error occurred.';
  }

  return json.length > MAX_RAW_ERROR_LENGTH
    ? `${json.slice(0, MAX_RAW_ERROR_LENGTH)}… (truncated)`
    : json;
}

/**
 * Turn a Google API failure into something a household can act on.
 *
 * The case worth special-casing is `invalid_grant`. A Google Cloud project
 * whose consent screen is still on the "Testing" publishing status expires
 * every refresh token seven days after consent, so a calendar that connected
 * fine simply stops a week later. The API error says nothing about why, and
 * the household has no reason to connect the two events.
 */
export function describeGoogleSyncError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : stringifyUnknownError(err);

  const code =
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? raw;

  if (typeof code === 'string' && code.includes('invalid_grant')) {
    return (
      'Google rejected the saved credentials (invalid_grant). This usually means ' +
      'the Google Cloud project is still on the "Testing" publishing status, which ' +
      'expires access seven days after you connect. In the Google Cloud console, ' +
      'set the consent screen to "In production", then reconnect the calendar in Basis.'
    );
  }

  return raw;
}

export async function syncCalendarFromGoogle(
  calendarId: string,
  householdId: string
): Promise<{ created: number; updated: number; deleted: number }> {
  const log = logger.child({ calendarId, householdId });
  log.info('Starting Google Calendar sync');

  // Get calendar with sync credentials
  const calendar = await db.query.calendars.findFirst({
    where: and(
      eq(calendars.id, calendarId),
      eq(calendars.householdId, householdId),
      eq(calendars.isSynced, true),
      eq(calendars.syncProvider, 'google')
    ),
  });

  if (!calendar || !calendar.syncCredentials || !calendar.syncCalendarId) {
    throw new Error('Calendar not found or not configured for Google sync');
  }

  // Decrypt credentials
  let credentials: { access_token: string; refresh_token: string; expiry_date: number };
  try {
    credentials = JSON.parse(decrypt(calendar.syncCredentials));
  } catch {
    throw new Error('Failed to decrypt sync credentials');
  }

  // Check if token needs refresh
  const oauth2Client = createOAuth2Client();
  let accessToken = credentials.access_token;

  if (credentials.expiry_date < Date.now() + 60000) {
    // Refresh if expiring within 1 minute
    log.info('Refreshing access token');
    try {
      const newTokens = await refreshTokens(oauth2Client, credentials.refresh_token);
      accessToken = newTokens.access_token;

      // Update stored credentials
      const updatedCredentials = encrypt(
        JSON.stringify({
          ...credentials,
          access_token: accessToken,
          expiry_date: newTokens.expiry_date,
        })
      );

      await db
        .update(calendars)
        .set({ syncCredentials: updatedCredentials })
        .where(eq(calendars.id, calendarId));
    } catch (error) {
      log.error({ error }, 'Failed to refresh access token');
      await db
        .update(calendars)
        .set({
          syncError: describeGoogleSyncError(error),
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));
      throw error;
    }
  }

  // Fetch events from Google
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const oneYearFromNow = new Date(now);
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  let googleEvents: GoogleCalendarEvent[];
  try {
    googleEvents = await fetchGoogleEvents(
      accessToken,
      calendar.syncCalendarId,
      threeMonthsAgo,
      oneYearFromNow
    );
  } catch (error) {
    log.error({ error }, 'Failed to fetch events from Google');
    await db
      .update(calendars)
      .set({
        syncError: 'Failed to fetch events from Google Calendar.',
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, calendarId));
    throw error;
  }

  // Get existing events
  const existingEvents = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.calendarId, calendarId),
  });

  const existingByExternalId = new Map(
    existingEvents
      .filter((e) => e.externalId)
      .map((e) => [e.externalId, e])
  );

  let created = 0;
  let updated = 0;
  let deleted = 0;

  const googleEventIds = new Set(googleEvents.map((e) => e.id));

  // Separate master events and exception instances
  const masterEvents = googleEvents.filter(e => !e.recurringEventId);
  const exceptionEvents = googleEvents.filter(e => e.recurringEventId);

  // Map external IDs to db IDs for linking exceptions to masters
  const externalIdToDbId: Record<string, string> = {};

  // First pass: Process master events
  for (const googleEvent of masterEvents) {
    const existing = existingByExternalId.get(googleEvent.id);

    // Skip cancelled master events (they have no start/end times)
    if (googleEvent.status === 'cancelled' || !googleEvent.start) {
      continue;
    }

    const isAllDay = !!googleEvent.start.date;
    const startTime = isAllDay
      ? new Date(googleEvent.start.date!)
      : new Date(googleEvent.start.dateTime!);
    const endTime = isAllDay
      ? new Date(googleEvent.end.date!)
      : new Date(googleEvent.end.dateTime!);

    // Convert recurrence rules
    const recurrenceRule = googleEvent.recurrence?.[0]?.replace('RRULE:', '') || null;

    const eventData = {
      title: googleEvent.summary || 'Untitled Event',
      description: googleEvent.description || null,
      location: googleEvent.location || null,
      startTime,
      endTime,
      allDay: isAllDay,
      recurrenceRule,
      recurrenceStatus: recurrenceRule ? 'master' as const : null,
      externalId: googleEvent.id,
      remoteUpdated: googleEvent.updated ? new Date(googleEvent.updated) : null,
    };

    if (existing) {
      externalIdToDbId[googleEvent.id] = existing.id;
      // Skip no-op writes: rewriting unchanged rows churns revisions/ETags
      // and appends calendar_changes journal rows on every hourly sync.
      if (!syncedEventUnchanged(existing, eventData)) {
        // Deliberately not setting updatedAt here: `.set(eventData)` leaves
        // it at whatever the last local edit set, which is what the
        // outbound sweep's `updated_at > remote_updated` dirty check needs.
        await db
          .update(calendarEvents)
          .set(eventData)
          .where(eq(calendarEvents.id, existing.id));
        updated++;
      }
    } else {
      // Create new event
      const [inserted] = await db.insert(calendarEvents).values({
        calendarId,
        ...eventData,
        // Pin updatedAt to the provider's timestamp on insert. Left to
        // default to now(), a freshly pulled event would satisfy
        // `updated_at > remote_updated` and be pushed straight back to
        // Google on the next outbound sweep.
        updatedAt: eventData.remoteUpdated ?? new Date(),
      }).returning();
      externalIdToDbId[googleEvent.id] = inserted.id;
      created++;
    }
  }

  // Second pass: Process exception instances
  for (const googleEvent of exceptionEvents) {
    const existing = existingByExternalId.get(googleEvent.id);

    const isAllDay = !!googleEvent.start?.date;
    const isCancelled = googleEvent.status === 'cancelled';

    // Get original start time
    let originalStartTime: Date | null = null;
    if (googleEvent.originalStartTime) {
      originalStartTime = googleEvent.originalStartTime.date
        ? new Date(googleEvent.originalStartTime.date)
        : googleEvent.originalStartTime.dateTime
          ? new Date(googleEvent.originalStartTime.dateTime)
          : null;
    }

    // Find master event ID
    const masterDbId = googleEvent.recurringEventId
      ? externalIdToDbId[googleEvent.recurringEventId]
      : null;

    // For cancelled instances, we might not have start/end
    let startTime = originalStartTime;
    let endTime = originalStartTime;

    if (!isCancelled && googleEvent.start) {
      startTime = isAllDay
        ? new Date(googleEvent.start.date!)
        : new Date(googleEvent.start.dateTime!);
      endTime = isAllDay
        ? new Date(googleEvent.end.date!)
        : new Date(googleEvent.end.dateTime!);
    }

    if (!startTime || !endTime) {
      continue;
    }

    const eventData = {
      title: googleEvent.summary || 'Untitled Event',
      description: googleEvent.description || null,
      location: googleEvent.location || null,
      startTime,
      endTime,
      allDay: isAllDay,
      recurringEventId: masterDbId,
      originalStartTime,
      recurrenceStatus: isCancelled ? 'cancelled' as const : 'exception' as const,
      externalId: googleEvent.id,
      remoteUpdated: googleEvent.updated ? new Date(googleEvent.updated) : null,
    };

    if (existing) {
      if (!syncedEventUnchanged(existing, eventData)) {
        // See the master-event branch above: `.set(eventData)` deliberately
        // leaves updatedAt untouched.
        await db
          .update(calendarEvents)
          .set(eventData)
          .where(eq(calendarEvents.id, existing.id));
        updated++;
      }
    } else {
      // Create new exception
      await db.insert(calendarEvents).values({
        calendarId,
        ...eventData,
        // Pin updatedAt to the provider's timestamp on insert — see the
        // master-event branch above for why.
        updatedAt: eventData.remoteUpdated ?? new Date(),
      });
      created++;
    }
  }

  // Delete events the provider no longer has — but ONLY inside the fetched
  // window. We only asked for a window of events, so absence outside it means
  // nothing; deleting on absence purged all synced history older than the
  // window on every run.
  for (const existing of existingEvents) {
    if (
      existing.externalId &&
      !googleEventIds.has(existing.externalId) &&
      missingEventInsideWindow(existing, threeMonthsAgo, oneYearFromNow)
    ) {
      await db.delete(calendarEvents).where(eq(calendarEvents.id, existing.id));
      deleted++;
    }
  }

  // Update sync timestamp
  await db
    .update(calendars)
    .set({
      lastSyncAt: new Date(),
      syncError: null,
      updatedAt: new Date(),
    })
    .where(eq(calendars.id, calendarId));

  log.info({ created, updated, deleted }, 'Google Calendar sync completed');

  return { created, updated, deleted };
}

/**
 * Decrypt a calendar's stored Google credentials and return an access token
 * good enough to call the API right now, refreshing (and re-persisting) it
 * first if it's within a minute of expiring.
 *
 * Mirrors the refresh logic inlined in syncCalendarFromGoogle above — kept
 * separate rather than factored into a shared call site there, so this
 * addition can't change behaviour on the pull path that basis#101's 49
 * production pulls already verified.
 *
 * Throws on a credentials blob that won't decrypt or parse. Callers that
 * want "bad credentials" to degrade one item at a time instead of failing
 * outright (the outbound sweep) should catch this themselves.
 */
export async function getValidAccessToken(calendar: Calendar): Promise<string> {
  if (!calendar.syncCredentials) {
    throw new Error('Calendar has no sync credentials');
  }

  let credentials: { access_token: string; refresh_token: string; expiry_date: number };
  try {
    credentials = JSON.parse(decrypt(calendar.syncCredentials));
  } catch {
    throw new Error('Failed to decrypt sync credentials');
  }

  if (credentials.expiry_date >= Date.now() + 60000) {
    return credentials.access_token;
  }

  const oauth2Client = createOAuth2Client();
  const newTokens = await refreshTokens(oauth2Client, credentials.refresh_token);

  const updatedCredentials = encrypt(
    JSON.stringify({
      ...credentials,
      access_token: newTokens.access_token,
      expiry_date: newTokens.expiry_date,
    })
  );

  await db
    .update(calendars)
    .set({ syncCredentials: updatedCredentials })
    .where(eq(calendars.id, calendar.id));

  return newTokens.access_token;
}

/** What every write handler below hands back — enough to stamp external_id
 * and remote_updated without a second round-trip. */
export interface GoogleEventWriteResult {
  id: string;
  updated: string | null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** True at exactly UTC midnight — the one timestamp shape a Basis-authored
 * all-day event can never produce (see below) and every Google-pulled
 * all-day boundary always does. */
function isUtcMidnight(date: Date): boolean {
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * A `calendarEvents` row can hold an all-day end in either of two shapes,
 * and this is the one place that has to tell them apart before sending a
 * `date` to Google.
 *
 * - Google-pulled: the sync pull (see the master-event loop above) stores
 *   `googleEvent.end.date` verbatim. Google's `end.date` is EXCLUSIVE (RFC
 *   5545/Google Calendar API: the day after the last actual day), and a
 *   date-only string always parses as UTC midnight, so this shape is always
 *   `00:00:00.000Z`.
 * - Basis-authored: `EventForm.handleFormSubmit` (frontend/src/components/
 *   calendar/EventForm.tsx) stores a one-day all-day event as noon-to-noon
 *   on the same date and a multi-day one as noon-to-noon on its *last*
 *   actual day — an INCLUSIVE end, deliberately at noon rather than
 *   midnight ("to avoid timezone boundary issues... which shifts to the
 *   previous day for negative UTC offsets"). That deliberate choice is what
 *   makes this shape distinguishable: it is never UTC midnight in any
 *   timezone this app is realistically deployed in (it would take a server
 *   running at a UTC+/-12 offset to collide, which is the same unresolved-
 *   timezone territory the recurring-create guard below is still guarding).
 *
 * So: an end already sitting at UTC midnight is treated as already-exclusive
 * and passed through; anything else is treated as an inclusive last-day and
 * pushed out by one day to become exclusive. A row can only be one shape or
 * the other — both start and end of a given row are written by the same
 * code path — so checking the end alone is enough.
 */
function toGoogleAllDayEndDate(end: Date): string {
  const exclusiveEnd = isUtcMidnight(end) ? end : new Date(end.getTime() + ONE_DAY_MS);
  return exclusiveEnd.toISOString().split('T')[0];
}

export async function createGoogleEvent(
  accessToken: string,
  googleCalendarId: string,
  event: {
    summary: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    allDay: boolean;
    recurrence?: string;
  }
): Promise<GoogleEventWriteResult> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const eventBody: calendar_v3.Schema$Event = {
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.allDay
      ? { date: event.start.toISOString().split('T')[0] }
      : { dateTime: event.start.toISOString() },
    end: event.allDay
      ? { date: toGoogleAllDayEndDate(event.end) }
      : { dateTime: event.end.toISOString() },
  };

  if (event.recurrence) {
    eventBody.recurrence = [`RRULE:${event.recurrence}`];
  }

  const response = await calendar.events.insert({
    calendarId: googleCalendarId,
    requestBody: eventBody,
  });

  return { id: response.data.id!, updated: response.data.updated ?? null };
}

export async function updateGoogleEvent(
  accessToken: string,
  googleCalendarId: string,
  googleEventId: string,
  event: {
    summary?: string;
    description?: string;
    location?: string;
    start?: Date;
    end?: Date;
    allDay?: boolean;
    recurrence?: string;
  }
): Promise<GoogleEventWriteResult> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const eventBody: calendar_v3.Schema$Event = {};

  if (event.summary !== undefined) eventBody.summary = event.summary;
  if (event.description !== undefined) eventBody.description = event.description;
  if (event.location !== undefined) eventBody.location = event.location;

  if (event.start && event.end) {
    eventBody.start = event.allDay
      ? { date: event.start.toISOString().split('T')[0] }
      : { dateTime: event.start.toISOString() };
    eventBody.end = event.allDay
      ? { date: toGoogleAllDayEndDate(event.end) }
      : { dateTime: event.end.toISOString() };
  }

  if (event.recurrence !== undefined) {
    eventBody.recurrence = event.recurrence ? [`RRULE:${event.recurrence}`] : [];
  }

  const response = await calendar.events.patch({
    calendarId: googleCalendarId,
    eventId: googleEventId,
    requestBody: eventBody,
  });

  return { id: response.data.id!, updated: response.data.updated ?? null };
}

export async function deleteGoogleEvent(
  accessToken: string,
  googleCalendarId: string,
  googleEventId: string
): Promise<void> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  await calendar.events.delete({
    calendarId: googleCalendarId,
    eventId: googleEventId,
  });
}
