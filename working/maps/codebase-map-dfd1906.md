# Codebase Map

**Commit:** dfd1906  
**Generated:** 2026-04-12

---

## Root

`dev.sh` — Master development CLI for the entire monorepo; handles smart port acquisition, Docker infrastructure (Postgres, Redis, Ollama, VLM-LLM), npm lifecycle, database migrations, GPU detection, ffmpeg checks, and sub-commands for start/stop/restart/logs/db/test/vlm-llm management.

`CLAUDE.md` — Project instructions for Claude Code documenting dev commands, architecture overview (Fastify backend, React frontend, Drizzle ORM, BullMQ jobs, Socket.io), and infrastructure ports.

`.gitignore` — Standard Node/TypeScript ignore rules covering node_modules, dist, .env files, IDE configs, Drizzle migrations, local storage, and GGUF model binaries.

---

## Backend

### Core

`backend/src/index.ts` — Server entry point that builds the app, attaches WebSocket, initializes BullMQ workers and recurring jobs, starts listening on the configured port, and handles graceful shutdown on SIGINT/SIGTERM.

`backend/src/app.ts` — Creates and configures the Fastify instance with all plugins (CORS, cookies, Helmet, compression, multipart, Swagger) and registers every route module under `/api/v1/`.

`backend/src/types/fastify.d.ts` — Module augmentation that extends Fastify's `FastifyRequest` type to include `requestId` and an optional `user` field populated by auth middleware.

`backend/src/types/index.ts` — Shared TypeScript interfaces for API responses (`ApiResponse`, `PaginatedResponse`), permission contexts, and JWT payload shape used across the backend.

### Config

`backend/src/config/index.ts` — Validates and exports all environment variables via a Zod schema, exiting the process on misconfiguration; also exports convenience booleans `isDev`, `isProd`, `isTest`.

`backend/src/config/database.ts` — Creates the `postgres-js` connection pool and a Drizzle ORM instance (`db`) wired to the full schema, plus connection-check and close helpers.

`backend/src/config/redis.ts` — Creates and exports the ioredis client with retry logic and event logging, plus `checkRedisConnection` and `closeRedisConnection` helpers.

### Database Schema

`backend/src/db/index.ts` — Barrel re-export that combines the `db`/`sql` exports from the database config with all schema exports, providing a single import point for the data layer.

`backend/src/db/schema/index.ts` — Barrel file that re-exports every Drizzle schema module so the entire database schema is available from one import.

`backend/src/db/schema/audit.ts` — Defines the `audit_log` table for immutable security/change records, and exports an `auditActions` const object enumerating every auditable event name.

`backend/src/db/schema/calendars.ts` — Defines tables for `calendars`, `calendar_events` (with full RFC 5545 recurrence support), `event_attendees`, `event_reminders`, and `calendar_visibility`, plus all related enums and TypeScript types.

`backend/src/db/schema/connections.ts` — Defines tables for inter-household federation: `connected_households`, `connection_invites`, `shared_resources`, `synced_resources`, `sync_queue`, `backup_partners`, `backup_storage`, and `passphrase_escrow`.

`backend/src/db/schema/devices.ts` — Defines `devices`, `device_settings`, and `device_rules` tables for registered household devices (TVs, tablets, etc.) with time-based and user-based access rules.

`backend/src/db/schema/files.ts` — Defines `folders`, `files`, `albums`, `album_files`, `playlists`, and `playlist_items` tables for the household file system, along with the `FileMetadata` interface covering image/video/audio/document fields.

`backend/src/db/schema/groups.ts` — Defines `groups` and `group_members` tables, allowing users to be organised into named groups for permission grants.

`backend/src/db/schema/households.ts` — Defines the `households` root table and the rich `HouseholdSettings` interface covering theme, enabled features, storage, remote access, and role defaults stored as JSONB.

`backend/src/db/schema/image-parse.ts` — Defines the `image_parse_sessions` table and all TypeScript types for the AI image-parsing pipeline, including parsed content shapes for lists, recipes, calendar events, and the multi-LLM "counsel mode" discussion data.

`backend/src/db/schema/inventory.ts` — Defines `inventory_areas`, `inventory_items`, `inventory_stock`, `shopping_list`, and `leftovers` tables with full Drizzle relations, supporting multi-area storage, density/quantity-weight fields, and meal-plan-driven shopping lists.

`backend/src/db/schema/lists.ts` — Defines `lists` and `list_items` tables for household checklists, reminder lists, and notes with sort order and due-date tracking.

`backend/src/db/schema/media.ts` — Defines all media-specific tables: `thumbnails`, `favorites`, `ratings`, `mediaProcessingJobs`, `photoMetadata`, `smartAlbums`, `movies`, `tvShows`, `tvEpisodes`, `watchProgress`, `hlsStreams`, `artists`, `musicAlbums`, `tracks`, `listenHistory`, `playQueues`, and `mediaSettings`.

`backend/src/db/schema/member-invites.ts` — Defines the `member_invites` table for invite-code-based household membership flows with status tracking (pending/accepted/expired/revoked).

`backend/src/db/schema/notifications.ts` — Defines the `notifications` table with a typed `NotificationData` JSONB field covering low-stock, expiry, task-due, backup, and connection-request notification payloads.

`backend/src/db/schema/permissions.ts` — Defines `permissions` and `feature_permissions` tables with enums for resource types, grantee types (user/role/group/device/household), and permission levels (view/edit/admin/none).

`backend/src/db/schema/recipes.ts` — Defines `recipes`, `recipe_ingredients`, `meal_plans`, `active_cooking_sessions`, and `recipe_import_sessions` tables, plus all interfaces for parsed recipe data and ingredient matching used during recipe import.

`backend/src/db/schema/sessions.ts` — Defines the `sessions` table used by Lucia for cookie-based auth, tracking device association, IP, user agent, and last-active timestamp.

`backend/src/db/schema/settings.ts` — Defines `user_settings`, `ddns_config`, `extensions`, `music_integrations`, `backups`, and `backup_schedules` tables covering per-user preferences, DDNS, third-party integrations, and backup management.

`backend/src/db/schema/tasks.ts` — Defines `tasks`, `rewards`, `reward_history`, `achievements`, and `user_achievements` tables, supporting chore assignment, point-based reward tracking, and configurable achievements.

`backend/src/db/schema/users.ts` — Defines the `users` table with role enum (admin/member/kid/visitor) scoped under a household via foreign key.

### Lib

`backend/src/lib/circuit-breaker.ts` — Wraps the `opossum` library to create per-service circuit breakers with service-specific configs for Google Calendar, Outlook, Home Assistant, OpenFoodFacts, connected households, and Spotify; exports `withCircuitBreaker` and status inspection.

`backend/src/lib/crypto.ts` — Provides AES-256-GCM symmetric encrypt/decrypt using the app's `ENCRYPTION_KEY`, plus helpers for generating random tokens and OAuth state values.

`backend/src/lib/encryption.ts` — Provides libsodium-based asymmetric and symmetric crypto: `encrypt`/`decrypt` (secretbox), `generateKeyPair`, `encryptWithPublicKey`/`decryptWithPrivateKey` (sealed box), message signing/verification, and hashing — used for inter-household federation security.

`backend/src/lib/errors.ts` — Defines the `ErrorCode` enum with structured error codes across auth/validation/resource/external/system domains, the `AppError` class with automatic HTTP status mapping, and an `Errors` factory object for common error cases.

`backend/src/lib/ingredient-densities.ts` — A static lookup table of g/ml densities for ~150 common ingredients, with a `lookupDensity` function that matches by exact name, substring, or partial key, plus an `isQuantityUnit` helper for count-based units.

`backend/src/lib/logger.ts` — Configures a pino logger with `AsyncLocalStorage`-based request context injection (requestId, userId, householdId), automatic redaction of secrets, and pretty-printing in development.

`backend/src/lib/metrics.ts` — Registers a Prometheus `prom-client` registry with counters, histograms, and gauges for HTTP requests, background jobs, WebSocket connections, database queries, circuit breakers, sync operations, storage, and auth events.

`backend/src/lib/permissions.ts` — Database-querying permission logic: `checkPermission` resolves explicit grants for users/roles/groups/devices against the `permissions` table, `checkPageAccess` applies role-default page permissions with override support, and CRUD helpers for granting/revoking permissions.

`backend/src/lib/unit-conversions.ts` — Global unit conversion table (volume and weight, US and metric) with `normalizeUnit`, `getGlobalConversionFactor`, `findConversionChain`, and the main `convertWithDensity` function that handles same-category, cross-category (weight/volume via density), and quantity-unit conversions.

`backend/src/lib/validators.ts` — Centralised Zod schemas and TypeScript type exports for all domain enums (roles, permissions, resource types, notification types, etc.), plus utility functions for URL validation, barcode validation, filename sanitisation, and a `validateOrThrow` helper.

### Middleware

`backend/src/middleware/auth.middleware.ts` — Validates session cookies against the database, populates `request.user`, and exports `authMiddleware`, `optionalAuthMiddleware`, and `requireRole`/`requireAdmin`/`requireMember`/`requireAuthenticated` guard factories.

`backend/src/middleware/error.middleware.ts` — Fastify error handler that maps `ZodError`, `AppError`, and Fastify validation errors to structured JSON responses with request IDs; also provides a `notFoundHandler` for unmatched routes.

`backend/src/middleware/permission.middleware.ts` — Pre-handler factories (`requireResourceAccess`, `requireFeatureAccess`, and resource-specific helpers) that check the permission service and throw 403 errors when the authenticated user lacks the required level on a resource or feature.

`backend/src/middleware/rate-limit.middleware.ts` — Redis-backed sliding-window rate limiter factory with configurable max/window per route; exports a strict `authRateLimiter` (10 req/min by IP) and a standard `apiRateLimiter`.

`backend/src/middleware/request-id.middleware.ts` — Assigns a UUID request ID from the incoming `x-request-id` header or generates one, attaches it to the request and response, and provides a `withRequestContext` helper to bind logger context around a handler.

`backend/src/middleware/rls.middleware.ts` — Sets PostgreSQL session variables (`app.current_user_id`, `app.current_household_id`, `app.current_role`, `app.current_device_id`) on each authenticated request to support row-level security policies in the database.

`backend/src/middleware/sanitization.middleware.ts` — HTML sanitisation utilities using `sanitize-html`: a configurable `sanitizeString`, an `sanitizeObject` that scrubs named fields, an `onRequest` hook that automatically cleans common body fields, plus `stripHtml` and `escapeHtml` helpers.

### Jobs (BullMQ Workers)

`backend/src/jobs/index.ts` — Declares all nine BullMQ queues (notifications, sync, backup, cleanup, inventory, calendar-reminders, calendar-sync, media, image-parse), initializes workers with dynamic imports, schedules recurring cron jobs, and exports queue helper functions.

`backend/src/jobs/backup.worker.ts` — Gathers all household data (users, calendars, recipes, inventory, tasks, lists) into a JSON file, optionally encrypts it, writes it to disk, records the backup in the database, and enforces retention policy.

`backend/src/jobs/calendar-reminder.worker.ts` — Queries all unsent event reminders, calculates whether each reminder's fire time has passed, creates a notification record, and emits a real-time WebSocket notification.

`backend/src/jobs/calendar-sync.worker.ts` — For each calendar with `isSynced=true`, delegates to the Google or Outlook sync service, emits WebSocket sync events, and queues a household notification after three consecutive failures.

`backend/src/jobs/cleanup.worker.ts` — Handles five cleanup types: expired sessions (DB + Redis), old notifications (30/90-day retention), old audit logs (1 year), finished leftovers (30 days), and orphaned file checks.

`backend/src/jobs/image-parse.worker.ts` — Thin wrapper that calls `processImageWithAI` from the image-parse service, delegating all AI processing logic there.

`backend/src/jobs/inventory.worker.ts` — Checks for low-stock items, expiring inventory (7-day window), and expiring leftovers (3-day window), emitting WebSocket alerts and queuing notifications for each.

`backend/src/jobs/media.worker.ts` — Processes media files by type: generates WebP thumbnails (image/video), extracts EXIF metadata, and extracts video info (duration, codec, dimensions) via ffprobe.

`backend/src/jobs/notification.worker.ts` — Inserts a notification record into the database and emits it to the household or specific user via WebSocket.

`backend/src/jobs/sync.worker.ts` — Processes cross-household resource sync operations (share/update/delete) by updating the sync queue table and emitting sync completion/failure events to both households.

### Modules

#### Auth
`backend/src/modules/auth/auth.routes.ts` — Exposes login, register, invite-register, logout, session refresh, current-user, password reset/change, and session management endpoints, all with rate limiting and cookie-based sessions.

`backend/src/modules/auth/auth.schema.ts` — Defines Zod schemas and inferred TypeScript types for all auth input shapes (login, register, registerWithInvite, forgotPassword, resetPassword, changePassword).

`backend/src/modules/auth/auth.service.ts` — Implements core auth logic: Argon2 password hashing/verification, session creation with Redis caching, invite code validation, and password reset via Redis-stored tokens.

#### Backup
`backend/src/modules/backup/backup.routes.ts` — CRUD for manual backups (list, create, download, delete, restore) and backup schedules (CRUD + enable/disable), restricted to admins.

#### Calendars
`backend/src/modules/calendars/calendars.routes.ts` — Full calendar and event CRUD with recurring event support (single/all/following scope edits), attendee and reminder management, ICS import/export, visibility settings, and search across event titles and descriptions.

`backend/src/modules/calendars/google-sync.service.ts` — Wraps the Google Calendar API with OAuth2 token management (including refresh), fetches events in two passes (master events then exception instances), and upserts them into the local database.

`backend/src/modules/calendars/ics.service.ts` — Parses iCal (.ics) content into structured events (including recurring master/exception instances) and generates iCal content from stored events for export or public feeds.

`backend/src/modules/calendars/outlook-sync.service.ts` — Mirrors the Google sync service for Microsoft Graph API using MSAL, including Outlook recurrence-to-RRULE conversion and two-pass exception handling.

`backend/src/modules/calendars/public.routes.ts` — Serves a public ICS feed by token (no auth required) and manages generating/revoking public calendar share links.

`backend/src/modules/calendars/recurrence.service.ts` — Provides RRULE parsing/building, recurrence expansion (with EXDATE/RDATE support), virtual instance creation, human-readable summaries, and RRULE truncation for "this and following" deletions.

`backend/src/modules/calendars/sharing.routes.ts` — Manages sharing calendars with connected households at view_busy/view/edit permission levels, including listing shares and emitting WebSocket events on share/unshare.

`backend/src/modules/calendars/sync.routes.ts` — Handles the full OAuth flow for Google and Outlook (connect, callback, list calendars, complete), manual sync trigger, disconnect, and sync status endpoints.

#### Connections
`backend/src/modules/connections/connections.routes.ts` — Manages inter-household connections via invite codes (create, accept, decline, revoke), connected household CRUD, and shared resource management with sync queue entries.

#### Devices
`backend/src/modules/devices/devices.routes.ts` — CRUD for registered devices with settings and time/user-based display rules, plus a heartbeat endpoint to update last-seen time.

#### Files
`backend/src/modules/files/files.routes.ts` — Full file and folder CRUD with multipart upload (enforcing per-household storage quotas), byte-range streaming, folder restriction permissions, album management (CRUD + file membership), playlist CRUD with item ordering, favorites/ratings, thumbnail generation, and a media scanner trigger.

#### Groups
`backend/src/modules/groups/groups.routes.ts` — CRUD for household user groups and group membership management (add/remove members).

#### Health
`backend/src/modules/health/health.routes.ts` — Exposes public health check, Kubernetes liveness/readiness probes (checking DB + Redis), detailed health with storage stats and circuit breaker status (admin only), and optional Prometheus metrics.

#### Households
`backend/src/modules/households/households.routes.ts` — Manages the current household's settings, member listing, invite creation/revocation, member role updates, and member removal.

#### Image Parse
`backend/src/modules/image-parse/ai-providers/index.ts` — Factory that selects and returns the VLM-LLM provider (or null if unavailable), and exposes status/health check functions for monitoring.

`backend/src/modules/image-parse/ai-providers/ocr-llm-provider.ts` — Implements the VisionProvider interface using a Python OCR+LLM microservice, calling `/extract/base64` for full pipeline or `/ocr/base64/json` for OCR-only fallback.

`backend/src/modules/image-parse/ai-providers/ollama-vision.ts` — Implements the VisionProvider interface using Ollama's `/api/generate` endpoint directly, with lightweight model detection for simpler prompt selection.

`backend/src/modules/image-parse/ai-providers/vlm-llm-provider.ts` — Implements the VisionProvider interface using the VLM-LLM Python microservice (llava:7b + qwen2.5:7b), with GPU/CPU detection and separate `vlmOnly`/`llmOnly` methods for debugging.

`backend/src/modules/image-parse/extractors/calendar-extractor.ts` — Normalizes AI-extracted calendar JSON into `ParsedCalendarContent`, and provides a text-only fallback parser using date/time regex patterns.

`backend/src/modules/image-parse/extractors/list-extractor.ts` — Normalizes AI-extracted list JSON into `ParsedListContent` with type inference, and provides a text-only fallback parser detecting checkboxes and bullet patterns.

`backend/src/modules/image-parse/extractors/recipe-extractor.ts` — Normalizes AI-extracted recipe JSON into `ParsedRecipeContent` with unit normalization, and provides a comprehensive text-only fallback parser handling multiple ingredient line formats.

`backend/src/modules/image-parse/extractors/type-detector.ts` — Scores raw text against recipe/calendar/list indicator patterns to detect content type, and builds appropriate extraction prompts (detailed or simple) for the AI provider.

`backend/src/modules/image-parse/image-parse.routes.ts` — Handles image upload (creating a session + queuing the job), SSE proxy for counsel-mode streaming, and session status/reprocess/type-change/content-edit/confirm/cancel endpoints.

`backend/src/modules/image-parse/image-parse.schemas.ts` — Zod schemas for all image parse API shapes: session status, content types (list/recipe/calendar), and confirm/update request bodies.

`backend/src/modules/image-parse/image-parse.service.ts` — Orchestrates the full image parse lifecycle: session creation, base64 image storage, job queuing, AI processing with stage tracking, content normalization, and entity creation (list items, recipe + ingredients, calendar events) on confirm.

#### Inventory
`backend/src/modules/inventory/inventory.routes.ts` — Full inventory management: area CRUD, item CRUD with density/unit-weight metadata, stock management (add/update/remove with cross-unit conversion totaling), shopping list CRUD with source tracking, and leftover management with optional recipe linkage.

#### Lists
`backend/src/modules/lists/lists.routes.ts` — CRUD for lists and list items with permission middleware, plus toggle/reorder/clear-checked operations on items.

#### Movies
`backend/src/modules/movies/movies.routes.ts` — Manages movies and TV shows (CRUD, metadata, episodes grouped by season), watch progress tracking with auto-complete, and a "continue watching" aggregated view.

#### Music
`backend/src/modules/music/music.routes.ts` — Full music library management: artists/albums/tracks CRUD, track streaming with byte-range support, listen history recording, and per-user play queue management (add/update/clear).

#### Notifications
`backend/src/modules/notifications/notifications.routes.ts` — List/read/delete notifications with unread count, notification preferences (per-user settings), and an action execution endpoint.

#### Permissions
`backend/src/modules/permissions/permissions.routes.ts` — CRUD for resource-level permissions (grant/update/revoke/list) and feature-level permissions (get/set/delete), plus endpoints to check the current user's own access levels.

#### Photos
`backend/src/modules/photos/photos.routes.ts` — Lists photos with EXIF metadata, provides timeline and location-cluster views, and manages smart albums with criteria-based filtering (date range, location, camera, favorites).

#### Recipes
`backend/src/modules/recipes/ingredient-matching.service.ts` — Fuzzy-matches recipe ingredient names against inventory items using exact, synonym, substring, and Levenshtein distance scoring, returning ranked suggestions with unit conversion hints.

`backend/src/modules/recipes/recipe-image.service.ts` — Processes recipe images with sharp: validates type, resizes to max 800px, converts to WebP at quality 80, strips EXIF, and returns base64 with dimensions.

`backend/src/modules/recipes/recipe-import.service.ts` — Manages recipe import sessions: parses raw text or `.recipe` JSON format, calls URL parser or text parser, matches ingredients against inventory, and creates the final recipe on confirmation.

`backend/src/modules/recipes/recipes.routes.ts` — Full recipe CRUD with image upload, meal plan management (CRUD with date/type), active cooking session tracking (with inventory deduction on completion), ingredient-to-inventory matching, and shopping list integration.

`backend/src/modules/recipes/url-parser.service.ts` — Fetches recipe URLs and attempts extraction via JSON-LD Schema.org (primary), RecipeClipper ML (secondary), Microdata (tertiary), and heuristic CSS selectors (fallback).

#### Settings
`backend/src/modules/settings/settings.routes.ts` — Manages household settings (general, theme, feature flags, storage quotas), DDNS configuration, extensions (enable/disable/config), and music integrations.

#### Setup
`backend/src/modules/setup/setup.routes.ts` — One-step initial setup (creates household + admin user + session) and stepwise setup endpoints; blocked if a household already exists.

#### Tasks
`backend/src/modules/tasks/tasks.routes.ts` — CRUD for tasks with permission middleware, task completion with chore reward point tracking, and rewards/achievements management.

#### Users
`backend/src/modules/users/users.routes.ts` — User profile updates, password change, and per-user settings (theme, hidden pages, notification preferences, calendar default view) with upsert.

#### Videos
`backend/src/modules/videos/videos.routes.ts` — Lists household video files with pagination/sorting and a timeline grouped view, both filtered through the permission service to respect folder restrictions.

### Services

`backend/src/services/exif.service.ts` — Extracts EXIF data (camera info, GPS coordinates, date taken, dimensions) from image files using sharp, persists to `photoMetadata` table, and exposes get/delete helpers.

`backend/src/services/media-scanner.service.ts` — Recursively walks storage directories to discover new media files, creates file records, queues media processing, and auto-matches TV show/movie/audio filenames using regex patterns.

`backend/src/services/permission.service.ts` — Core permission engine: checks resource and feature access with user/group/role/household/device grantees, handles folder restriction inheritance, provides batch access checks, and manages default permissions by role.

`backend/src/services/thumbnail.service.ts` — Generates sm/md/lg WebP thumbnails from images using sharp (with blur placeholder for sm), extracts video frames via ffmpeg for video thumbnails, and persists results to the `thumbnails` table.

### WebSocket

`backend/src/websocket/events.ts` — Typed helper functions for emitting domain-specific WebSocket events (calendar, inventory, task, recipe, file, notification, list, device, sync, reward events) to households, users, or rooms.

`backend/src/websocket/index.ts` — Initializes the Socket.io server with cookie/token auth (Redis-cached sessions), manages household/user room joins, tracks online presence in Redis, and exposes `emitToHousehold`/`emitToUser`/`emitToRoom` primitives.

### Docker / Config

`backend/docker-compose.dev.yml` — Defines the dev Docker stack: Postgres 16, Redis 7, PgAdmin, Redis Commander, Ollama 0.5.7 (with optional NVIDIA GPU reservation and swap memory for CPU fallback), and the VLM-LLM FastAPI service built from `services/vlm-llm`.

`backend/package.json` — Backend npm manifest; key runtime deps are Fastify 4, Drizzle ORM, BullMQ, Socket.io, Lucia auth, sharp, and googleapis; dev deps include tsx (hot-reload runner) and Vitest.

`backend/tsconfig.json` — Strict TypeScript config targeting ES2022/NodeNext with `@/*` path alias, full null/type strictness, and no unused locals/parameters enforcement.

`backend/drizzle.config.ts` — Drizzle Kit config pointing to `./src/db/schema/index.ts` as the schema source, outputting migrations to `./src/db/migrations`, using the PostgreSQL dialect with `DATABASE_URL` from env.

---

## Frontend

### Core

`frontend/src/main.tsx` — React entry point that mounts the `App` component into the DOM inside `StrictMode`.

`frontend/src/App.tsx` — Root component that wires up all providers (Query, Theme, Auth, WebSocket) and defines the full React Router route tree, splitting public routes (login, register, setup) from protected routes wrapped in `AppShell`.

`frontend/src/index.css` — Global stylesheet that defines the design system: CSS custom properties for the lavender theme (light and dark), semantic color tokens (success/warning/error/info), and utility classes for cards, buttons, and custom scrollbars.

`frontend/src/vite-env.d.ts` — Vite type reference shim; enables `import.meta.env` TypeScript types.

### API Layer

`frontend/src/api/client.ts` — HTTP client layer exposing `apiGet`, `apiPost`, `apiPatch`, `apiPut`, `apiDelete`, and `apiUpload` (with XHR progress support); handles response unwrapping, error normalization into `ApiError`, and attaches session cookies to every request.

`frontend/src/api/auth.ts` — `authApi` object covering login, logout, registration (direct and invite-based), password reset, session listing/revocation, and the `/auth/me` endpoint.

`frontend/src/api/backup.ts` — `backupApi` for creating, listing, uploading, restoring, and deleting backups, plus CRUD for automated backup schedules.

`frontend/src/api/calendars.ts` — `calendarsApi` covering the full calendar feature: calendar CRUD, event CRUD with recurrence exception support, attendee and reminder management, ICS import/export, Google/Outlook sync, and cross-household calendar sharing with public ICS links.

`frontend/src/api/connections.ts` — `connectionsApi` for listing and managing inter-household connections (accept, update permissions, disconnect) and fetching their shared resources.

`frontend/src/api/devices.ts` — `devicesApi` for registering and managing household devices (tablets, kiosks, browsers), their access rules, and sending heartbeat pings.

`frontend/src/api/files.ts` — `filesApi` covering file/folder CRUD, uploads with progress, bulk operations (move, delete, exclude), album management, storage usage, and file/folder content-restriction flags.

`frontend/src/api/groups.ts` — `groupsApi` for managing household user groups and their members.

`frontend/src/api/households.ts` — `householdsApi` for reading and updating the current household, managing members (invite, remove, update role), and listing/revoking pending invites.

`frontend/src/api/image-parse.ts` — `imageParseApi` for the VLM+LLM image-parsing pipeline: uploading images, polling session status, editing parsed content, confirming to create entities, and subscribing to counsel-mode SSE streams.

`frontend/src/api/inventory.ts` — `inventoryApi` covering storage areas, inventory items (including batch ops and quantity-unit weights), stock entries, expiry/low-stock alerts, shopping list management (with field-name mapping between backend and frontend), and leftovers.

`frontend/src/api/lists.ts` — `listsApi` for general-purpose lists (checklist/reminder/notes) and their items, including toggle, reorder, and clear-checked operations.

`frontend/src/api/media.ts` — Exports `photosApi`, `videosApi`, `moviesApi`, `musicApi`, and `filesMediaApi` covering the full media library: photo timelines/smart albums/locations, video timelines, movie/TV metadata and watch progress, music artists/albums/tracks/play queue/listen history, and shared thumbnail/streaming/favorite/rating helpers.

`frontend/src/api/notifications.ts` — `notificationsApi` for listing, marking read, deleting notifications, fetching unread count, and managing notification preferences.

`frontend/src/api/permissions.ts` — Typed functions (and `permissionsApi` object) for resource-level permissions (grant, update, revoke, my-access) and feature-level permissions (per-role defaults, set, delete, get my feature access).

`frontend/src/api/recipes.ts` — `recipesApi` for recipe CRUD, tag management, cooking session start/finish with inventory deduction, meal plan scheduling, shopping list preview/generation, multi-stage recipe import (URL/text/PDF with ingredient matching), and recipe image upload/delete.

`frontend/src/api/settings.ts` — `settingsApi` for reading/updating household settings, theme config, enabled features, and storage quota settings.

`frontend/src/api/setup.ts` — `setupApi` for the first-run wizard: checking setup status, creating the household and admin user, configuring remote access, and completing setup.

`frontend/src/api/tasks.ts` — `tasksApi` for task/chore CRUD, completion, assignment, reward point tracking per user, reward history, and achievement management.

`frontend/src/api/users.ts` — `usersApi` for fetching and updating user profiles and listing a user's active sessions.

### Providers

`frontend/src/providers/AuthProvider.tsx` — Checks setup status then fetches the current session on mount, stores auth state in `authStore`, and exposes `login`/`logout` mutations and an `AuthContext`.

`frontend/src/providers/QueryProvider.tsx` — Wraps the app in TanStack `QueryClientProvider` with default stale/gc times and exports the shared `queryClient` instance.

`frontend/src/providers/ThemeProvider.tsx` — Applies theme preset colors (or custom overrides) as CSS variables on `document.documentElement`, handles light/dark/system mode switching, and exposes all theme controls via `ThemeProviderContext`.

`frontend/src/providers/WebSocketProvider.tsx` — Creates a Socket.io connection when authenticated, joins the household room, and invalidates React Query caches in response to server-pushed events for calendars, recipes, inventory, tasks, lists, files, notifications, cooking timers, and household/user updates.

### Stores (Zustand)

`frontend/src/stores/authStore.ts` — Zustand store (persisted to localStorage) holding the current `user`, `household`, `isAuthenticated`, and `isLoading` state with setters and `clearAuth`.

`frontend/src/stores/cookingStore.ts` — Zustand store managing in-progress cooking sessions: current recipe step, per-timer state (running/paused/remaining), and actions to start, pause, reset, and advance timers across potentially multiple concurrent sessions.

`frontend/src/stores/notificationStore.ts` — Zustand store for in-memory notification list and unread count, with actions to add, remove, mark-read, and bulk-clear notifications received via WebSocket.

`frontend/src/stores/playerStore.ts` — Zustand store (volume/shuffle/repeat persisted) managing the music player: current track, play queue, playback state, and all playback actions; interacts directly with an `HTMLAudioElement` ref and calls `musicApi` for stream URLs and listen recording.

`frontend/src/stores/themeStore.ts` — Zustand store (fully persisted) holding the active theme preset, color palette, font size, border radius, per-mode custom color overrides, and saved custom themes with full CRUD.

`frontend/src/stores/timerStore.ts` — Zustand store (timers persisted as paused on reload) for standalone cooking timers independent of a recipe session: add, start, pause, reset, add-time, tick, and dismiss.

`frontend/src/stores/uiStore.ts` — Zustand store for shell UI state: sidebar open/collapsed, mobile nav open, and command palette open.

### Hooks

`frontend/src/hooks/useAuth.ts` — Re-exports `useAuth` from `AuthProvider`.

`frontend/src/hooks/useCalendarColor.ts` — Exports `useCalendarColor`, `useCalendarColorLabel`, and `useCalendarColorInfo` hooks that resolve a stored color index to an actual hex color and label using the active color palette from the theme.

`frontend/src/hooks/useCalendarShortcuts.ts` — Registers global keydown handlers for calendar keyboard shortcuts (n/c create, t today, arrows navigate, m/w/d views, e edit, Esc close, Delete) and exports the `KEYBOARD_SHORTCUTS` reference list.

`frontend/src/hooks/useCookingSession.ts` — Bridges `cookingStore` and WebSocket for a cooking session: runs the 1-second timer tick interval, emits socket events on timer start/pause/reset/alert, and returns a clean API (start, end, goToStep, next, prev, timer controls).

`frontend/src/hooks/useDebounce.ts` — Generic hook that returns a debounced copy of a value after a specified delay.

`frontend/src/hooks/useDevice.ts` — Returns responsive breakpoint flags (`isMobile`, `isTablet`, `isDesktop`, `isTouchDevice`) and screen dimensions, updated on window resize.

`frontend/src/hooks/useFeatureFlags.ts` — Derives the household's enabled feature flags from `authStore` with safe defaults; also exports `useFeatureEnabled` for a single feature check.

`frontend/src/hooks/useFeaturePermissions.ts` — Fetches the current user's per-feature access levels from the API and exposes `hasAccess`, `canEdit`, and `canAdmin` helpers.

`frontend/src/hooks/useLocalStorage.ts` — Generic hook for reading and writing a typed value to localStorage, with cross-tab sync via the `storage` event.

`frontend/src/hooks/useNotifications.ts` — Fetches notifications and unread count via React Query and exposes `markAsRead`, `markAllAsRead`, and `deleteNotification` mutations.

`frontend/src/hooks/usePermissions.ts` — Derives role-based page access and action permissions for the current user from a static `rolePermissions` config keyed by `UserRole`.

`frontend/src/hooks/useScreensaver.ts` — Tracks user activity events and activates/deactivates a screensaver after a configurable idle timeout, calling optional `onActivate`/`onDeactivate` callbacks.

`frontend/src/hooks/useTheme.ts` — Re-exports `useTheme` from `ThemeProvider`.

`frontend/src/hooks/useTimers.ts` — Wraps `timerStore` with a 1-second tick interval for running timers, audio alert playback, browser `Notification` support, and a clean `addTimer`/`startTimer` API that auto-requests notification permission.

`frontend/src/hooks/useToast.ts` — shadcn-style toast system: module-level reducer + listener list shared across components, exporting `toast()` imperative function and `useToast()` hook for the `Toaster` renderer.

`frontend/src/hooks/useWebSocket.ts` — Re-exports `useWebSocket` from `WebSocketProvider`.

### Types

`frontend/src/types/api.ts` — Defines `ApiResponse<T>` (the standard backend envelope), `PaginatedResponse<T>`, and `PaginationParams`.

`frontend/src/types/forms.ts` — Zod schemas and inferred TypeScript types for every form in the app: auth, setup, calendar events, recipes, inventory items/stock/leftovers, tasks, and lists.

`frontend/src/types/models.ts` — Central domain model type definitions for all entities: `User`, `Household`, `Calendar`, `CalendarEvent`, `Recipe`, `InventoryItem`, `StockEntry`, `ShoppingListItem`, `Leftover`, `Task`, `List`, `FileItem`, `Notification`, `HouseholdConnection`, and all supporting subtypes.

`frontend/src/types/socket.ts` — TypeScript interfaces for Socket.io event maps: `ServerToClientEvents` (calendar, recipe, inventory, task, list, file, notification, cooking timer, household/user updates) and `ClientToServerEvents` (join household, cooking timer controls, typing indicators).

### Lib

`frontend/src/lib/api-error.ts` — Defines the `ApiError` class (extends Error, carries code, status, details), the `ApiErrorResponse` interface, standard `ERROR_CODES` constants, and a `getErrorMessage` utility.

`frontend/src/lib/constants.ts` — App-wide constants: `API_BASE_URL`, role/permission/resource enums, nav item definitions, settings nav items, feature list, React Query `STALE_TIME` values, and `ROUTE_TO_FEATURE`/`ADMIN_ONLY_SETTINGS` mappings for permission gating.

`frontend/src/lib/ingredient-densities.ts` — `INGREDIENT_DENSITIES` lookup table (~180 common ingredients mapped to g/ml), a `lookupDensity()` fuzzy-matching function, and `isQuantityUnit()` for identifying count-based units that need per-unit weight mappings instead.

`frontend/src/lib/inventory-constants.ts` — Exports `categoryOptions`, `unitOptions`, `unitAliases`, and `normalizeUnit()` for inventory UI, plus `convertQuantity()` (delegates to `convertWithDensity`) and `calculateTotalStock()` for aggregating stock entries across mixed units.

`frontend/src/lib/theme-presets.ts` — Defines the `ThemeColors` and `ThemePreset` interfaces, the `THEME_PRESETS` record of built-in color themes (lavender, ocean, forest, etc.), color palette definitions, and helper functions `getColorForIndex`, `getColorLabelForIndex`, `colorKeyToVar`, and `THEME_DEFAULTS`.

`frontend/src/lib/unit-conversions.ts` — Core unit-conversion engine: `GLOBAL_UNIT_CONVERSIONS` table, `UNIT_CATEGORIES` map, chain-finding via `findConversionChain`, and the top-level `convertWithDensity` function that handles same-category, cross-category (weight/volume via density), and quantity-unit conversions via per-unit gram weights.

`frontend/src/lib/utils.ts` — General-purpose utilities: `cn` (Tailwind class merging), date/time formatters, `debounce`, `generateId`, `truncate`, `capitalize`, `pluralize`, `formatDuration`, and `formatFileSize`.

### Components — Layout

`frontend/src/components/layout/AppShell.tsx` — Root layout: fixed sidebar (desktop), header, scrollable main content area, mobile bottom nav, and persistent music player bar.

`frontend/src/components/layout/Header.tsx` — Top bar with a notification bell (unread badge) and a user avatar dropdown containing profile/settings links, theme switcher, and logout.

`frontend/src/components/layout/MobileNav.tsx` — Fixed bottom navigation bar on mobile with icon links and a "More" button that slides open the full sidebar as a sheet.

`frontend/src/components/layout/PageHeader.tsx` — Layout component rendering a page title (h1), optional description, optional prefix slot, and optional right-side action buttons.

`frontend/src/components/layout/ScreensaverOverlay.tsx` — Full-screen screensaver showing a photo slideshow with a large clock and date after inactivity; dismissed by any click or touch.

`frontend/src/components/layout/Sidebar.tsx` — Collapsible left sidebar with two nav groups (main and media), filtered by feature flags and permissions, with tooltips in collapsed mode.

### Components — Auth

`frontend/src/components/auth/ForgotPasswordForm.tsx` — Email field to request a password reset link; on success shows a checkmark confirmation.

`frontend/src/components/auth/LoginForm.tsx` — Email/password login form with a "Forgot password?" link and error display.

`frontend/src/components/auth/ProtectedRoute.tsx` — Route guard that shows a spinner while checking auth and redirects unauthenticated users to /login, preserving the intended destination.

`frontend/src/components/auth/RegisterForm.tsx` — Registration form with display name, email, password, and confirm password fields for joining a household via invite link.

`frontend/src/components/auth/ResetPasswordForm.tsx` — New password + confirm form that reads a token from URL params; redirects to login after success.

### Components — Calendar

`frontend/src/components/calendar/CalendarForm.tsx` — Create/edit calendar dialog with name, color picker, and type selector; edit mode adds Sharing and Public ICS/webcal subscription tabs.

`frontend/src/components/calendar/CalendarPublicLinkCard.tsx` — Settings card for generating, copying, regenerating, or revoking a public ICS/webcal subscription link for a calendar.

`frontend/src/components/calendar/CalendarSearch.tsx` — Modal search dialog for events with a text query, calendar filter chips, and optional date range; results are clickable to navigate to the event.

`frontend/src/components/calendar/CalendarSharingDialog.tsx` — Dialog for sharing a calendar with connected households, selecting a permission level (busy-only/view/edit), and updating or removing existing shares.

`frontend/src/components/calendar/CalendarSidebar.tsx` — Left panel listing "My Calendars," "Synced Calendars," and "Shared with Me" groups with color-coded checkboxes to toggle visibility and hover actions.

`frontend/src/components/calendar/CalendarSyncSettings.tsx` — Google Calendar integration card with an OAuth connect button, synced calendar list with status indicators, and manual sync/disconnect controls.

`frontend/src/components/calendar/CalendarView.tsx` — Main calendar grid supporting month, week, and day views with navigation, a today button, and clickable dates and events.

`frontend/src/components/calendar/DeleteRecurringEventDialog.tsx` — Alert dialog asking the user to choose the deletion scope for a recurring event: this event only, this and following, or all events.

`frontend/src/components/calendar/EditRecurringEventDialog.tsx` — Same three-option scope picker as the delete dialog but for editing a recurring event.

`frontend/src/components/calendar/EventDetail.tsx` — Read-only event detail dialog showing title, date/time, calendar, location, attendees with RSVP status, reminders, description, and edit/delete buttons.

`frontend/src/components/calendar/EventForm.tsx` — Create/edit event dialog with title, calendar picker, all-day toggle, start/end date-time, recurrence quick-select, location, and description.

`frontend/src/components/calendar/RecurrenceEditor.tsx` — Detailed recurrence rule editor supporting frequency, interval, day-of-week toggles, monthly options, and end conditions; also exports `parseRRule`, `optionsToRRule`, and `getRecurrenceSummary`.

### Components — Files

`frontend/src/components/files/CreateFolderDialog.tsx` — Simple dialog with a single folder name input for creating a new folder.

`frontend/src/components/files/FileBrowser.tsx` — File and folder browser with upload/new-folder toolbar, grid/list toggle, breadcrumb navigation, and per-item context menus.

`frontend/src/components/files/MoveFileDialog.tsx` — Tree-view folder picker dialog for selecting a destination folder when moving a file or folder.

`frontend/src/components/files/RestrictionDialog.tsx` — Access control dialog to toggle restriction on a file/folder and manage explicit user, group, and role permissions.

`frontend/src/components/files/StorageIndicator.tsx` — Compact progress bar with used/limit text that changes color as storage fills up.

`frontend/src/components/files/UploadDialog.tsx` — Drag-and-drop file upload dialog with a file queue showing per-file progress bars and success/error indicators.

### Components — Image Parse

`frontend/src/components/image-parse/ImageParseDialog.tsx` — Multi-step dialog for uploading or capturing an image, running the VLM+LLM AI pipeline to extract content (recipe, list, or calendar events), and showing editable previews with progress tracking.

`frontend/src/components/image-parse/index.ts` — Barrel export for ImageParseDialog, ListPreview, RecipePreview, and CalendarEventsPreview.

`frontend/src/components/image-parse/previews/CalendarEventsPreview.tsx` — Editable list of AI-parsed calendar events with title, date/time pickers, location, description, and low-confidence badges.

`frontend/src/components/image-parse/previews/ListPreview.tsx` — Editable preview of AI-parsed list items with optional title, list type selector, and deletable item list with low-confidence badges.

`frontend/src/components/image-parse/previews/RecipePreview.tsx` — Editable preview of AI-parsed recipe data with title, description, time/servings fields, and collapsible ingredients and instructions sections.

### Components — Inventory

`frontend/src/components/inventory/AddToListDialog.tsx` — Two-mode dialog: search catalog items to add to the shopping list, or create a new item that also gets added.

`frontend/src/components/inventory/AreaCard.tsx` — Collapsible card for a storage area showing items with quantity, expiry countdown badges, and low-stock highlighting.

`frontend/src/components/inventory/AreaForm.tsx` — Dialog to create or edit a storage area with a name field and an emoji icon picker grid.

`frontend/src/components/inventory/BulkAddDialog.tsx` — Two-tab dialog (spreadsheet-style table or paste-a-list) for adding multiple inventory items at once.

`frontend/src/components/inventory/CheckOffItemDialog.tsx` — Dialog when marking a shopping list item as acquired: user enters actual quantity obtained and optionally keeps the remainder on the list.

`frontend/src/components/inventory/FixIncompleteItemDialog.tsx` — Step-through wizard for resolving inventory items missing required fields, showing only missing fields per item.

`frontend/src/components/inventory/ItemForm.tsx` — Full inventory item create/edit form with name, category, unit, storage area, icon, barcode, density (with auto-suggest), and keep-in-stock threshold.

`frontend/src/components/inventory/LeftoverCard.tsx` — Row card for a leftover food item showing name, source, age, storage area, expiry countdown with color urgency, and actions.

`frontend/src/components/inventory/LeftoverForm.tsx` — Dialog to create/edit a leftover entry with name, source type, linked recipe or restaurant, storage area, portions, and expiry date.

`frontend/src/components/inventory/ManageStockDialog.tsx` — Dialog listing all stock entries for a single inventory item; shows total quantity with cross-unit conversion, and allows adding, editing, or deleting entries.

`frontend/src/components/inventory/PutAwayDialog.tsx` — Post-shopping workflow for moving checked-off items into inventory: quick batch put-away using default locations or step-by-step per item.

`frontend/src/components/inventory/ShoppingListItem.tsx` — Shopping list row with checkbox, item name, quantity/unit, category badge, source badge, and a context menu.

`frontend/src/components/inventory/UnitConversionPromptDialog.tsx` — Dialog that appears when adding stock in a non-convertible unit; asks for the gram weight per unit to enable future conversions.

### Components — Lists

`frontend/src/components/lists/ListItem.tsx` — Single list item row with a checkbox, inline text editing, optional due date with overdue highlighting, a drag handle, and a delete button.

### Components — Music

`frontend/src/components/music/MusicPlayer.tsx` — Persistent bottom music player bar with playback controls, progress slider, and volume; expands to full-screen with album art and a floating queue panel.

### Components — Notifications

`frontend/src/components/notifications/NotificationCenter.tsx` — Bell-button + popover notification panel with full CRUD and action button support.

`frontend/src/components/notifications/NotificationItem.tsx` — Individual notification row with type icon, title, body, relative timestamp, unread dot, and a hover-revealed delete button.

`frontend/src/components/notifications/NotificationPanel.tsx` — Notification list panel (used in the header dropdown) with a "Mark all read" button and a scrollable list.

### Components — Permissions

`frontend/src/components/permissions/FeatureGate.tsx` — Render-gate component that conditionally renders children only if the user has the required feature permission level.

`frontend/src/components/permissions/PermissionBadge.tsx` — Badge displaying a user's access level to a resource with a tooltip.

`frontend/src/components/permissions/ShareButton.tsx` — Button that opens ShareDialog, optionally showing the current share count.

`frontend/src/components/permissions/ShareDialog.tsx` — Dialog for granting, updating, or revoking resource access to users, groups, or the whole household with permission level selection.

`frontend/src/components/permissions/index.ts` — Barrel re-export of all permission components.

### Components — Recipes

`frontend/src/components/recipes/RecipeCard.tsx` — Recipe thumbnail card (and list-item variant) showing image, title, description, total time, servings, and tags.

`frontend/src/components/recipes/RecipeForm.tsx` — Tabbed create/edit dialog for recipes with Details (image, title, description, timing, difficulty, tags), Ingredients (amount/unit/name rows with live inventory search and linking), and Instructions (numbered steps) tabs.

`frontend/src/components/recipes/RecipeImageInput.tsx` — Image input component with drag-drop upload zone, URL fetch option, live preview, and replace/remove actions.

### Components — Settings

`frontend/src/components/settings/ColorPickerRow.tsx` — A labeled row with a native color picker, hex input field, and a color swatch preview for theme editing.

`frontend/src/components/settings/ThemeEditor.tsx` — Dialog for creating/editing custom themes with live CSS variable preview; toggles between light/dark mode editing.

### Components — Setup

`frontend/src/components/setup/AdminSetup.tsx` — Setup wizard step with display name, email, password, and confirm password fields to create the first admin account.

`frontend/src/components/setup/HouseholdSetup.tsx` — Setup wizard step with household name and timezone selector (auto-detected).

`frontend/src/components/setup/RemoteAccessSetup.tsx` — Setup wizard step presenting four radio-card options (Local Only, Cloudflare Tunnel, Tailscale, Custom Domain) with a skip option.

`frontend/src/components/setup/SetupComplete.tsx` — Final setup wizard step showing a success icon and "what's next" checklist.

`frontend/src/components/setup/SetupWizard.tsx` — Orchestrates the four-step first-run setup wizard with a progress indicator and error display.

### Components — Shared

`frontend/src/components/shared/ConfirmDialog.tsx` — Generic reusable alert dialog with configurable title, description, confirm/cancel button labels, and a destructive variant.

`frontend/src/components/shared/EmptyState.tsx` — Centered empty-state layout with an optional icon, title, description, and action button slot.

`frontend/src/components/shared/ErrorBoundary.tsx` — React class error boundary that catches render errors and shows a fallback UI with a "Try again" button.

`frontend/src/components/shared/LoadingSpinner.tsx` — Spinning Loader2 icon in sm/md/lg sizes; also exports `LoadingPage` which centers a large spinner.

`frontend/src/components/shared/SearchInput.tsx` — Debounced search input with a search icon and a clear (X) button.

`frontend/src/components/shared/UserAvatar.tsx` — Avatar component that shows a user's profile image or falls back to their initials, in sm/md/lg sizes.

### Components — Tasks

`frontend/src/components/tasks/TaskCard.tsx` — Task card with a circle complete-button, title, optional description, priority badge, due date indicator, points display, and an assignee avatar; also exports `TaskList`.

`frontend/src/components/tasks/TaskForm.tsx` — Create/edit task dialog with title, description, due date/time, priority, assignee, recurrence, and an optional chore/points toggle.

### Pages — Auth

`frontend/src/pages/auth/ForgotPasswordPage.tsx` — Full-page layout wrapping ForgotPasswordForm with the app logo and heading.

`frontend/src/pages/auth/JoinPage.tsx` — Invite-based join page that validates the household invite code from the URL and renders the registration form.

`frontend/src/pages/auth/LoginPage.tsx` — Split-screen login page with the form on the left and a decorative tagline panel on the right; redirects authenticated users to /dashboard.

`frontend/src/pages/auth/RegisterPage.tsx` — Split-screen registration page accepting a `?household=` query param; redirects to /login if no household ID is present.

`frontend/src/pages/auth/ResetPasswordPage.tsx` — Full-page layout wrapping ResetPasswordForm with the app logo and heading.

### Pages — Dashboard

`frontend/src/pages/dashboard/DashboardPage.tsx` — Home dashboard showing four summary cards: Today's Events, Today's Meals (grouped by meal type with Cook links), Expiring Soon inventory items, and Pending Tasks with inline complete checkboxes.

### Pages — Calendar

`frontend/src/pages/calendar/CalendarPage.tsx` — Main calendar page with month/week/day view toggle, collapsible sidebar (calendar list with color toggles), event create/edit/delete dialogs, recurring event scope pickers, a search modal, and AI image-parse entry point.

### Pages — Files

`frontend/src/pages/files/FilesPage.tsx` — Full-featured file manager with folder navigation, breadcrumbs, grid/list views, multi-select bulk actions, search, upload, create folder, move, delete, restrict, and a storage indicator.

### Pages — Inventory

`frontend/src/pages/inventory/InventoryPage.tsx` — Inventory management page with tabbed views for stock (by area or flat list with filtering/sorting), leftovers, and shopping list; supports CRUD for items, areas, stock entries, and bulk operations.

`frontend/src/pages/inventory/ShoppingListPage.tsx` — Shopping list page showing checked/unchecked items; clicking an unchecked item opens the CheckOffItemDialog to record acquired quantity, with Put Away and Add to List actions.

### Pages — Lists

`frontend/src/pages/lists/ListDetailPage.tsx` — Detail view for a single list showing its items as checkboxes with inline add input, clear-checked action, delete list with confirmation, and a share button.

`frontend/src/pages/lists/ListsPage.tsx` — Grid of all lists (checklist/reminder/notes) with type-appropriate icons; "New List" dropdown offers manual creation or AI image-parse import.

### Pages — Recipes

`frontend/src/pages/recipes/AddMealDialog.tsx` — Dialog to add a recipe to a specific date and meal type on the meal plan, with a searchable recipe list and multi-select support.

`frontend/src/pages/recipes/AddTimerDialog.tsx` — Timer creation dialog with a name field, quick-select time presets, and custom minutes/seconds inputs.

`frontend/src/pages/recipes/BulkIngredientActions.tsx` — Toolbar strip shown during recipe import showing linked/unmatched counts with quick-action buttons to auto-accept high-confidence matches, create all unmatched items, or skip all.

`frontend/src/pages/recipes/CookModePage.tsx` — Step-by-step cooking mode page with linear or checklist modes, an ingredients sidebar sheet, active timers, step navigation, and dialogs to finish cooking (with inventory adjustment) or exit with a warning.

`frontend/src/pages/recipes/ExitCookingWarningDialog.tsx` — Dialog warning the user they'll miss inventory adjustment if they exit cook mode early; offers "Finish & Adjust Inventory" or "Exit Without Finishing."

`frontend/src/pages/recipes/FinishCookingDialog.tsx` — Two-step dialog for finishing a cooking session: confirm ingredient quantities used (with per-ingredient adjustments) and apply the deduction to inventory stock.

`frontend/src/pages/recipes/GenerateShoppingListDialog.tsx` — Dialog to generate a shopping list from a week's meal plan with options to check existing inventory and a servings multiplier; shows a preview of items to add before confirming.

`frontend/src/pages/recipes/ImportRecipeDialog.tsx` — Multi-step import dialog supporting URL, PDF, text, and .recipe file sources; shows a parsed recipe preview with confidence badge and method label, then an ingredient matching step.

`frontend/src/pages/recipes/IngredientMatchRow.tsx` — Row component used during recipe import to display a parsed ingredient with match suggestions (exact/synonym/fuzzy), allow the user to accept/override/unlink a catalog match, or create a new inventory item inline.

`frontend/src/pages/recipes/MealPlanPage.tsx` — Weekly meal plan grid (Sun-Sat x breakfast/lunch/dinner/snack) with previous/next week navigation, click-to-add meals, and a "Generate Shopping List" button.

`frontend/src/pages/recipes/RecipeDetailPage.tsx` — Recipe detail page showing image, title, timing, servings, ingredients, numbered instructions, and tags; includes Edit, Delete, Cook Mode, and Add to Meal Plan actions.

`frontend/src/pages/recipes/RecipesPage.tsx` — Recipe catalog with grid/list view toggle, search, and three creation paths: manual form, URL/text import dialog, and AI image-parse dialog.

### Pages — Media

`frontend/src/pages/movies/MoviesPage.tsx` — Movies and TV shows browser with Movies/TV tabs, sort and genre filters, an unwatched-only toggle, and a "Continue Watching" section.

`frontend/src/pages/music/MusicPage.tsx` — Music library browser with Artists/Albums/Recent tabs, search, and track tables; clicking a track plays it via the player store.

`frontend/src/pages/photos/PhotosPage.tsx` — Photo browser with grid, timeline (grouped by date), and map (by location) views; supports year/month filtering, camera filtering, and a full-screen preview lightbox.

`frontend/src/pages/videos/VideosPage.tsx` — Video browser with grid and timeline views, sort/order selectors, year/month filters, and a video preview player.

`frontend/src/pages/videos/index.ts` — Barrel export for VideosPage.

### Pages — Tasks

`frontend/src/pages/tasks/TasksPage.tsx` — Tasks page with All/Mine/Chores filter tabs, a task list with inline complete checkboxes and priority badges, and a create task button.

`frontend/src/pages/tasks/RewardsPage.tsx` — Rewards page showing the user's current points, lifetime points, tasks completed, and a grid of achievements with progress indicators.

### Pages — Settings

`frontend/src/pages/settings/SettingsPage.tsx` — Settings shell with a left nav sidebar (filtered by admin permission) and a nested Routes area for sub-pages.

`frontend/src/pages/settings/CalendarSettingsPage.tsx` — Calendar settings page listing all calendars with color palette picker, Google Calendar OAuth sync controls, ICS import/export, and per-calendar sharing and public link management.

`frontend/src/pages/settings/FeaturePermissionsPage.tsx` — Admin page for configuring per-feature access levels for each user role, individual users, and groups.

`frontend/src/pages/settings/GroupsSettingsPage.tsx` — Groups management page for creating, editing, and deleting named groups, and managing their membership.

`frontend/src/pages/settings/HouseholdSettingsPage.tsx` — Settings page with a form to update household name and timezone.

`frontend/src/pages/settings/MembersSettingsPage.tsx` — Members settings page listing household members with role badges and role-change dropdowns; also shows pending invites with copy-link and a "Generate Invite Link" button.

`frontend/src/pages/settings/ProfileSettingsPage.tsx` — Profile settings page with avatar display and a form to update display name and email.

`frontend/src/pages/settings/StorageSettingsPage.tsx` — Storage settings page showing used/total storage with a color-coded progress bar, per-category breakdown, and optional custom storage limit.

`frontend/src/pages/settings/ThemeSettingsPage.tsx` — Theme settings page with light/dark/system mode selector, color palette presets, font size and border radius sliders, and a custom theme editor.

### Pages — Setup

`frontend/src/pages/setup/SetupPage.tsx` — Entry point for first-run setup that checks whether setup is complete; redirects to /login if done, otherwise renders SetupWizard.

### Frontend Config

`frontend/package.json` — Frontend npm manifest; key deps are React 18, React Router v6, TanStack Query, Zustand, shadcn/Radix UI primitives, react-hook-form, Zod, Recharts, and Socket.io-client; built with Vite + TypeScript.

`frontend/vite.config.ts` — Vite config that proxies `/api` to the backend (with SSE buffering disabled for `/counsel/stream`) and `/socket.io` (with WebSocket support), reads env vars, and aliases `@/` to `./src/`.

`frontend/tsconfig.json` — TypeScript config for bundler-mode React (ESNext modules, react-jsx, no emit), with the `@/*` alias.

---

## Services

### VLM-LLM (Python microservice for image parsing)

`services/vlm-llm/main.py` — FastAPI entry point for the two-stage image parsing microservice; orchestrates preprocessing, VLM extraction (single or multi-pass), optional verification, and LLM structuring across endpoints `/extract/base64`, `/vlm/describe`, `/llm/structure`, `/extract/counsel`, and `/preprocess`.

`services/vlm-llm/vlm_service.py` — Stage 1 wrapper around Ollama's vision API; submits a base64 image to llava/minicpm-v and returns raw transcribed text.

`services/vlm-llm/llm_service.py` — Stage 2 wrapper around Ollama's text API; exposes `LLMService.complete()` and `extract_json()` using qwen2.5:7b.

`services/vlm-llm/prompts.py` — All prompt strings and structuring logic for the pipeline: VLM transcription prompts (standard, quantity-focused, section-by-section), verification prompts, `build_llm_structuring_prompt()` for list/recipe/calendar/unknown types, `detect_content_type()` (regex heuristics), and verification parsing/correction utilities.

`services/vlm-llm/image_preprocessing.py` — OpenCV-based image enhancement pipeline: auto-deskew (Hough lines), CLAHE contrast enhancement, resolution normalization, optional sharpening, and optional denoising.

`services/vlm-llm/multi_pass.py` — Runs 1-3 VLM extraction passes with different prompts, then merges results using string-similarity ingredient voting and heuristic text selection.

`services/vlm-llm/region_extraction.py` — Crops an image into labeled sections (title, ingredients, instructions) using contour detection, re-runs the VLM on each zoomed crop, and merges region texts back into a unified extraction.

`services/vlm-llm/counsel_mode.py` — SSE streaming feature where 10 culinary persona objects each interpret a recipe via the LLM, surface disagreements, hold a structured debate, vote on contentious points, and emit a final recipe JSON as Server-Sent Events.

`services/vlm-llm/accuracy_test.py` — CLI test harness that runs extraction strategies against known test images, scores on ingredient accuracy/quantities/hallucinations, and iterates with progressively more targeted prompts.

`services/vlm-llm/requirements.txt` — Python dependencies: FastAPI, Uvicorn, httpx, Pydantic/pydantic-settings, opencv-python-headless, and numpy.

`services/vlm-llm/Dockerfile` — Python 3.11-slim image that installs OpenCV system libs and Python requirements, exposes port 8000, and runs via Uvicorn with a curl-based health check.

---

## UI Components (shadcn/ui)

Located in `frontend/src/components/ui/`. These are standard shadcn/Radix primitives and are not individually described:

alert-dialog, alert, avatar, badge, button, calendar, card, checkbox, collapsible, combobox, command, dialog, dropdown-menu, input, label, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, switch, table, tabs, textarea, toast, toaster, tooltip
