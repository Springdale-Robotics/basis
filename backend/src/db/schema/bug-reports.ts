import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { households } from './households';

export const bugReportStatusEnum = pgEnum('bug_report_status', ['pending', 'sent', 'failed']);

export interface ConsoleLogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'unhandled' | 'rejection';
  ts: number;
  message: string;
}

export interface Viewport {
  w: number;
  h: number;
}

export const bugReports = pgTable('bug_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  url: text('url').notNull(),
  userAgent: text('user_agent'),
  appVersion: varchar('app_version', { length: 50 }),
  consoleLog: jsonb('console_log').$type<ConsoleLogEntry[]>().default([]).notNull(),
  screenshot: text('screenshot'),
  viewport: jsonb('viewport').$type<Viewport>(),
  status: bugReportStatusEnum('status').notNull().default('pending'),
  githubIssueNumber: integer('github_issue_number'),
  githubIssueUrl: text('github_issue_url'),
  lastError: text('last_error'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type BugReport = typeof bugReports.$inferSelect;
export type NewBugReport = typeof bugReports.$inferInsert;
