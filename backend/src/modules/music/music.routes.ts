import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  files,
  artists,
  musicAlbums,
  tracks,
  listenHistory,
  playQueues,
  playQueueItems,
  playlists,
  playlistItems,
} from '../../db/schema/index.js';
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import { permissionService, type PermissionContext } from '../../services/permission.service.js';

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  // ===== ARTISTS =====

  // List artists
  app.get(
    '/artists',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { search, limit = 100, offset = 0 } = z
        .object({
          search: z.string().optional(),
          limit: z.coerce.number().min(1).max(500).default(100),
          offset: z.coerce.number().min(0).default(0),
        })
        .parse(request.query);

      let artistList = await db.query.artists.findMany({
        where: eq(artists.householdId, request.user!.householdId),
        orderBy: [asc(artists.sortName), asc(artists.name)],
      });

      if (search) {
        const searchLower = search.toLowerCase();
        artistList = artistList.filter((a) =>
          a.name.toLowerCase().includes(searchLower)
        );
      }

      const total = artistList.length;
      const paginatedArtists = artistList.slice(offset, offset + limit);

      return {
        success: true,
        data: {
          artists: paginatedArtists,
          total,
          hasMore: offset + limit < total,
        },
      };
    }
  );

  // Get artist with albums
  app.get<{ Params: { id: string } }>(
    '/artists/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const artist = await db.query.artists.findFirst({
        where: and(
          eq(artists.id, request.params.id),
          eq(artists.householdId, request.user!.householdId)
        ),
      });

      if (!artist) throw Errors.notFound('Artist');

      // Get albums
      const albumList = await db.query.musicAlbums.findMany({
        where: eq(musicAlbums.artistId, artist.id),
        orderBy: [desc(musicAlbums.releaseDate)],
      });

      // Get tracks not in albums
      const looseTracks = await db.query.tracks.findMany({
        where: and(
          eq(tracks.artistId, artist.id),
          sql`${tracks.albumId} IS NULL`
        ),
        orderBy: [asc(tracks.title)],
      });

      return {
        success: true,
        data: {
          artist,
          albums: albumList,
          looseTracks,
        },
      };
    }
  );

  // Create artist
  app.post(
    '/artists',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = z
        .object({
          name: z.string().min(1).max(500),
          sortName: z.string().optional(),
          biography: z.string().optional(),
        })
        .parse(request.body);

      const [artist] = await db
        .insert(artists)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          sortName: input.sortName,
          biography: input.biography,
        })
        .returning();

      return { success: true, data: { artist } };
    }
  );

  // ===== ALBUMS =====

  // List albums
  app.get(
    '/albums',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { artistId, genre, sortBy = 'name', limit = 100, offset = 0 } = z
        .object({
          artistId: z.string().uuid().optional(),
          genre: z.string().optional(),
          sortBy: z.enum(['name', 'releaseDate', 'artist']).default('name'),
          limit: z.coerce.number().min(1).max(500).default(100),
          offset: z.coerce.number().min(0).default(0),
        })
        .parse(request.query);

      let albumList = await db.query.musicAlbums.findMany({
        where: eq(musicAlbums.householdId, request.user!.householdId),
      });

      if (artistId) {
        albumList = albumList.filter((a) => a.artistId === artistId);
      }

      if (genre) {
        albumList = albumList.filter((a) => a.genres?.includes(genre));
      }

      // Get artist names for sorting
      const artistIds = [...new Set(albumList.map((a) => a.artistId).filter(Boolean))];
      const artistMap = new Map<string, string>();
      if (artistIds.length > 0) {
        const artistsData = await db.query.artists.findMany({
          where: sql`${artists.id} IN (${sql.join(
            artistIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
        });
        artistsData.forEach((a) => artistMap.set(a.id, a.name));
      }

      // Sort
      albumList.sort((a, b) => {
        switch (sortBy) {
          case 'name':
            return a.name.localeCompare(b.name);
          case 'releaseDate':
            return (
              new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime()
            );
          case 'artist':
            const artistA = a.artistId ? artistMap.get(a.artistId) || '' : '';
            const artistB = b.artistId ? artistMap.get(b.artistId) || '' : '';
            return artistA.localeCompare(artistB);
          default:
            return 0;
        }
      });

      const total = albumList.length;
      const paginatedAlbums = albumList.slice(offset, offset + limit);

      // Enrich with artist names
      const enriched = paginatedAlbums.map((album) => ({
        ...album,
        artistName: album.artistId ? artistMap.get(album.artistId) : null,
      }));

      return {
        success: true,
        data: {
          albums: enriched,
          total,
          hasMore: offset + limit < total,
        },
      };
    }
  );

  // Get album with tracks
  app.get<{ Params: { id: string } }>(
    '/albums/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const album = await db.query.musicAlbums.findFirst({
        where: and(
          eq(musicAlbums.id, request.params.id),
          eq(musicAlbums.householdId, request.user!.householdId)
        ),
      });

      if (!album) throw Errors.notFound('Album');

      // Get tracks
      const trackList = await db.query.tracks.findMany({
        where: eq(tracks.albumId, album.id),
        orderBy: [asc(tracks.discNumber), asc(tracks.trackNumber)],
      });

      // Get artist
      const artist = album.artistId
        ? await db.query.artists.findFirst({
            where: eq(artists.id, album.artistId),
          })
        : null;

      // Get file info for tracks (excluding files marked as excluded from categories)
      const fileIds = trackList.map((t) => t.fileId);
      const filesData =
        fileIds.length > 0
          ? await db.query.files.findMany({
              where: and(
                sql`${files.id} IN (${sql.join(
                  fileIds.map((id) => sql`${id}`),
                  sql`, `
                )})`,
                eq(files.excludedFromCategories, false)
              ),
            })
          : [];

      // Filter out files in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };

      let accessibleFiles = filesData;
      if (context.userRole !== 'admin' && filesData.length > 0) {
        const checks = filesData.map((f) => ({
          resourceType: 'file' as const,
          resourceId: f.id,
          level: 'view' as const,
        }));
        const accessResults = await permissionService.batchCanAccess(context, checks);
        accessibleFiles = filesData.filter((f) => accessResults.get(f.id) === true);
      }

      const fileMap = new Map(accessibleFiles.map((f) => [f.id, f]));

      // Only include tracks whose files are accessible and not excluded
      const enrichedTracks = trackList
        .filter((track) => fileMap.has(track.fileId))
        .map((track) => ({
          ...track,
          file: fileMap.get(track.fileId) || null,
        }));

      return {
        success: true,
        data: {
          album,
          artist,
          tracks: enrichedTracks,
        },
      };
    }
  );

  // ===== TRACKS =====

  // Stream track
  app.get<{ Params: { id: string } }>(
    '/tracks/:id/stream',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const track = await db.query.tracks.findFirst({
        where: eq(tracks.id, request.params.id),
      });

      if (!track) throw Errors.notFound('Track');

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, track.fileId),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Check if user can access this file (respects folder restrictions)
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const canAccess = await permissionService.canAccess(context, 'file', file.id, 'view');
      if (!canAccess) throw Errors.notFound('File');

      const stat = await fs.stat(file.storagePath);
      const fileSize = stat.size;
      const range = request.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const stream = createReadStream(file.storagePath, { start, end });

        reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
          .header('Accept-Ranges', 'bytes')
          .header('Content-Length', chunkSize)
          .header('Content-Type', file.mimeType)
          .send(stream);
      } else {
        const stream = createReadStream(file.storagePath);

        reply
          .header('Content-Length', fileSize)
          .header('Content-Type', file.mimeType)
          .header('Accept-Ranges', 'bytes')
          .send(stream);
      }
    }
  );

  // Record listen history
  app.post<{ Params: { id: string } }>(
    '/tracks/:id/listen',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { duration } = z
        .object({ duration: z.number().int().min(0).optional() })
        .parse(request.body);

      const track = await db.query.tracks.findFirst({
        where: eq(tracks.id, request.params.id),
      });

      if (!track) throw Errors.notFound('Track');

      await db.insert(listenHistory).values({
        userId: request.user!.id,
        trackId: request.params.id,
        duration,
      });

      return { success: true, data: { message: 'Listen recorded' } };
    }
  );

  // ===== PLAY QUEUE =====

  // Get current queue
  app.get(
    '/queue',
    { preHandler: [authMiddleware] },
    async (request) => {
      let queue = await db.query.playQueues.findFirst({
        where: eq(playQueues.userId, request.user!.id),
      });

      if (!queue) {
        // Create empty queue
        const [newQueue] = await db
          .insert(playQueues)
          .values({ userId: request.user!.id })
          .returning();
        queue = newQueue;
      }

      // Get queue items
      const items = await db.query.playQueueItems.findMany({
        where: eq(playQueueItems.queueId, queue.id),
        orderBy: [asc(playQueueItems.sortOrder)],
      });

      // Get track details
      const trackIds = items.map((i) => i.trackId);
      const trackList =
        trackIds.length > 0
          ? await db.query.tracks.findMany({
              where: sql`${tracks.id} IN (${sql.join(
                trackIds.map((id) => sql`${id}`),
                sql`, `
              )})`,
            })
          : [];

      const trackMap = new Map(trackList.map((t) => [t.id, t]));

      const enrichedItems = items.map((item) => ({
        ...item,
        track: trackMap.get(item.trackId) || null,
      }));

      return {
        success: true,
        data: {
          queue,
          items: enrichedItems,
        },
      };
    }
  );

  // Update queue
  app.put(
    '/queue',
    { preHandler: [authMiddleware] },
    async (request) => {
      const input = z
        .object({
          trackIds: z.array(z.string().uuid()).optional(),
          currentIndex: z.number().int().min(0).optional(),
          currentPosition: z.number().int().min(0).optional(),
          shuffled: z.boolean().optional(),
          repeatMode: z.enum(['off', 'all', 'one']).optional(),
        })
        .parse(request.body);

      let queue = await db.query.playQueues.findFirst({
        where: eq(playQueues.userId, request.user!.id),
      });

      if (!queue) {
        const [newQueue] = await db
          .insert(playQueues)
          .values({ userId: request.user!.id })
          .returning();
        queue = newQueue;
      }

      // Update queue settings
      await db
        .update(playQueues)
        .set({
          currentIndex: input.currentIndex ?? queue.currentIndex,
          currentPosition: input.currentPosition ?? queue.currentPosition,
          shuffled: input.shuffled ?? queue.shuffled,
          repeatMode: input.repeatMode ?? queue.repeatMode,
          updatedAt: new Date(),
        })
        .where(eq(playQueues.id, queue.id));

      // Update track list if provided
      if (input.trackIds) {
        // Clear existing items
        await db.delete(playQueueItems).where(eq(playQueueItems.queueId, queue.id));

        // Add new items
        if (input.trackIds.length > 0) {
          await db.insert(playQueueItems).values(
            input.trackIds.map((trackId, index) => ({
              queueId: queue!.id,
              trackId,
              sortOrder: index,
            }))
          );
        }
      }

      return { success: true, data: { message: 'Queue updated' } };
    }
  );

  // Add to queue
  app.post(
    '/queue/add',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { trackIds, position } = z
        .object({
          trackIds: z.array(z.string().uuid()),
          position: z.enum(['end', 'next']).default('end'),
        })
        .parse(request.body);

      let queue = await db.query.playQueues.findFirst({
        where: eq(playQueues.userId, request.user!.id),
      });

      if (!queue) {
        const [newQueue] = await db
          .insert(playQueues)
          .values({ userId: request.user!.id })
          .returning();
        queue = newQueue;
      }

      // Get current items
      const currentItems = await db.query.playQueueItems.findMany({
        where: eq(playQueueItems.queueId, queue.id),
        orderBy: [asc(playQueueItems.sortOrder)],
      });

      let newSortOrder: number;
      if (position === 'next') {
        // Insert after current track
        newSortOrder = (queue.currentIndex || 0) + 1;
        // Shift existing items
        for (let i = currentItems.length - 1; i >= newSortOrder; i--) {
          await db
            .update(playQueueItems)
            .set({ sortOrder: currentItems[i].sortOrder + trackIds.length })
            .where(eq(playQueueItems.id, currentItems[i].id));
        }
      } else {
        // Add to end
        newSortOrder = currentItems.length;
      }

      // Add new items
      await db.insert(playQueueItems).values(
        trackIds.map((trackId, index) => ({
          queueId: queue!.id,
          trackId,
          sortOrder: newSortOrder + index,
        }))
      );

      return { success: true, data: { message: 'Added to queue' } };
    }
  );

  // Clear queue
  app.delete(
    '/queue',
    { preHandler: [authMiddleware] },
    async (request) => {
      const queue = await db.query.playQueues.findFirst({
        where: eq(playQueues.userId, request.user!.id),
      });

      if (queue) {
        await db.delete(playQueueItems).where(eq(playQueueItems.queueId, queue.id));
        await db
          .update(playQueues)
          .set({
            currentIndex: 0,
            currentPosition: 0,
            updatedAt: new Date(),
          })
          .where(eq(playQueues.id, queue.id));
      }

      return { success: true, data: { message: 'Queue cleared' } };
    }
  );

  // ===== LISTEN HISTORY =====

  // Get listen history
  app.get(
    '/history',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { limit = 50, offset = 0 } = z
        .object({
          limit: z.coerce.number().min(1).max(200).default(50),
          offset: z.coerce.number().min(0).default(0),
        })
        .parse(request.query);

      const history = await db.query.listenHistory.findMany({
        where: eq(listenHistory.userId, request.user!.id),
        orderBy: [desc(listenHistory.listenedAt)],
        limit: limit + 1,
        offset,
      });

      const hasMore = history.length > limit;
      const items = hasMore ? history.slice(0, limit) : history;

      // Get track details
      const trackIds = [...new Set(items.map((h) => h.trackId))];
      const trackList =
        trackIds.length > 0
          ? await db.query.tracks.findMany({
              where: sql`${tracks.id} IN (${sql.join(
                trackIds.map((id) => sql`${id}`),
                sql`, `
              )})`,
            })
          : [];

      const trackMap = new Map(trackList.map((t) => [t.id, t]));

      const enrichedHistory = items.map((item) => ({
        ...item,
        track: trackMap.get(item.trackId) || null,
      }));

      return {
        success: true,
        data: {
          history: enrichedHistory,
          hasMore,
        },
      };
    }
  );

  // Get recently played (unique tracks)
  app.get(
    '/recent',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { limit = 20 } = z
        .object({ limit: z.coerce.number().min(1).max(100).default(20) })
        .parse(request.query);

      // Get recent listens
      const history = await db.query.listenHistory.findMany({
        where: eq(listenHistory.userId, request.user!.id),
        orderBy: [desc(listenHistory.listenedAt)],
        limit: limit * 3, // Get more to ensure enough unique tracks
      });

      // Get unique track IDs
      const seenTracks = new Set<string>();
      const uniqueHistory = history.filter((h) => {
        if (seenTracks.has(h.trackId)) return false;
        seenTracks.add(h.trackId);
        return true;
      }).slice(0, limit);

      // Get track details
      const trackIds = uniqueHistory.map((h) => h.trackId);
      const trackList =
        trackIds.length > 0
          ? await db.query.tracks.findMany({
              where: sql`${tracks.id} IN (${sql.join(
                trackIds.map((id) => sql`${id}`),
                sql`, `
              )})`,
            })
          : [];

      const trackMap = new Map(trackList.map((t) => [t.id, t]));

      const recentTracks = uniqueHistory.map((h) => ({
        ...trackMap.get(h.trackId),
        lastPlayed: h.listenedAt,
      }));

      return { success: true, data: { tracks: recentTracks } };
    }
  );

  // Get available genres
  app.get(
    '/genres',
    { preHandler: [authMiddleware] },
    async (request) => {
      const albumList = await db.query.musicAlbums.findMany({
        where: eq(musicAlbums.householdId, request.user!.householdId),
        columns: { genres: true },
      });

      const trackList = await db.query.tracks.findMany({
        columns: { genre: true },
      });

      const genreSet = new Set<string>();
      for (const album of albumList) {
        album.genres?.forEach((g) => genreSet.add(g));
      }
      for (const track of trackList) {
        if (track.genre) genreSet.add(track.genre);
      }

      return { success: true, data: { genres: Array.from(genreSet).sort() } };
    }
  );
}
