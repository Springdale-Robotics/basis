import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import { db } from '../../config/database.js';
import { calendars, calendarEvents } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';

const SCOPES = [
  'Calendars.Read',
  'Calendars.ReadWrite',
  'offline_access',
];

export function createMsalClient(): ConfidentialClientApplication | null {
  if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
    return null;
  }

  return new ConfidentialClientApplication({
    auth: {
      clientId: config.MICROSOFT_CLIENT_ID,
      clientSecret: config.MICROSOFT_CLIENT_SECRET,
      authority: 'https://login.microsoftonline.com/common',
    },
  });
}

export function getAuthUrl(msalClient: ConfidentialClientApplication, redirectUri: string, state: string): string {
  return msalClient.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri,
    state,
    prompt: 'consent',
  }) as unknown as string;
}

export async function getTokensFromCode(
  msalClient: ConfidentialClientApplication,
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expiry_date: number }> {
  const response = await msalClient.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri,
  });

  if (!response || !response.accessToken) {
    throw new Error('Failed to get tokens from Microsoft');
  }

  return {
    access_token: response.accessToken,
    refresh_token: (response as any).refreshToken || '',
    expiry_date: response.expiresOn ? response.expiresOn.getTime() : Date.now() + 3600000,
  };
}

export async function refreshTokens(
  msalClient: ConfidentialClientApplication,
  refreshToken: string
): Promise<{ access_token: string; expiry_date: number }> {
  const response = await msalClient.acquireTokenByRefreshToken({
    refreshToken,
    scopes: SCOPES,
  });

  if (!response || !response.accessToken) {
    throw new Error('Failed to refresh tokens');
  }

  return {
    access_token: response.accessToken,
    expiry_date: response.expiresOn ? response.expiresOn.getTime() : Date.now() + 3600000,
  };
}

function getGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

export interface OutlookCalendarInfo {
  id: string;
  name: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
}

export async function listOutlookCalendars(accessToken: string): Promise<OutlookCalendarInfo[]> {
  const client = getGraphClient(accessToken);
  const response = await client.api('/me/calendars').get();

  return (response.value || []).map((cal: any) => ({
    id: cal.id,
    name: cal.name || 'Untitled Calendar',
    color: cal.color || undefined,
    isDefaultCalendar: cal.isDefaultCalendar || false,
    canEdit: cal.canEdit || false,
  }));
}

export interface OutlookCalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  recurrence?: {
    pattern: { type: string; interval: number; daysOfWeek?: string[]; dayOfMonth?: number };
    range: { type: string; startDate: string; endDate?: string; numberOfOccurrences?: number };
  };
  isCancelled?: boolean;
  // For exception instances (modified occurrences)
  seriesMasterId?: string;
  type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster';
  originalStart?: { dateTime: string; timeZone: string };
}

export async function fetchOutlookEvents(
  accessToken: string,
  outlookCalendarId: string,
  startDateTime?: Date,
  endDateTime?: Date
): Promise<OutlookCalendarEvent[]> {
  const client = getGraphClient(accessToken);

  let url = `/me/calendars/${outlookCalendarId}/events`;
  const params: string[] = [];

  if (startDateTime) {
    params.push(`$filter=start/dateTime ge '${startDateTime.toISOString()}'`);
  }

  if (params.length > 0) {
    url += '?' + params.join('&');
  }

  const events: OutlookCalendarEvent[] = [];
  let nextLink: string | undefined = url;

  while (nextLink) {
    const response = await client.api(nextLink).get();

    for (const event of response.value || []) {
      if (event.id) {
        events.push({
          id: event.id,
          subject: event.subject || undefined,
          bodyPreview: event.bodyPreview || undefined,
          location: event.location || undefined,
          start: event.start,
          end: event.end,
          isAllDay: event.isAllDay || false,
          recurrence: event.recurrence || undefined,
          isCancelled: event.isCancelled || false,
          seriesMasterId: event.seriesMasterId || undefined,
          type: event.type || 'singleInstance',
          originalStart: event.originalStart || undefined,
        });
      }
    }

    nextLink = response['@odata.nextLink'];
  }

  return events;
}

// Convert Outlook recurrence to iCal RRULE format
function convertRecurrenceToRRule(recurrence: OutlookCalendarEvent['recurrence']): string | null {
  if (!recurrence || !recurrence.pattern) return null;

  const { pattern, range } = recurrence;
  const parts: string[] = [];

  // Frequency
  switch (pattern.type) {
    case 'daily':
      parts.push('FREQ=DAILY');
      break;
    case 'weekly':
      parts.push('FREQ=WEEKLY');
      break;
    case 'absoluteMonthly':
    case 'relativeMonthly':
      parts.push('FREQ=MONTHLY');
      break;
    case 'absoluteYearly':
    case 'relativeYearly':
      parts.push('FREQ=YEARLY');
      break;
    default:
      return null;
  }

  // Interval
  if (pattern.interval && pattern.interval > 1) {
    parts.push(`INTERVAL=${pattern.interval}`);
  }

  // Days of week
  if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
    const dayMap: Record<string, string> = {
      sunday: 'SU',
      monday: 'MO',
      tuesday: 'TU',
      wednesday: 'WE',
      thursday: 'TH',
      friday: 'FR',
      saturday: 'SA',
    };
    const days = pattern.daysOfWeek.map((d) => dayMap[d.toLowerCase()] || '').filter(Boolean);
    if (days.length > 0) {
      parts.push(`BYDAY=${days.join(',')}`);
    }
  }

  // Day of month
  if (pattern.dayOfMonth) {
    parts.push(`BYMONTHDAY=${pattern.dayOfMonth}`);
  }

  // Range
  if (range) {
    if (range.type === 'endDate' && range.endDate) {
      parts.push(`UNTIL=${range.endDate.replace(/-/g, '')}T235959Z`);
    } else if (range.type === 'numbered' && range.numberOfOccurrences) {
      parts.push(`COUNT=${range.numberOfOccurrences}`);
    }
  }

  return parts.join(';');
}

export async function syncCalendarFromOutlook(
  calendarId: string,
  householdId: string
): Promise<{ created: number; updated: number; deleted: number }> {
  const log = logger.child({ calendarId, householdId });
  log.info('Starting Outlook Calendar sync');

  // Get calendar with sync credentials
  const calendar = await db.query.calendars.findFirst({
    where: and(
      eq(calendars.id, calendarId),
      eq(calendars.householdId, householdId),
      eq(calendars.isSynced, true),
      eq(calendars.syncProvider, 'outlook')
    ),
  });

  if (!calendar || !calendar.syncCredentials || !calendar.syncCalendarId) {
    throw new Error('Calendar not found or not configured for Outlook sync');
  }

  // Decrypt credentials
  let credentials: { access_token: string; refresh_token: string; expiry_date: number };
  try {
    credentials = JSON.parse(decrypt(calendar.syncCredentials));
  } catch {
    throw new Error('Failed to decrypt sync credentials');
  }

  // Check if token needs refresh
  const msalClient = createMsalClient();
  if (!msalClient) {
    throw new Error('Microsoft OAuth not configured');
  }

  let accessToken = credentials.access_token;

  if (credentials.expiry_date < Date.now() + 60000) {
    // Refresh if expiring within 1 minute
    log.info('Refreshing access token');
    try {
      const newTokens = await refreshTokens(msalClient, credentials.refresh_token);
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
          syncError: 'Authentication expired. Please reconnect your Microsoft account.',
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));
      throw new Error('Failed to refresh access token');
    }
  }

  // Fetch events from Outlook
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  let outlookEvents: OutlookCalendarEvent[];
  try {
    outlookEvents = await fetchOutlookEvents(
      accessToken,
      calendar.syncCalendarId,
      threeMonthsAgo
    );
  } catch (error) {
    log.error({ error }, 'Failed to fetch events from Outlook');
    await db
      .update(calendars)
      .set({
        syncError: 'Failed to fetch events from Outlook Calendar.',
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

  const outlookEventIds = new Set(outlookEvents.map((e) => e.id));

  // Separate master events and exception instances
  const masterEvents = outlookEvents.filter(e => e.type === 'seriesMaster' || (!e.seriesMasterId && !e.type));
  const exceptionEvents = outlookEvents.filter(e => e.type === 'exception' || e.seriesMasterId);

  // Map external IDs to db IDs for linking exceptions to masters
  const externalIdToDbId: Record<string, string> = {};

  // First pass: Process master events and single instances
  for (const outlookEvent of masterEvents) {
    const existing = existingByExternalId.get(outlookEvent.id);

    // Skip cancelled events without valid start/end
    if (outlookEvent.isCancelled || !outlookEvent.start) {
      continue;
    }

    const isAllDay = outlookEvent.isAllDay || false;
    const startTime = new Date(outlookEvent.start.dateTime);
    const endTime = new Date(outlookEvent.end.dateTime);

    // Convert recurrence rules
    const recurrenceRule = convertRecurrenceToRRule(outlookEvent.recurrence);

    const eventData = {
      title: outlookEvent.subject || 'Untitled Event',
      description: outlookEvent.bodyPreview || null,
      location: outlookEvent.location?.displayName || null,
      startTime,
      endTime,
      allDay: isAllDay,
      recurrenceRule,
      recurrenceStatus: recurrenceRule ? 'master' as const : null,
      externalId: outlookEvent.id,
      updatedAt: new Date(),
    };

    if (existing) {
      // Update existing event
      await db
        .update(calendarEvents)
        .set(eventData)
        .where(eq(calendarEvents.id, existing.id));
      externalIdToDbId[outlookEvent.id] = existing.id;
      updated++;
    } else {
      // Create new event
      const [inserted] = await db.insert(calendarEvents).values({
        calendarId,
        ...eventData,
      }).returning();
      externalIdToDbId[outlookEvent.id] = inserted.id;
      created++;
    }
  }

  // Second pass: Process exception instances
  for (const outlookEvent of exceptionEvents) {
    const existing = existingByExternalId.get(outlookEvent.id);

    const isAllDay = outlookEvent.isAllDay || false;
    const isCancelled = outlookEvent.isCancelled || false;

    // Get original start time
    let originalStartTime: Date | null = null;
    if (outlookEvent.originalStart) {
      originalStartTime = new Date(outlookEvent.originalStart.dateTime);
    }

    // Find master event ID
    const masterDbId = outlookEvent.seriesMasterId
      ? externalIdToDbId[outlookEvent.seriesMasterId]
      : null;

    // For cancelled instances, we might not have valid start/end
    let startTime = originalStartTime;
    let endTime = originalStartTime;

    if (!isCancelled && outlookEvent.start) {
      startTime = new Date(outlookEvent.start.dateTime);
      endTime = new Date(outlookEvent.end.dateTime);
    }

    if (!startTime || !endTime) {
      continue;
    }

    const eventData = {
      title: outlookEvent.subject || 'Untitled Event',
      description: outlookEvent.bodyPreview || null,
      location: outlookEvent.location?.displayName || null,
      startTime,
      endTime,
      allDay: isAllDay,
      recurringEventId: masterDbId,
      originalStartTime,
      recurrenceStatus: isCancelled ? 'cancelled' as const : 'exception' as const,
      externalId: outlookEvent.id,
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

  // Delete events that no longer exist in Outlook
  for (const existing of existingEvents) {
    if (existing.externalId && !outlookEventIds.has(existing.externalId)) {
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

  log.info({ created, updated, deleted }, 'Outlook Calendar sync completed');

  return { created, updated, deleted };
}
