import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';
import { inventoryItems, inventoryAreas } from './inventory.js';

export const receiptScanStatusEnum = pgEnum('receipt_scan_status', [
  'processing',
  'review',
  'confirmed',
  'cancelled',
  'failed',
]);

export const receiptLineResolutionEnum = pgEnum('receipt_line_resolution', [
  'unresolved',
  'link',
  'ignore',
]);

/** One scanned receipt image and its parse state. */
export const receiptScans = pgTable('receipt_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  scannedBy: uuid('scanned_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  imagePath: text('image_path'),
  imageMimeType: varchar('image_mime_type', { length: 50 }),
  // Extracted by the LLM, editable by the user. Required (non-blank) at confirm
  // because it is half of every learned link's key.
  merchant: varchar('merchant', { length: 120 }),
  purchasedAt: timestamp('purchased_at'),
  rawOcrText: text('raw_ocr_text'),
  status: receiptScanStatusEnum('status').notNull().default('processing'),
  // 'queued' | 'ocr' | 'structuring' | 'matching' | 'done'
  processingStage: varchar('processing_stage', { length: 20 }).default('queued'),
  parseWarnings: jsonb('parse_warnings').$type<string[]>().notNull().default([]),
  errorMessage: text('error_message'),
  defaultAreaId: uuid('default_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  processingTimeMs: integer('processing_time_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
}, (table) => ({
  householdIdx: index('receipt_scans_household_idx').on(table.householdId),
}));

/** One line off the receipt, plus the user's review decision. */
export const receiptScanLines = pgTable('receipt_scan_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  scanId: uuid('scan_id')
    .notNull()
    .references(() => receiptScans.id, { onDelete: 'cascade' }),
  // Denormalized so RLS can police this table directly.
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  lineIndex: integer('line_index').notNull(),
  rawText: varchar('raw_text', { length: 500 }).notNull(),
  // Costco prints an item number; most merchants do not.
  merchantCode: varchar('merchant_code', { length: 64 }),
  // Unitless package count. Decimal because some merchants price by weight.
  count: decimal('count', { precision: 10, scale: 3 }).notNull().default('1'),
  price: decimal('price', { precision: 10, scale: 2 }),
  ocrConfidence: decimal('ocr_confidence', { precision: 5, scale: 4 }),
  resolution: receiptLineResolutionEnum('resolution').notNull().default('unresolved'),
  itemId: uuid('item_id').references(() => inventoryItems.id, { onDelete: 'set null' }),
  // The one-time conversion: stock quantity = count * unitsPerCount, in the
  // item's defaultUnit.
  unitsPerCount: decimal('units_per_count', { precision: 10, scale: 3 }),
  targetAreaId: uuid('target_area_id').references(() => inventoryAreas.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  scanIdx: index('receipt_scan_lines_scan_idx').on(table.scanId),
  householdIdx: index('receipt_scan_lines_household_idx').on(table.householdId),
}));

/** The learned mapping. This is the feature. */
export const receiptLineLinks = pgTable('receipt_line_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  merchant: varchar('merchant', { length: 120 }).notNull(),
  // merchantCode when the receipt printed one, else the normalized raw text.
  lineKey: varchar('line_key', { length: 500 }).notNull(),
  keyKind: varchar('key_kind', { length: 8 }).notNull(), // 'code' | 'text'
  itemId: uuid('item_id')
    .notNull()
    .references(() => inventoryItems.id, { onDelete: 'cascade' }),
  unitsPerCount: decimal('units_per_count', { precision: 10, scale: 3 }).notNull(),
  useCount: integer('use_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueKeyPerHousehold: uniqueIndex('receipt_line_links_household_merchant_key_idx')
    .on(table.householdId, table.merchant, table.lineKey),
}));

export type ReceiptScan = typeof receiptScans.$inferSelect;
export type NewReceiptScan = typeof receiptScans.$inferInsert;
export type ReceiptScanLine = typeof receiptScanLines.$inferSelect;
export type NewReceiptScanLine = typeof receiptScanLines.$inferInsert;
export type ReceiptLineLink = typeof receiptLineLinks.$inferSelect;
export type ReceiptScanStatus = 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ReceiptLineResolution = 'unresolved' | 'link' | 'ignore';
export type ReceiptProcessingStage = 'queued' | 'ocr' | 'structuring' | 'matching' | 'done';
