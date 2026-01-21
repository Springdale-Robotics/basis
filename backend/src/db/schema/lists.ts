import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { users } from './users';

export const listTypeEnum = pgEnum('list_type', ['checklist', 'reminder', 'notes']);

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: listTypeEnum('type').notNull().default('checklist'),
  icon: varchar('icon', { length: 50 }),
  color: varchar('color', { length: 7 }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const listItems = pgTable('list_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  listId: uuid('list_id')
    .notNull()
    .references(() => lists.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  isChecked: boolean('is_checked').default(false).notNull(),
  dueDate: timestamp('due_date'),
  reminderSent: boolean('reminder_sent').default(false).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  checkedAt: timestamp('checked_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;
export type ListItem = typeof listItems.$inferSelect;
export type NewListItem = typeof listItems.$inferInsert;
