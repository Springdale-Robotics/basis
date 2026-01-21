import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Calendar, CalendarEvent } from '@/types/models';

export interface CreateCalendarRequest {
  name: string;
  color?: string;
  pattern?: string;
  type?: 'household' | 'individual';
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
  startTime: string;
  endTime: string;
  allDay?: boolean;
  recurrenceRule?: string | null;
}

export interface UpdateEventRequest {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  recurrenceRule?: string | null;
}

export interface GetEventsParams {
  start?: string;
  end?: string;
}

export const calendarsApi = {
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

  createEvent: (data: CreateEventRequest) =>
    apiPost<{ event: CalendarEvent }>(`/calendars/${data.calendarId}/events`, data),

  updateEvent: (calendarId: string, eventId: string, data: UpdateEventRequest) =>
    apiPatch<{ event: CalendarEvent }>(`/calendars/${calendarId}/events/${eventId}`, data),

  deleteEvent: (calendarId: string, eventId: string) =>
    apiDelete<{ message: string }>(`/calendars/${calendarId}/events/${eventId}`),
};
