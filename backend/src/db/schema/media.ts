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
  real,
  date,
  smallint,
} from 'drizzle-orm/pg-core';
import { households } from './households';
import { users } from './users';
import { files } from './files';

// ==================== Enums ====================

export const processingStatusEnum = pgEnum('processing_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

export const thumbnailSizeEnum = pgEnum('thumbnail_size', ['sm', 'md', 'lg']);

export const hlsProfileEnum = pgEnum('hls_profile', ['1080p', '720p', '480p']);

export const repeatModeEnum = pgEnum('repeat_mode', ['off', 'all', 'one']);

// ==================== Core Media Tables ====================

// Multiple thumbnail sizes per file
export const thumbnails = pgTable('thumbnails', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  size: thumbnailSizeEnum('size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  storagePath: text('storage_path').notNull(),
  blurHash: varchar('blur_hash', { length: 100 }), // For progressive loading
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// User favorites
export const favorites = pgTable('favorites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// User ratings
export const ratings = pgTable('ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  rating: smallint('rating').notNull(), // 1-5
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Processing queue tracking
export const mediaProcessingJobs = pgTable('media_processing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  jobType: varchar('job_type', { length: 50 }).notNull(), // 'thumbnail', 'exif', 'transcode', 'metadata'
  status: processingStatusEnum('status').notNull().default('pending'),
  progress: integer('progress').default(0), // 0-100
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== Photo Tables ====================

// Photo EXIF metadata
export const photoMetadata = pgTable('photo_metadata', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' })
    .unique(),
  // Camera info
  cameraMake: varchar('camera_make', { length: 100 }),
  cameraModel: varchar('camera_model', { length: 100 }),
  lensModel: varchar('lens_model', { length: 100 }),
  // Exposure settings
  focalLength: real('focal_length'),
  aperture: real('aperture'),
  shutterSpeed: varchar('shutter_speed', { length: 20 }),
  iso: integer('iso'),
  // Location
  latitude: real('latitude'),
  longitude: real('longitude'),
  locationName: varchar('location_name', { length: 255 }),
  // Time
  dateTaken: timestamp('date_taken'),
  // Other
  orientation: integer('orientation'),
  tags: jsonb('tags').$type<string[]>(),
  // Raw EXIF data for reference
  rawExif: jsonb('raw_exif').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Smart albums with auto-updating criteria
export const smartAlbums = pgTable('smart_albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  criteria: jsonb('criteria').$type<SmartAlbumCriteria>().notNull(),
  coverFileId: uuid('cover_file_id').references(() => files.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface SmartAlbumCriteria {
  dateRange?: { start: string; end: string };
  location?: { lat: number; lng: number; radiusKm: number };
  locationName?: string;
  cameraMake?: string;
  cameraModel?: string;
  tags?: string[];
  minRating?: number;
  isFavorite?: boolean;
}

// ==================== Movie/TV Tables ====================

// Movies with optional TMDB data
export const movies = pgTable('movies', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' })
    .unique(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  // User-provided or TMDB data
  title: varchar('title', { length: 500 }).notNull(),
  overview: text('overview'),
  releaseDate: date('release_date'),
  runtime: integer('runtime'), // minutes
  genres: jsonb('genres').$type<string[]>(),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  director: varchar('director', { length: 255 }),
  cast: jsonb('cast').$type<MovieCastMember[]>(),
  // TMDB integration (optional)
  tmdbId: integer('tmdb_id'),
  imdbId: varchar('imdb_id', { length: 20 }),
  tmdbRating: real('tmdb_rating'),
  // Matching info
  matchedAt: timestamp('matched_at'),
  manualMatch: boolean('manual_match').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface MovieCastMember {
  name: string;
  character?: string;
  profilePath?: string;
}

// TV Shows
export const tvShows = pgTable('tv_shows', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 500 }).notNull(),
  overview: text('overview'),
  status: varchar('status', { length: 50 }), // 'Returning Series', 'Ended', etc.
  firstAirDate: date('first_air_date'),
  genres: jsonb('genres').$type<string[]>(),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  numberOfSeasons: integer('number_of_seasons').default(0),
  numberOfEpisodes: integer('number_of_episodes').default(0),
  // TMDB integration (optional)
  tmdbId: integer('tmdb_id'),
  imdbId: varchar('imdb_id', { length: 20 }),
  tmdbRating: real('tmdb_rating'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// TV Episodes
export const tvEpisodes = pgTable('tv_episodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id')
    .notNull()
    .references(() => tvShows.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' })
    .unique(),
  seasonNumber: integer('season_number').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  name: varchar('name', { length: 500 }),
  overview: text('overview'),
  airDate: date('air_date'),
  stillPath: text('still_path'),
  runtime: integer('runtime'), // minutes
  // TMDB episode ID
  tmdbId: integer('tmdb_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Watch progress per user
export const watchProgress = pgTable('watch_progress', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  positionSeconds: integer('position_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds'),
  completed: boolean('completed').default(false),
  completedAt: timestamp('completed_at'),
  lastWatchedAt: timestamp('last_watched_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// HLS transcoded streams
export const hlsStreams = pgTable('hls_streams', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  profile: hlsProfileEnum('profile').notNull(),
  masterPlaylistPath: text('master_playlist_path').notNull(),
  segmentBasePath: text('segment_base_path').notNull(),
  ready: boolean('ready').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ==================== Music Tables ====================

// Artists
export const artists = pgTable('artists', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 500 }).notNull(),
  sortName: varchar('sort_name', { length: 500 }), // For sorting (e.g., "Beatles, The")
  musicbrainzId: varchar('musicbrainz_id', { length: 50 }),
  biography: text('biography'),
  imageUrl: text('image_url'),
  imagePath: text('image_path'), // Local cached image
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Music albums (separate from photo albums)
export const musicAlbums = pgTable('music_albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  artistId: uuid('artist_id').references(() => artists.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 500 }).notNull(),
  releaseDate: date('release_date'),
  releaseType: varchar('release_type', { length: 50 }), // 'Album', 'EP', 'Single', etc.
  genres: jsonb('genres').$type<string[]>(),
  coverArtPath: text('cover_art_path'),
  totalTracks: integer('total_tracks').default(0),
  totalDiscs: integer('total_discs').default(1),
  // MusicBrainz integration (optional)
  musicbrainzId: varchar('musicbrainz_id', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Tracks
export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' })
    .unique(),
  albumId: uuid('album_id').references(() => musicAlbums.id, { onDelete: 'set null' }),
  artistId: uuid('artist_id').references(() => artists.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 500 }).notNull(),
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number').default(1),
  duration: integer('duration'), // seconds
  bitrate: integer('bitrate'), // kbps
  sampleRate: integer('sample_rate'), // Hz
  channels: integer('channels'),
  // Additional album artists (for compilations)
  albumArtist: varchar('album_artist', { length: 500 }),
  // Optional metadata
  composer: varchar('composer', { length: 500 }),
  genre: varchar('genre', { length: 100 }),
  year: integer('year'),
  // MusicBrainz integration (optional)
  musicbrainzId: varchar('musicbrainz_id', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Listen history
export const listenHistory = pgTable('listen_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id')
    .notNull()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  listenedAt: timestamp('listened_at').defaultNow().notNull(),
  duration: integer('duration'), // How long they listened (seconds)
});

// Persistent play queue
export const playQueues = pgTable('play_queues', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  currentIndex: integer('current_index').default(0),
  currentPosition: integer('current_position').default(0), // seconds
  shuffled: boolean('shuffled').default(false),
  repeatMode: repeatModeEnum('repeat_mode').default('off'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const playQueueItems = pgTable('play_queue_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  queueId: uuid('queue_id')
    .notNull()
    .references(() => playQueues.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id')
    .notNull()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
});

// ==================== Media Settings ====================

export const mediaSettings = pgTable('media_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' })
    .unique(),
  // Feature toggles
  enableTmdb: boolean('enable_tmdb').default(true),
  enableMusicbrainz: boolean('enable_musicbrainz').default(true),
  enableTranscoding: boolean('enable_transcoding').default(true),
  // API keys (optional - uses app-level keys if not provided)
  tmdbApiKey: text('tmdb_api_key'),
  // Transcoding settings
  transcodeProfiles: jsonb('transcode_profiles').$type<string[]>().default(['720p', '480p']),
  // Auto-scan settings
  autoScanEnabled: boolean('auto_scan_enabled').default(false),
  autoScanInterval: integer('auto_scan_interval').default(3600), // seconds
  lastScanAt: timestamp('last_scan_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ==================== Type Exports ====================

export type Thumbnail = typeof thumbnails.$inferSelect;
export type NewThumbnail = typeof thumbnails.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;
export type MediaProcessingJob = typeof mediaProcessingJobs.$inferSelect;
export type NewMediaProcessingJob = typeof mediaProcessingJobs.$inferInsert;

export type PhotoMetadata = typeof photoMetadata.$inferSelect;
export type NewPhotoMetadata = typeof photoMetadata.$inferInsert;
export type SmartAlbum = typeof smartAlbums.$inferSelect;
export type NewSmartAlbum = typeof smartAlbums.$inferInsert;

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;
export type TvShow = typeof tvShows.$inferSelect;
export type NewTvShow = typeof tvShows.$inferInsert;
export type TvEpisode = typeof tvEpisodes.$inferSelect;
export type NewTvEpisode = typeof tvEpisodes.$inferInsert;
export type WatchProgress = typeof watchProgress.$inferSelect;
export type NewWatchProgress = typeof watchProgress.$inferInsert;
export type HlsStream = typeof hlsStreams.$inferSelect;
export type NewHlsStream = typeof hlsStreams.$inferInsert;

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type MusicAlbum = typeof musicAlbums.$inferSelect;
export type NewMusicAlbum = typeof musicAlbums.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type ListenHistory = typeof listenHistory.$inferSelect;
export type NewListenHistory = typeof listenHistory.$inferInsert;
export type PlayQueue = typeof playQueues.$inferSelect;
export type NewPlayQueue = typeof playQueues.$inferInsert;
export type PlayQueueItem = typeof playQueueItems.$inferSelect;
export type NewPlayQueueItem = typeof playQueueItems.$inferInsert;

export type MediaSettings = typeof mediaSettings.$inferSelect;
export type NewMediaSettings = typeof mediaSettings.$inferInsert;
