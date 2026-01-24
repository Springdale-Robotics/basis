import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  files,
  movies,
  tvShows,
  tvEpisodes,
  watchProgress,
  hlsStreams,
} from '../../db/schema/index.js';
import { eq, and, desc, asc, sql, isNull } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';

const setMovieMetadataSchema = z.object({
  title: z.string().min(1).max(500),
  overview: z.string().optional(),
  releaseDate: z.string().optional(),
  runtime: z.number().optional(),
  genres: z.array(z.string()).optional(),
  director: z.string().optional(),
  tmdbId: z.number().optional(),
  imdbId: z.string().optional(),
});

const createTvShowSchema = z.object({
  name: z.string().min(1).max(500),
  overview: z.string().optional(),
  status: z.string().optional(),
  firstAirDate: z.string().optional(),
  genres: z.array(z.string()).optional(),
  tmdbId: z.number().optional(),
});

const setEpisodeSchema = z.object({
  showId: z.string().uuid(),
  seasonNumber: z.number().int().min(0),
  episodeNumber: z.number().int().min(1),
  name: z.string().optional(),
  overview: z.string().optional(),
  airDate: z.string().optional(),
});

export async function moviesRoutes(app: FastifyInstance): Promise<void> {
  // ===== MOVIES =====

  // List all movies
  app.get(
    '/movies',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { genre, year, unwatched, sortBy = 'title', limit = 100, offset = 0 } = z
        .object({
          genre: z.string().optional(),
          year: z.coerce.number().optional(),
          unwatched: z.coerce.boolean().optional(),
          sortBy: z.enum(['title', 'releaseDate', 'addedDate', 'rating']).default('title'),
          limit: z.coerce.number().min(1).max(500).default(100),
          offset: z.coerce.number().min(0).default(0),
        })
        .parse(request.query);

      let movieList = await db.query.movies.findMany({
        where: eq(movies.householdId, request.user!.householdId),
      });

      // Get file IDs for movies and check which are excluded
      const movieFileIds = movieList.map((m) => m.fileId);
      if (movieFileIds.length > 0) {
        const excludedFiles = await db.query.files.findMany({
          where: and(
            sql`${files.id} IN (${sql.join(
              movieFileIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
            eq(files.excludedFromCategories, true)
          ),
          columns: { id: true },
        });
        const excludedFileIds = new Set(excludedFiles.map((f) => f.id));
        movieList = movieList.filter((m) => !excludedFileIds.has(m.fileId));
      }

      // Filter by genre
      if (genre) {
        movieList = movieList.filter(
          (m) => m.genres?.includes(genre)
        );
      }

      // Filter by year
      if (year) {
        movieList = movieList.filter((m) => {
          if (!m.releaseDate) return false;
          return new Date(m.releaseDate).getFullYear() === year;
        });
      }

      // Filter by unwatched
      if (unwatched) {
        const watched = await db.query.watchProgress.findMany({
          where: and(
            eq(watchProgress.userId, request.user!.id),
            eq(watchProgress.completed, true)
          ),
        });
        const watchedFileIds = new Set(watched.map((w) => w.fileId));
        movieList = movieList.filter((m) => !watchedFileIds.has(m.fileId));
      }

      // Sort
      movieList.sort((a, b) => {
        switch (sortBy) {
          case 'title':
            return a.title.localeCompare(b.title);
          case 'releaseDate':
            return (
              new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime()
            );
          case 'addedDate':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          case 'rating':
            return (b.tmdbRating || 0) - (a.tmdbRating || 0);
          default:
            return 0;
        }
      });

      // Paginate
      const total = movieList.length;
      const paginatedMovies = movieList.slice(offset, offset + limit);

      return {
        success: true,
        data: {
          movies: paginatedMovies,
          total,
          hasMore: offset + limit < total,
        },
      };
    }
  );

  // Get continue watching list
  app.get(
    '/movies/continue',
    { preHandler: [authMiddleware] },
    async (request) => {
      const progress = await db.query.watchProgress.findMany({
        where: and(
          eq(watchProgress.userId, request.user!.id),
          eq(watchProgress.completed, false)
        ),
        orderBy: [desc(watchProgress.lastWatchedAt)],
        limit: 20,
      });

      const fileIds = progress.map((p) => p.fileId);
      if (fileIds.length === 0) {
        return { success: true, data: { items: [] } };
      }

      // Get movies
      const movieList = await db.query.movies.findMany({
        where: and(
          eq(movies.householdId, request.user!.householdId),
          sql`${movies.fileId} IN (${sql.join(
            fileIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        ),
      });

      // Get episodes
      const episodeList = await db.query.tvEpisodes.findMany({
        where: sql`${tvEpisodes.fileId} IN (${sql.join(
          fileIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
      });

      const progressMap = new Map(progress.map((p) => [p.fileId, p]));

      const items = [
        ...movieList.map((m) => ({
          type: 'movie' as const,
          item: m,
          progress: progressMap.get(m.fileId)!,
        })),
        ...episodeList.map((e) => ({
          type: 'episode' as const,
          item: e,
          progress: progressMap.get(e.fileId)!,
        })),
      ].sort(
        (a, b) =>
          new Date(b.progress.lastWatchedAt).getTime() -
          new Date(a.progress.lastWatchedAt).getTime()
      );

      return { success: true, data: { items } };
    }
  );

  // Get movie details
  app.get<{ Params: { id: string } }>(
    '/movies/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const movie = await db.query.movies.findFirst({
        where: and(
          eq(movies.id, request.params.id),
          eq(movies.householdId, request.user!.householdId)
        ),
      });

      if (!movie) throw Errors.notFound('Movie');

      // Get file info
      const file = await db.query.files.findFirst({
        where: eq(files.id, movie.fileId),
      });

      // Get watch progress
      const progress = await db.query.watchProgress.findFirst({
        where: and(
          eq(watchProgress.userId, request.user!.id),
          eq(watchProgress.fileId, movie.fileId)
        ),
      });

      // Get HLS streams
      const streams = await db.query.hlsStreams.findMany({
        where: eq(hlsStreams.fileId, movie.fileId),
      });

      return {
        success: true,
        data: {
          movie,
          file,
          progress,
          streams: streams.filter((s) => s.ready),
        },
      };
    }
  );

  // Set movie metadata manually
  app.post<{ Params: { id: string } }>(
    '/movies/:id/metadata',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = setMovieMetadataSchema.parse(request.body);

      const movie = await db.query.movies.findFirst({
        where: and(
          eq(movies.id, request.params.id),
          eq(movies.householdId, request.user!.householdId)
        ),
      });

      if (!movie) throw Errors.notFound('Movie');

      const [updated] = await db
        .update(movies)
        .set({
          ...input,
          manualMatch: true,
          updatedAt: new Date(),
        })
        .where(eq(movies.id, request.params.id))
        .returning();

      return { success: true, data: { movie: updated } };
    }
  );

  // Create movie from video file
  app.post(
    '/movies',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileId, title } = z
        .object({
          fileId: z.string().uuid(),
          title: z.string().min(1),
        })
        .parse(request.body);

      // Verify file exists and is a video
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, fileId),
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'video')
        ),
      });

      if (!file) throw Errors.notFound('Video file');

      // Check if already a movie
      const existing = await db.query.movies.findFirst({
        where: eq(movies.fileId, fileId),
      });

      if (existing) {
        return { success: true, data: { movie: existing, message: 'Movie already exists' } };
      }

      const [movie] = await db
        .insert(movies)
        .values({
          fileId,
          householdId: request.user!.householdId,
          title,
        })
        .returning();

      return { success: true, data: { movie } };
    }
  );

  // Delete movie
  app.delete<{ Params: { id: string } }>(
    '/movies/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db.delete(movies).where(
        and(
          eq(movies.id, request.params.id),
          eq(movies.householdId, request.user!.householdId)
        )
      );

      return { success: true, data: { message: 'Movie deleted' } };
    }
  );

  // ===== TV SHOWS =====

  // List TV shows
  app.get(
    '/tv',
    { preHandler: [authMiddleware] },
    async (request) => {
      const showList = await db.query.tvShows.findMany({
        where: eq(tvShows.householdId, request.user!.householdId),
        orderBy: [asc(tvShows.name)],
      });

      return { success: true, data: { shows: showList } };
    }
  );

  // Get TV show with seasons
  app.get<{ Params: { id: string } }>(
    '/tv/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const show = await db.query.tvShows.findFirst({
        where: and(
          eq(tvShows.id, request.params.id),
          eq(tvShows.householdId, request.user!.householdId)
        ),
      });

      if (!show) throw Errors.notFound('TV Show');

      // Get all episodes
      const episodesList = await db.query.tvEpisodes.findMany({
        where: eq(tvEpisodes.showId, show.id),
        orderBy: [asc(tvEpisodes.seasonNumber), asc(tvEpisodes.episodeNumber)],
      });

      // Group by season
      const seasons: Record<number, typeof episodesList> = {};
      for (const ep of episodesList) {
        if (!seasons[ep.seasonNumber]) {
          seasons[ep.seasonNumber] = [];
        }
        seasons[ep.seasonNumber].push(ep);
      }

      // Get watch progress for all episodes
      const episodeFileIds = episodesList.map((e) => e.fileId);
      const progress =
        episodeFileIds.length > 0
          ? await db.query.watchProgress.findMany({
              where: and(
                eq(watchProgress.userId, request.user!.id),
                sql`${watchProgress.fileId} IN (${sql.join(
                  episodeFileIds.map((id) => sql`${id}`),
                  sql`, `
                )})`
              ),
            })
          : [];

      const progressMap = new Map(progress.map((p) => [p.fileId, p]));

      return {
        success: true,
        data: {
          show,
          seasons: Object.entries(seasons)
            .map(([num, episodes]) => ({
              number: parseInt(num, 10),
              episodes: episodes.map((e) => ({
                ...e,
                progress: progressMap.get(e.fileId) || null,
              })),
            }))
            .sort((a, b) => a.number - b.number),
        },
      };
    }
  );

  // Create TV show
  app.post(
    '/tv',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createTvShowSchema.parse(request.body);

      const [show] = await db
        .insert(tvShows)
        .values({
          householdId: request.user!.householdId,
          ...input,
        })
        .returning();

      return { success: true, data: { show } };
    }
  );

  // Add episode to TV show
  app.post<{ Params: { id: string } }>(
    '/tv/:id/episodes',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileId, seasonNumber, episodeNumber, name } = z
        .object({
          fileId: z.string().uuid(),
          seasonNumber: z.number().int().min(0),
          episodeNumber: z.number().int().min(1),
          name: z.string().optional(),
        })
        .parse(request.body);

      const show = await db.query.tvShows.findFirst({
        where: and(
          eq(tvShows.id, request.params.id),
          eq(tvShows.householdId, request.user!.householdId)
        ),
      });

      if (!show) throw Errors.notFound('TV Show');

      // Verify file exists
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, fileId),
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'video')
        ),
      });

      if (!file) throw Errors.notFound('Video file');

      const [episode] = await db
        .insert(tvEpisodes)
        .values({
          showId: show.id,
          fileId,
          seasonNumber,
          episodeNumber,
          name,
        })
        .returning();

      // Update show episode count
      const episodeCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(tvEpisodes)
        .where(eq(tvEpisodes.showId, show.id));

      await db
        .update(tvShows)
        .set({
          numberOfEpisodes: episodeCount[0].count,
          updatedAt: new Date(),
        })
        .where(eq(tvShows.id, show.id));

      return { success: true, data: { episode } };
    }
  );

  // Delete TV show
  app.delete<{ Params: { id: string } }>(
    '/tv/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db.delete(tvShows).where(
        and(
          eq(tvShows.id, request.params.id),
          eq(tvShows.householdId, request.user!.householdId)
        )
      );

      return { success: true, data: { message: 'TV show deleted' } };
    }
  );

  // ===== STREAMING =====

  // Update watch progress
  app.put<{ Params: { fileId: string } }>(
    '/progress/:fileId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { positionSeconds, durationSeconds, completed } = z
        .object({
          positionSeconds: z.number().int().min(0),
          durationSeconds: z.number().int().min(0).optional(),
          completed: z.boolean().optional(),
        })
        .parse(request.body);

      // Verify file exists
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.fileId),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Auto-complete if near end (within 5%)
      const autoComplete =
        durationSeconds && positionSeconds > durationSeconds * 0.95;

      const existing = await db.query.watchProgress.findFirst({
        where: and(
          eq(watchProgress.userId, request.user!.id),
          eq(watchProgress.fileId, request.params.fileId)
        ),
      });

      if (existing) {
        await db
          .update(watchProgress)
          .set({
            positionSeconds,
            durationSeconds: durationSeconds || existing.durationSeconds,
            completed: completed ?? autoComplete ?? existing.completed,
            completedAt:
              (completed ?? autoComplete) && !existing.completed ? new Date() : existing.completedAt,
            lastWatchedAt: new Date(),
          })
          .where(eq(watchProgress.id, existing.id));
      } else {
        await db.insert(watchProgress).values({
          userId: request.user!.id,
          fileId: request.params.fileId,
          positionSeconds,
          durationSeconds,
          completed: completed ?? autoComplete ?? false,
          completedAt: (completed ?? autoComplete) ? new Date() : undefined,
        });
      }

      return { success: true, data: { message: 'Progress updated' } };
    }
  );

  // Get watch progress
  app.get<{ Params: { fileId: string } }>(
    '/progress/:fileId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const progress = await db.query.watchProgress.findFirst({
        where: and(
          eq(watchProgress.userId, request.user!.id),
          eq(watchProgress.fileId, request.params.fileId)
        ),
      });

      return { success: true, data: { progress } };
    }
  );

  // Get available genres
  app.get(
    '/genres',
    { preHandler: [authMiddleware] },
    async (request) => {
      const movieList = await db.query.movies.findMany({
        where: eq(movies.householdId, request.user!.householdId),
        columns: { genres: true },
      });

      const showList = await db.query.tvShows.findMany({
        where: eq(tvShows.householdId, request.user!.householdId),
        columns: { genres: true },
      });

      const genreSet = new Set<string>();
      for (const m of movieList) {
        m.genres?.forEach((g) => genreSet.add(g));
      }
      for (const s of showList) {
        s.genres?.forEach((g) => genreSet.add(g));
      }

      return { success: true, data: { genres: Array.from(genreSet).sort() } };
    }
  );
}
