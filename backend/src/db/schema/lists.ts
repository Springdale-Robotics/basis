import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';

// `reminder` is retained for backwards compatibility but no longer exposed in
// the UI — reminders live in Tasks. New lists pick checklist | wishlist | notes.
export const listTypeEnum = pgEnum('list_type', [
  'checklist',
  'reminder',
  'notes',
  'wishlist',
]);

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: listTypeEnum('type').notNull().default('checklist'),
  icon: varchar('icon', { length: 50 }),
  color: varchar('color', { length: 7 }),
  // Wishlist recipient — the person the list is *for*. Backend strips
  // `claimedByUserId` from item responses when the requester matches this id.
  recipientUserId: uuid('recipient_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  isTemplate: boolean('is_template').default(false).notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  archivedAt: timestamp('archived_at'),
  // When a list is created by "Use template", track the template it came from.
  parentListId: uuid('parent_list_id'),
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
  sortOrder: integer('sort_order').default(0).notNull(),
  // Single level of nesting: parent_item_id points at another row in this same
  // list. Deeper nesting is intentionally not allowed at the UI level.
  parentItemId: uuid('parent_item_id'),
  sectionLabel: varchar('section_label', { length: 100 }),
  assigneeUserId: uuid('assignee_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  notes: text('notes'),
  url: text('url'),
  // Used by wishlist items (price the giver might pay).
  price: decimal('price', { precision: 10, scale: 2 }),
  // Wishlist claim. Hidden from the recipient by the backend.
  claimedByUserId: uuid('claimed_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  claimedAt: timestamp('claimed_at'),
  // Points awarded when this item gets checked (only honored when the
  // household's rewards feature is enabled).
  rewardPoints: integer('reward_points').default(0).notNull(),
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
