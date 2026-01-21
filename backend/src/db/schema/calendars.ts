import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { users } from './users';
import { devices } from './devices';

export const syncProviderEnum = pgEnum('sync_provider', ['google', 'outlook']);
export const calendarTypeEnum = pgEnum('calendar_type', ['individual', 'group', 'synced']);

export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#3B82F6'),
  pattern: varchar('pattern', { length: 50 }).default('solid'),
  type: calendarTypeEnum('type').notNull().default('individual'),
  isSynced: boolean('is_synced').default(false).notNull(),
  syncProvider: syncProviderEnum('sync_provider'),
  syncCredentials: text('sync_credentials'),
  syncCalendarId: varchar('sync_calendar_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => calendars.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  allDay: boolean('all_day').default(false).notNull(),
  recurrenceRule: varchar('recurrence_rule', { length: 255 }),
  externalId: varchar('external_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
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

export type Calendar = typeof calendars.$inferSelect;
export type NewCalendar = typeof calendars.$inferInsert;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type NewCalendarEvent = typeof calendarEvents.$inferInsert;
export type CalendarVisibility = typeof calendarVisibility.$inferSelect;
export type NewCalendarVisibility = typeof calendarVisibility.$inferInsert;
