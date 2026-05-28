import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  pgEnum,
  boolean,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';

export const fileTypeEnum = pgEnum('file_type', ['photo', 'video', 'music', 'document']);
export const folderTypeEnum = pgEnum('folder_type', [
  'general',
  'photos',
  'videos',
  'music',
  'documents',
]);

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): any => folders.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: folderTypeEnum('type').notNull().default('general'),
  isRestricted: boolean('is_restricted').default(false).notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  type: fileTypeEnum('type').notNull(),
  metadata: jsonb('metadata').$type<FileMetadata>(),
  excludedFromCategories: boolean('excluded_from_categories').default(false).notNull(),
  isRestricted: boolean('is_restricted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface FileMetadata {
  // Image metadata
  width?: number;
  height?: number;
  exif?: Record<string, unknown>;

  // Video metadata
  duration?: number;
  codec?: string;
  framerate?: number;
  hasAudio?: boolean;

  // Audio metadata
  artist?: string;
  album?: string;
  title?: string;
  year?: number;
  genre?: string;
  trackNumber?: number;

  // Document metadata
  pageCount?: number;

  // Thumbnail
  thumbnailPath?: string;

  // HLS streaming
  hlsPath?: string;
}

export const albums = pgTable('albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  coverFileId: uuid('cover_file_id').references(() => files.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const albumFiles = pgTable('album_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  albumId: uuid('album_id')
    .notNull()
    .references(() => albums.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0),
  addedAt: timestamp('added_at').defaultNow().notNull(),
});

export const playlistTypeEnum = pgEnum('playlist_type', ['music', 'video']);

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: playlistTypeEnum('type').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const playlistItems = pgTable('playlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  playlistId: uuid('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0),
  addedAt: timestamp('added_at').defaultNow().notNull(),
});

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;
