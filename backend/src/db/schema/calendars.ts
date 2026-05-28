import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  integer,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';
import { devices } from './devices.js';

export const syncProviderEnum = pgEnum('sync_provider', ['google', 'outlook']);
export const calendarTypeEnum = pgEnum('calendar_type', ['individual', 'group', 'synced']);
export const rsvpStatusEnum = pgEnum('rsvp_status', ['pending', 'accepted', 'declined', 'maybe']);
export const reminderTypeEnum = pgEnum('reminder_type', ['notification', 'email', 'push']);

export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#3B82F6'),
  colorIndex: integer('color_index').default(0).notNull(),
  pattern: varchar('pattern', { length: 50 }).default('solid'),
  type: calendarTypeEnum('type').notNull().default('individual'),
  isDefault: boolean('is_default').default(false).notNull(),
  isReadOnly: boolean('is_read_only').default(false).notNull(),
  isSynced: boolean('is_synced').default(false).notNull(),
  syncProvider: syncProviderEnum('sync_provider'),
  syncCredentials: text('sync_credentials'),
  syncCalendarId: varchar('sync_calendar_id', { length: 255 }),
  lastSyncAt: timestamp('last_sync_at'),
  syncError: text('sync_error'),
  publicToken: varchar('public_token', { length: 64 }),
  publicTokenCreatedAt: timestamp('public_token_created_at'),
  // CalDAV sync primitives — bumped together on any event change in this calendar.
  // ctag = arbitrary opaque token (legacy compat: getctag property).
  // syncToken = monotonic per-calendar counter (RFC 6578 sync-collection REPORT).
  ctag: varchar('ctag', { length: 64 }),
  syncToken: integer('sync_token').notNull().default(0),
  timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const recurrenceStatusEnum = pgEnum('recurrence_status', ['master', 'exception', 'cancelled']);

export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => calendars.id, { onDelete: 'cascade' }),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  location: varchar('location', { length: 500 }),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }).notNull(),
  allDay: boolean('all_day').default(false).notNull(),
  color: varchar('color', { length: 7 }),
  // Recurrence fields (RFC 5545 compliant)
  recurrenceRule: text('recurrence_rule'),  // Full RRULE string (changed from varchar(255) to text)
  recurrenceExDates: text('recurrence_ex_dates'),  // JSON array of excluded ISO date strings
  recurrenceRDates: text('recurrence_r_dates'),  // JSON array of additional ISO date strings
  // Exception instance fields (for modified occurrences of recurring events)
  recurringEventId: uuid('recurring_event_id').references((): any => calendarEvents.id, { onDelete: 'cascade' }),
  originalStartTime: timestamp('original_start_time', { withTimezone: true }),  // Original occurrence time (unique identifier for exception)
  recurrenceStatus: recurrenceStatusEnum('recurrence_status'),  // 'master' | 'exception' | 'cancelled'
  externalId: varchar('external_id', { length: 255 }),
  // Bumped on every event write — drives ETag for CalDAV GET/PUT.
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Event attendees for invitations and RSVP
export const eventAttendees = pgTable('event_attendees', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }),
  displayName: varchar('display_name', { length: 255 }),
  rsvpStatus: rsvpStatusEnum('rsvp_status').notNull().default('pending'),
  rsvpAt: timestamp('rsvp_at'),
  isOrganizer: boolean('is_organizer').default(false).notNull(),
  notified: boolean('notified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Event reminders for notifications
export const eventReminders = pgTable('event_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => calendarEvents.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  reminderType: reminderTypeEnum('reminder_type').notNull().default('notification'),
  minutesBefore: integer('minutes_before').notNull().default(15),
  sent: boolean('sent').default(false).notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const visibilityScopeTypeEnum = pgEnum('visibility_scope_type', [
  'user',
  'device',
  'household',
]);

export const calendarVisibility = pgTable('calendar_visibility', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => calendars.id, { onDelete: 'cascade' }),
  scopeType: visibilityScopeTypeEnum('scope_type').notNull(),
  scopeId: uuid('scope_id').notNull(),
  isVisible: boolean('is_visible').default(true).notNull(),
  isDefaultVisible: boolean('is_default_visible').default(true).notNull(),
});

// Intra-household calendar access control.
//
// A calendar with NO rows here means "all household members, edit" (backward
// compatible with the pre-existing behavior). Adding rows narrows the scope:
// listed principals get the given permission, everyone else gets nothing.
// Used by both REST endpoints and the CalDAV server.
export const calendarAccessPrincipalEnum = pgEnum('calendar_access_principal', [
  'user',
  'group',
  'role',
]);
export const calendarAccessLevelEnum = pgEnum('calendar_access_level', [
  'view_busy',
  'view',
  'edit',
]);

// Per-calendar change journal for RFC 6578 sync-collection REPORT. The CalDAV
// client sends its last seen syncToken and gets back the deltas since.
export const calendarChangeTypeEnum = pgEnum('calendar_change_type', [
  'add',
  'update',
  'delete',
]);

export const calendarChanges = pgTable(
  'calendar_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    eventUid: varchar('event_uid', { length: 255 }).notNull(),
    changeType: calendarChangeTypeEnum('change_type').notNull(),
    syncToken: integer('sync_token').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  }
);

export const calendarAccess = pgTable('calendar_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => calendars.id, { onDelete: 'cascade' }),
  principalType: calendarAccessPrincipalEnum('principal_type').notNull(),
  // text rather than uuid: holds a UUID for user/group rules, or a role name
  // ("admin" | "member" | "kid" | "visitor") for role rules. A CHECK
  // constraint in the DB enforces the role values when principalType='role'.
  principalId: text('principal_id').notNull(),
  permissionLevel: calendarAccessLevelEnum('permission_level').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Calendar = typeof calendars.$inferSelect;
export type NewCalendar = typeof calendars.$inferInsert;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type CalendarVisibility = typeof calendarVisibility.$inferSelect;
export type NewCalendarVisibility = typeof calendarVisibility.$inferInsert;
export type CalendarAccess = typeof calendarAccess.$inferSelect;
export type NewCalendarAccess = typeof calendarAccess.$inferInsert;
export type CalendarPermissionLevel = 'view_busy' | 'view' | 'edit';
export type CalendarChange = typeof calendarChanges.$inferSelect;
export type NewCalendarChange = typeof calendarChanges.$inferInsert;
export type CalendarChangeType = 'add' | 'update' | 'delete';
export type EventAttendee = typeof eventAttendees.$inferSelect;
export type NewEventAttendee = typeof eventAttendees.$inferInsert;
export type EventReminder = typeof eventReminders.$inferSelect;
export type NewEventReminder = typeof eventReminders.$inferInsert;
export type RsvpStatus = 'pending' | 'accepted' | 'declined' | 'maybe';
export type ReminderType = 'notification' | 'email' | 'push';
export type RecurrenceStatus = 'master' | 'exception' | 'cancelled';
