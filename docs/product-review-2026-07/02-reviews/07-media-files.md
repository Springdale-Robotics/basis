# Area review — Media & files

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

- **Backend modules** (all `/api/v1/`):
  - `files/files.routes.ts` (1876 ln): upload (multipart single file), download, stream (range requests), thumbnails, folders (recursive CTEs), albums, playlists, favorites, ratings, bulk move/delete/exclude, storage quota/usage, library scan, per-file/folder ACL.
  - `photos/photos.routes.ts`: photo list with EXIF filters, timeline, location clusters, smart albums, camera facets.
  - `videos/videos.routes.ts`: list + timeline (thin).
  - `movies/movies.routes.ts`: movies/TV/episodes metadata, watch progress, continue-watching, genres. An `hls_streams` table is read but **nothing writes it — there is no transcoding pipeline at all** (`enableTranscoding` is a dead toggle).
  - `music/music.routes.ts`: artists/albums/tracks, streaming, play queue, listen history.
- **Worker**: `media.worker.ts` — thumbnail/EXIF/video_info via BullMQ (3 attempts, backoff, concurrency 3). `services/thumbnail.service.ts` (sharp + ffmpeg), `exif.service.ts`, `media-scanner.service.ts`.
- **Schema**: `files.ts` (folders/files/albums/playlists), `media.ts` (thumbnails, favorites, ratings, jobs, photoMetadata, smartAlbums, movies, tv, watchProgress, hlsStreams, artists/albums/tracks, listenHistory, playQueues, mediaSettings). FKs cascade; files household-scoped.
- **Config**: `THUMBNAIL_SIZES` `150,400,800`, `THUMBNAIL_QUALITY` 80, `MAX_UPLOAD_SIZE_MB` 100, `STORAGE_PATH` `./storage`.
- **Frontend**: PhotosPage (grid/timeline/map, `useInfiniteQuery` + "Load more"), FilesPage (1184 ln), MoviesPage/MovieDetailPage (`<video src=stream>` resume + 10s progress), MusicPage (persistent audio player), VideosPage.

## Usability findings

1. **[HIGH] No video transcoding, so "play a movie on TV/phone" only works for browser-native codecs.** Streaming serves raw bytes (`files.routes.ts:1285-1350`). MKV, HEVC/H.265, AC3 — most real rips — won't play in Chrome/Safari/TV browsers. `hlsStreams`/`enableTranscoding` exist but no producer.
2. **[HIGH SUSPECTED] iPhone photos (HEIC) likely break the photo flow.** Upload accepts any `image/*` (`:375`), but sharp only decodes HEIC when built with libheif; on failure the thumbnail job throws and the frontend falls back to streaming the original HEIC into `<img>` (`PhotosPage.tsx:328-335`), which browsers can't render → broken tiles. No client-side conversion.
3. **[MEDIUM] Big-library browsing: no virtualization, "Load more" button.** PhotosPage renders every loaded photo in the DOM; a 10k-library is 10k `<img>` nodes, and the thumbnail-error fallback swaps in full-size originals per tile — a grid of multi-MB originals over the LAN/tunnel on one failed thumbnail run.
4. **[MEDIUM] No upload entry point on the Photos page** — empty state says "Upload some photos" with no button; users must know to go to Files. Uploads are sequential single-POST.
5. **[MEDIUM] Uploads capped at 100 MB with no chunking/resume** — a typical phone video exceeds this; failure surfaces mid-upload and restarts from zero.
6. **[LOW] Music has no tag ingestion** — scanner creates tracks from filename only; no ID3/album-art parsing. Music section is empty shells unless hand-created.
7. **[LOW] Grid photo order is upload date, not date taken** (`photos.routes.ts:118-123`); timeline uses EXIF `dateTaken`, so the two views disagree.
8. **[LOW] "Sharing" = restriction flags only** — no share-link, no per-album sharing; lightbox offers no "download original" (shows the 800px thumbnail).

## Reliability findings

1. **[HIGH] Library scanner inserts `uploadedBy: householdId` — FK violation, every scanned file fails.** `media-scanner.service.ts:139` vs `files.uploadedBy` FK → `users.id`. Errors are swallowed per file, so the scan "succeeds" with 0 new files. The scan feature appears entirely broken.
2. **[HIGH] Scanner/upload directory mismatch for music.** Upload path is `fileType + 's'` → `musics` (`:389-394`); scanner reads `music`. Same bug corrupts storage-usage breakdown (initialized at key `music`, incremented at `musics`).
3. **[HIGH] Range-request parsing is naive in both stream endpoints** (`files.routes.ts:1321-1337`, `music.routes.ts:326-340`): suffix ranges (`bytes=-500`, sent by Safari) parse `start=NaN`; out-of-range never returns 416; `createReadStream` with NaN throws → 500 mid-playback. No `If-Range`/`ETag`.
4. **[HIGH] Download and thumbnail responses buffer whole files in memory** (`fs.readFile` for download, `:480`; upload buffers via `data.toBuffer()`). Downloading a 4 GB movie loads it fully into the Node heap; concurrent large transfers can OOM the box.
5. **[MEDIUM-HIGH] Bulk delete/move bypass per-file permissions.** Single delete requires `requireFileAccess('admin')`; `DELETE /bulk` and `/bulk/move` require only `requireMember()` (`:764-766, 884-886`) — any member can delete/move restricted files they can't even view.
6. **[MEDIUM] Cross-tenant gaps (metadata-level, need UUID knowledge):** `POST /albums/:id/photos` never verifies `fileIds` belong to the household (then returns the foreign `storagePath` via `with: { file: true }`); music `/genres` queries all tracks with no household filter (leak); `POST /tracks/:id/listen` no household check. Otherwise isolation is solid (paths are `STORAGE_PATH/<type>/<householdId>/<uuid>`, DB reads scoped, `size` param allowlisted — no traversal surface found).
7. **[MEDIUM] Deleting a file never deletes its thumbnails from disk.** `deleteThumbnails` exists with zero callers. DB rows cascade, but webp files accumulate forever.
8. **[MEDIUM] Orphaned-file cleanup is a no-op and never scheduled** (`cleanup.worker.ts:129-147` only logs; `orphaned_files` not in `scheduleRecurringJobs`). DB rows pointing to missing files and disk files with no DB row both persist.
9. **[MEDIUM] Worker failure handling gaps.** Video thumbnail failures return `[]` instead of throwing, so BullMQ never retries and the job is marked "completed" with no thumbnail. Stable jobId means `/thumbnails/regenerate` SUSPECTED silently no-ops; `saveThumbnails` uses `onConflictDoNothing` so regenerated thumbnails never update stale rows. blurHash is dead code (always exceeds the 100-char column guard).
10. **[MEDIUM] Disk-space handling**: quota is check-then-write (race across concurrent uploads), computed by summing every file row in JS rather than SQL `SUM`; ENOSPC during write just 500s with no cleanup of the partial file.
11. **[LOW] `GET /files` loads the entire household file+folder table on every navigation and filters in JS, with sequential per-item permission awaits for non-admins.** Photos/videos non-admin paths do the same. Fine at 1k, painful at 50k.
12. **[LOW] `Content-Disposition` uses the unsanitized user filename** — `"` breaks the header, non-ASCII lacks RFC 5987 encoding. SUSPECTED severity depends on Fastify header validation.

## Test coverage

**Zero.** Not one test touches files, photos, movies, music, videos routes, the media worker, thumbnail service, or scanner. No frontend tests. Untested high-risk logic: range parsing, quota math, recursive folder CTEs, restriction filtering, bulk ops, and the scanner (whose FK bug one integration test would have caught).

## Top 5 recommendations

1. **Fix the two flat-out broken data paths** — scanner `uploadedBy: householdId` FK violation (needs a real system/owner user id) and the `music`/`musics` directory + breakdown-key mismatch.
2. **Harden streaming** — one shared range-parsing helper (suffix ranges, 416, clamp end), stream downloads with `createReadStream` not `readFile`, add ETag/If-Range. Highest-leverage fix for TV/phone playback.
3. **Close the bulk-operation permission bypass** and validate `fileIds` household ownership in `POST /albums/:id/photos`.
4. **Finish the deletion/cleanup lifecycle** — call `deleteThumbnails` on file delete, implement + schedule `orphaned_files` both directions, make video-thumbnail failures throw so BullMQ retries.
5. **Add a first slice of tests** — upload→thumbnail→stream→delete integration (mock sharp/ffmpeg), range-request table tests, quota edges, a scanner round-trip. Then decide a transcode story (even ffmpeg remux to fragmented MP4 when compatible, warn otherwise) and HEIC→JPEG on upload, since those two gate the headline "photos from my phone, movies on my TV" flows.
