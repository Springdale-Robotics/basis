import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { files } from '../../db/schema/index.js';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { permissionService, type PermissionContext } from '../../services/permission.service.js';

/**
 * Filter videos to only those the user can access (respects folder restrictions).
 */
async function filterAccessibleVideos<T extends { id: string }>(
  context: PermissionContext,
  videos: T[]
): Promise<T[]> {
  if (videos.length === 0) return [];

  // Admins can see everything
  if (context.userRole === 'admin') return videos;

  // Check access for all videos
  const checks = videos.map((video) => ({
    resourceType: 'file' as const,
    resourceId: video.id,
    level: 'view' as const,
  }));

  const accessResults = await permissionService.batchCanAccess(context, checks);

  return videos.filter((video) => accessResults.get(video.id) === true);
}

export async function videosRoutes(app: FastifyInstance): Promise<void> {
  // List all videos with pagination and sorting
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const {
        limit = 100,
        offset = 0,
        sort = 'date',
        order = 'desc',
      } = z
        .object({
          limit: z.coerce.number().min(1).max(500).default(100),
          offset: z.coerce.number().min(0).default(0),
          sort: z.enum(['date', 'name', 'size']).default('date'),
          order: z.enum(['asc', 'desc']).default('desc'),
        })
        .parse(request.query);

      // Determine sort column
      let orderBy;
      switch (sort) {
        case 'name':
          orderBy = order === 'asc' ? asc(files.filename) : desc(files.filename);
          break;
        case 'size':
          orderBy = order === 'asc' ? asc(files.sizeBytes) : desc(files.sizeBytes);
          break;
        case 'date':
        default:
          orderBy = order === 'asc' ? asc(files.createdAt) : desc(files.createdAt);
          break;
      }

      // Get all videos for this household (excluding files marked as excluded from categories)
      const allVideoFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'video'),
          eq(files.excludedFromCategories, false)
        ),
        orderBy: [orderBy],
      });

      // Filter out videos in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const accessibleVideos = await filterAccessibleVideos(context, allVideoFiles);

      // Apply pagination after filtering
      const paginatedVideos = accessibleVideos.slice(offset, offset + limit + 1);
      const hasMore = paginatedVideos.length > limit;
      const videos = hasMore ? paginatedVideos.slice(0, limit) : paginatedVideos;

      const total = accessibleVideos.length;

      return {
        success: true,
        data: {
          videos,
          hasMore,
          total,
        },
      };
    }
  );

  // Get videos grouped by date (timeline view)
  app.get(
    '/timeline',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { year, month } = z
        .object({
          year: z.coerce.number().optional(),
          month: z.coerce.number().min(1).max(12).optional(),
        })
        .parse(request.query);

      const allVideoFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'video'),
          eq(files.excludedFromCategories, false)
        ),
        orderBy: [desc(files.createdAt)],
      });

      // Filter out videos in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const videoFiles = await filterAccessibleVideos(context, allVideoFiles);

      // Group by date
      const groups: Record<string, typeof videoFiles> = {};

      for (const video of videoFiles) {
        const date = video.createdAt;
        const dateKey = new Date(date).toISOString().split('T')[0];

        // Filter by year/month if specified
        const dateObj = new Date(date);
        if (year && dateObj.getFullYear() !== year) continue;
        if (month && dateObj.getMonth() + 1 !== month) continue;

        if (!groups[dateKey]) {
          groups[dateKey] = [];
        }
        groups[dateKey].push(video);
      }

      // Convert to sorted array
      const timeline = Object.entries(groups)
        .map(([date, videos]) => ({
          date,
          count: videos.length,
          videos: videos.slice(0, 50), // Limit videos per group for performance
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      return { success: true, data: { timeline } };
    }
  );
}
