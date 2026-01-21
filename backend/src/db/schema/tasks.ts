import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { users } from './users';

export const taskStatusEnum = pgEnum('task_status', ['pending', 'in_progress', 'completed']);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  dueDate: timestamp('due_date'),
  recurrenceRule: varchar('recurrence_rule', { length: 255 }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  status: taskStatusEnum('status').notNull().default('pending'),
  isChore: boolean('is_chore').default(false).notNull(),
  rewardPoints: integer('reward_points').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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

export const achievementCriteriaTypeEnum = pgEnum('achievement_criteria_type', [
  'manual',
  'automatic',
  'milestone',
]);

export const achievements = pgTable('achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  icon: varchar('icon', { length: 50 }),
  points: integer('points').default(0).notNull(),
  criteriaType: achievementCriteriaTypeEnum('criteria_type').notNull().default('manual'),
  criteria: jsonb('criteria').$type<AchievementCriteria>(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface AchievementCriteria {
  type: 'milestone' | 'manual';
  metric?: string;
  threshold?: number;
}

export const userAchievements = pgTable('user_achievements', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  achievementId: uuid('achievement_id')
    .notNull()
    .references(() => achievements.id, { onDelete: 'cascade' }),
  awardedAt: timestamp('awarded_at').defaultNow().notNull(),
  awardedBy: uuid('awarded_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Reward = typeof rewards.$inferSelect;
export type NewReward = typeof rewards.$inferInsert;
export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;
