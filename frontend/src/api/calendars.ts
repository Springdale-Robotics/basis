import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type {
  Calendar,
  CalendarEvent,
  EventAttendee,
  EventReminder,
  RsvpStatus,
  ReminderType,
} from '@/types/models';

export interface CreateCalendarRequest {
  name: string;
  color?: string;
  pattern?: string;
  type?: 'group' | 'individual';
}

export interface UpdateCalendarRequest {
  name?: string;
  color?: string;
  pattern?: string;
}

export interface CreateEventRequest {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  color?: string;
  recurrenceRule?: string | null;
  attendees?: Array<{
    userId?: string;
    email?: string;
    displayName?: string;
  }>;
  reminders?: Array<{
    type?: ReminderType;
    minutesBefore: number;
  }>;
}

export interface UpdateEventRequest {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  color?: string | null;
  recurrenceRule?: string | null;
}

export interface GetEventsParams {
  start?: string;
  end?: string;
}

export interface SearchEventsParams {
  q?: string;
  calendarIds?: string;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}

export interface AddAttendeeRequest {
  userId?: string;
  email?: string;
  displayName?: string;
}

export interface AddReminderRequest {
  type?: ReminderType;
  minutesBefore: number;
}

export const calendarsApi = {
  // Calendar CRUD
  list: () =>
    apiGet<{ calendars: Calendar[] }>('/calendars'),

  get: (id: string) =>
    apiGet<{ calendar: Calendar }>(`/calendars/${id}`),

  create: (data: CreateCalendarRequest) =>
    apiPost<{ calendar: Calendar }>('/calendars', data),

  update: (id: string, data: UpdateCalendarRequest) =>
    apiPatch<{ calendar: Calendar }>(`/calendars/${id}`, data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/calendars/${id}`),

  // Events - aggregated across all calendars
  getEvents: (params?: GetEventsParams) =>
    apiGet<{ events: CalendarEvent[] }>('/calendars/events', { params: params as Record<string, string | number | boolean | undefined> }),

  // Events for a specific calendar
  getCalendarEvents: (calendarId: string, params?: GetEventsParams) =>
    apiGet<{ events: CalendarEvent[] }>(`/calendars/${calendarId}/events`, { params: params as Record<string, string | number | boolean | undefined> }),

  getEvent: (calendarId: string, eventId: string) =>
    apiGet<{ event: CalendarEvent }>(`/calendars/${calendarId}/events/${eventId}`),

  // Get event with full details (attendees, reminders, creator)
  getEventDetails: (calendarId: string, eventId: string) =>
    apiGet<{ event: CalendarEvent }>(`/calendars/${calendarId}/events/${eventId}/details`),

  createEvent: (data: CreateEventRequest) =>
    apiPost<{ event: CalendarEvent }>(`/calendars/${data.calendarId}/events`, data),

  updateEvent: (calendarId: string, eventId: string, data: UpdateEventRequest) =>
    apiPatch<{ event: CalendarEvent }>(`/calendars/${calendarId}/events/${eventId}`, data),

  deleteEvent: (calendarId: string, eventId: string) =>
    apiDelete<{ message: string }>(`/calendars/${calendarId}/events/${eventId}`),

  // Search events
  searchEvents: (params: SearchEventsParams) =>
    apiGet<{ events: CalendarEvent[]; total: number }>('/calendars/events/search', { params: params as Record<string, string | number | boolean | undefined> }),

  // Attendees (Invitations & RSVP)
  getAttendees: (calendarId: string, eventId: string) =>
    apiGet<{ attendees: EventAttendee[] }>(`/calendars/${calendarId}/events/${eventId}/attendees`),

  addAttendee: (calendarId: string, eventId: string, data: AddAttendeeRequest) =>
    apiPost<{ attendee: EventAttendee }>(`/calendars/${calendarId}/events/${eventId}/attendees`, data),

  updateRsvp: (calendarId: string, eventId: string, attendeeId: string, status: RsvpStatus) =>
    apiPatch<{ attendee: EventAttendee }>(`/calendars/${calendarId}/events/${eventId}/attendees/${attendeeId}/rsvp`, { status }),

  removeAttendee: (calendarId: string, eventId: string, attendeeId: string) =>
    apiDelete<{ message: string }>(`/calendars/${calendarId}/events/${eventId}/attendees/${attendeeId}`),

  // Reminders
  getReminders: (calendarId: string, eventId: string) =>
    apiGet<{ reminders: EventReminder[] }>(`/calendars/${calendarId}/events/${eventId}/reminders`),

  addReminder: (calendarId: string, eventId: string, data: AddReminderRequest) =>
    apiPost<{ reminder: EventReminder }>(`/calendars/${calendarId}/events/${eventId}/reminders`, data),

  deleteReminder: (calendarId: string, eventId: string, reminderId: string) =>
    apiDelete<{ message: string }>(`/calendars/${calendarId}/events/${eventId}/reminders/${reminderId}`),

  // Google Calendar Sync
  getGoogleSyncStatus: () =>
    apiGet<{ configured: boolean }>('/calendars/sync/google/status'),

  startGoogleConnect: () =>
    apiPost<{ authUrl: string }>('/calendars/sync/google/connect'),

  getGoogleCalendars: () =>
    apiGet<{ calendars: Array<{
      id: string;
      summary: string;
      description?: string;
      backgroundColor?: string;
      primary?: boolean;
    }> }>('/calendars/sync/google/calendars'),

  completeGoogleSync: (data: { googleCalendarId: string; name: string; color?: string }) =>
    apiPost<{ calendar: Calendar; syncResult?: { created: number; updated: number; deleted: number }; syncError?: string }>('/calendars/sync/google/complete', data),

  triggerSync: (calendarId: string) =>
    apiPost<{ syncResult: { created: number; updated: number; deleted: number } }>(`/calendars/${calendarId}/sync`),

  disconnectSync: (calendarId: string) =>
    apiPost<{ calendar: Calendar }>(`/calendars/${calendarId}/disconnect`),

  getSyncStatus: (calendarId: string) =>
    apiGet<{ synced: boolean; provider?: string; lastSyncAt?: string; error?: string }>(`/calendars/${calendarId}/sync/status`),

  // ICS Import/Export
  importIcs: async (calendarId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`/api/v1/calendars/${calendarId}/import`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to import ICS file');
    }
    return response.json() as Promise<{ imported: number; skipped: number; errors: string[] }>;
  },

  getExportUrl: (calendarId: string, options?: { start?: string; end?: string }) => {
    let url = `/api/v1/calendars/${calendarId}/export`;
    const params = new URLSearchParams();
    if (options?.start) params.set('start', options.start);
    if (options?.end) params.set('end', options.end);
    if (params.toString()) url += `?${params.toString()}`;
    return url;
  },

  getExportAllUrl: () => '/api/v1/calendars/export/all',

  // Outlook Calendar Sync
  getOutlookSyncStatus: () =>
    apiGet<{ configured: boolean }>('/calendars/sync/outlook/status'),

  startOutlookConnect: () =>
    apiPost<{ authUrl: string }>('/calendars/sync/outlook/connect'),

  getOutlookCalendars: () =>
    apiGet<{ calendars: Array<{
      id: string;
      name: string;
      color?: string;
      isDefaultCalendar?: boolean;
      canEdit?: boolean;
    }> }>('/calendars/sync/outlook/calendars'),

  completeOutlookSync: (data: { outlookCalendarId: string; name: string; color?: string }) =>
    apiPost<{ calendar: Calendar; syncResult?: { created: number; updated: number; deleted: number }; syncError?: string }>('/calendars/sync/outlook/complete', data),
};
