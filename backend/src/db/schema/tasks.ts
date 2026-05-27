import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { households } from './households';
import { users } from './users';
import { groups } from './groups';

export const taskKindEnum = pgEnum('task_kind', ['task', 'chore']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'completed']);
export const recurrenceModeEnum = pgEnum('recurrence_mode', [
  'schedule',
  'reset_on_complete',
]);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: taskKindEnum('kind').notNull().default('task'),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),

    // Polymorphic assignment: exactly one (or neither) of these is set.
    // Neither set = unassigned to the household at large.
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    assigneeGroupId: uuid('assignee_group_id').references(() => groups.id, {
      onDelete: 'set null',
    }),

    // Tasks: dueDate is the deadline. Chores: dueDate is the next due-by date
    // (computed from cadence or rule on completion).
    dueDate: timestamp('due_date'),

    // Chore cadence in days, used when recurrenceMode = 'reset_on_complete'.
    cadenceDays: integer('cadence_days'),

    // Recurrence settings. NULL means non-recurring (one-shot task).
    recurrenceMode: recurrenceModeEnum('recurrence_mode'),
    // iCal RRULE string, used when recurrenceMode = 'schedule'.
    recurrenceRule: varchar('recurrence_rule', { length: 255 }),

    // Completion tracking. For chores, status stays 'pending' after completion
    // (we just bump lastCompletedAt and recompute dueDate).
    status: taskStatusEnum('status').notNull().default('pending'),
    lastCompletedAt: timestamp('last_completed_at'),
    lastCompletedBy: uuid('last_completed_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    pinned: boolean('pinned').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),

    rewardPoints: integer('reward_points').default(0).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'tasks_assignee_xor',
      sql`${table.assigneeUserId} IS NULL OR ${table.assigneeGroupId} IS NULL`,
    ),
  ],
);

export const rewards = pgTable('rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  points: integer('points').default(0).notNull(),
  lifetimePoints: integer('lifetime_points').default(0).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rewardHistory = pgTable('reward_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardId: uuid('reward_id')
    .notNull()
    .references(() => rewards.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  pointsChange: integer('points_change').notNull(),
  reason: varchar('reason', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Reward = typeof rewards.$inferSelect;
export type NewReward = typeof rewards.$inferInsert;
export type RewardHistory = typeof rewardHistory.$inferSelect;
