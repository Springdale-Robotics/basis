import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  decimal,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { users } from './users';

// Enums for image parsing
export const parsedContentTypeEnum = pgEnum('parsed_content_type', [
  'list',
  'recipe',
  'calendar_event',
  'mixed',
  'unknown',
]);

export const imageParseStatusEnum = pgEnum('image_parse_status', [
  'uploading',
  'processing',
  'review',
  'confirmed',
  'cancelled',
  'failed',
]);

// Processing stage enum for progress tracking
export const processingStageEnum = pgEnum('processing_stage', [
  'queued',
  'vlm_started',
  'vlm_done',
  'llm_started',
  'llm_done',
]);

// Main table for image parse sessions
export const imageParseSessions = pgTable('image_parse_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Image storage
  originalImagePath: text('original_image_path'),
  imageMimeType: varchar('image_mime_type', { length: 50 }),

  // Processing state
  status: imageParseStatusEnum('status').notNull().default('uploading'),
  processingStage: processingStageEnum('processing_stage'),

  // AI extraction results
  rawText: text('raw_text'),  // Raw text extracted from image
  detectedType: parsedContentTypeEnum('detected_type'),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),

  // Parsed content (JSONB for flexibility)
  parsedContent: jsonb('parsed_content').$type<ParsedContent>(),

  // User selections and edits
  selectedType: parsedContentTypeEnum('selected_type'),
  userEdits: jsonb('user_edits').$type<UserEdits>(),

  // Warnings and metadata
  parseWarnings: jsonb('parse_warnings').$type<string[]>().default([]),
  processingTimeMs: decimal('processing_time_ms', { precision: 10, scale: 2 }),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

// Parsed content types
export interface ParsedListContent {
  title?: string;
  items: ParsedListItem[];
  suggestedListType: 'checklist' | 'reminder' | 'notes';
}

export interface ParsedListItem {
  content: string;
  isChecked?: boolean;
  dueDate?: string;  // ISO date string
  confidence: number;
}

export interface ParsedRecipeContent {
  title: string;
  description?: string;
  instructions: string[];
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  imageUrl?: string;
  ingredients: ParsedRecipeIngredient[];
}

export interface ParsedRecipeIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
  confidence: number;
}

export interface ParsedCalendarEvent {
  title: string;
  description?: string;
  location?: string;
  startTime?: string;  // ISO 8601
  endTime?: string;
  allDay?: boolean;
  recurrenceHint?: string;
  confidence: number;
}

export interface ParsedCalendarContent {
  events: ParsedCalendarEvent[];
}

export interface ParsedMixedContent {
  lists?: ParsedListContent;
  recipes?: ParsedRecipeContent[];
  events?: ParsedCalendarEvent[];
}

export type ParsedContent =
  | { type: 'list'; data: ParsedListContent }
  | { type: 'recipe'; data: ParsedRecipeContent }
  | { type: 'calendar_event'; data: ParsedCalendarContent }
  | { type: 'mixed'; data: ParsedMixedContent }
  | { type: 'unknown'; data: { rawText: string } };

export interface UserEdits {
  // Track which fields the user has modified
  modifiedFields?: string[];
  // Store the user's edits as partial overlay on parsed content
  editedContent?: Partial<ParsedContent>;
}

export type ImageParseSession = typeof imageParseSessions.$inferSelect;
export type NewImageParseSession = typeof imageParseSessions.$inferInsert;
export type ImageParseStatus = 'uploading' | 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ParsedContentType = 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
export type ProcessingStage = 'queued' | 'vlm_started' | 'vlm_done' | 'llm_started' | 'llm_done';
