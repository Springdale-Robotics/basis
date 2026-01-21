import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../../config/database.js';
import { calendars, calendarEvents } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

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
  }));
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
          recurringEventId: event.recurringEventId || undefined,
          originalStartTime: event.originalStartTime as GoogleCalendarEvent['originalStartTime'],
        });
      }
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return events;
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
          syncError: 'Authentication expired. Please reconnect your Google account.',
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));
      throw new Error('Failed to refresh access token');
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
      updatedAt: new Date(),
    };

    if (existing) {
      // Update existing event
      await db
        .update(calendarEvents)
        .set(eventData)
        .where(eq(calendarEvents.id, existing.id));
      externalIdToDbId[googleEvent.id] = existing.id;
      updated++;
    } else {
      // Create new event
      const [inserted] = await db.insert(calendarEvents).values({
        calendarId,
        ...eventData,
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
      updatedAt: new Date(),
    };

    if (existing) {
      // Update existing exception
      await db
        .update(calendarEvents)
        .set(eventData)
        .where(eq(calendarEvents.id, existing.id));
      updated++;
    } else {
      // Create new exception
      await db.insert(calendarEvents).values({
        calendarId,
        ...eventData,
      });
      created++;
    }
  }

  // Delete events that no longer exist in Google
  for (const existing of existingEvents) {
    if (existing.externalId && !googleEventIds.has(existing.externalId)) {
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
): Promise<string> {
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
      ? { date: event.end.toISOString().split('T')[0] }
      : { dateTime: event.end.toISOString() },
  };

  if (event.recurrence) {
    eventBody.recurrence = [`RRULE:${event.recurrence}`];
  }

  const response = await calendar.events.insert({
    calendarId: googleCalendarId,
    requestBody: eventBody,
  });

  return response.data.id!;
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
): Promise<void> {
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
      ? { date: event.end.toISOString().split('T')[0] }
      : { dateTime: event.end.toISOString() };
  }

  if (event.recurrence !== undefined) {
    eventBody.recurrence = event.recurrence ? [`RRULE:${event.recurrence}`] : [];
  }

  await calendar.events.patch({
    calendarId: googleCalendarId,
    eventId: googleEventId,
    requestBody: eventBody,
  });
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
