import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import {
  files,
  photoMetadata,
  albums,
  albumFiles,
  smartAlbums,
  favorites,
} from '../../db/schema/index.js';
import { eq, and, desc, asc, sql, gte, lte, isNotNull } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { exifService } from '../../services/exif.service.js';
import type { SmartAlbumCriteria } from '../../db/schema/media.js';
import { permissionService, type PermissionContext } from '../../services/permission.service.js';

const createSmartAlbumSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  criteria: z.object({
    dateRange: z
      .object({
        start: z.string(),
        end: z.string(),
      })
      .optional(),
    location: z
      .object({
        lat: z.number(),
        lng: z.number(),
        radiusKm: z.number(),
      })
      .optional(),
    locationName: z.string().optional(),
    cameraMake: z.string().optional(),
    cameraModel: z.string().optional(),
    tags: z.array(z.string()).optional(),
    minRating: z.number().min(1).max(5).optional(),
    isFavorite: z.boolean().optional(),
  }),
});

/**
 * Filter photos to only those the user can access (respects folder restrictions).
 */
async function filterAccessiblePhotos<T extends { id: string }>(
  context: PermissionContext,
  photos: T[]
): Promise<T[]> {
  if (photos.length === 0) return [];

  // Admins can see everything
  if (context.userRole === 'admin') return photos;

  // Check access for all photos
  const checks = photos.map((photo) => ({
    resourceType: 'file' as const,
    resourceId: photo.id,
    level: 'view' as const,
  }));

  const accessResults = await permissionService.batchCanAccess(context, checks);

  return photos.filter((photo) => accessResults.get(photo.id) === true);
}

export async function photosRoutes(app: FastifyInstance): Promise<void> {
  // List photos with filters
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const {
        startDate,
        endDate,
        cameraMake,
        cameraModel,
        hasLocation,
        limit = 100,
        offset = 0,
      } = z
        .object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          cameraMake: z.string().optional(),
          cameraModel: z.string().optional(),
          hasLocation: z.coerce.boolean().optional(),
          limit: z.coerce.number().min(1).max(500).default(100),
          offset: z.coerce.number().min(0).default(0),
        })
        .parse(request.query);

      // Get all photos for this household (excluding files marked as excluded from categories)
      const allPhotoFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'photo'),
          eq(files.excludedFromCategories, false)
        ),
        orderBy: [desc(files.createdAt)],
      });

      // Filter out photos in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const accessiblePhotos = await filterAccessiblePhotos(context, allPhotoFiles);

      // Apply pagination after filtering
      const paginatedPhotos = accessiblePhotos.slice(offset, offset + limit + 1);
      const hasMore = paginatedPhotos.length > limit;
      const photos = hasMore ? paginatedPhotos.slice(0, limit) : paginatedPhotos;

      // Get metadata for these photos
      const photoIds = photos.map((p) => p.id);
      const metadataList = photoIds.length > 0
        ? await db.query.photoMetadata.findMany({
            where: sql`${photoMetadata.fileId} IN (${sql.join(
              photoIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
          })
        : [];

      const metadataMap = new Map(metadataList.map((m) => [m.fileId, m]));

      // Apply filters and combine data
      let result = photos.map((photo) => ({
        ...photo,
        metadata: metadataMap.get(photo.id) || null,
      }));

      // Filter by camera make/model if specified
      if (cameraMake || cameraModel || hasLocation !== undefined) {
        result = result.filter((item) => {
          if (cameraMake && item.metadata?.cameraMake !== cameraMake) return false;
          if (cameraModel && item.metadata?.cameraModel !== cameraModel) return false;
          if (hasLocation !== undefined) {
            const hasCoords = item.metadata?.latitude != null && item.metadata?.longitude != null;
            if (hasLocation !== hasCoords) return false;
          }
          return true;
        });
      }

      // Filter by date range
      if (startDate || endDate) {
        result = result.filter((item) => {
          const dateTaken = item.metadata?.dateTaken || item.createdAt;
          if (startDate && new Date(dateTaken) < new Date(startDate)) return false;
          if (endDate && new Date(dateTaken) > new Date(endDate)) return false;
          return true;
        });
      }

      return {
        success: true,
        data: {
          photos: result,
          hasMore,
          total: result.length,
        },
      };
    }
  );

  // Get photos grouped by date (timeline view)
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

      const allPhotoFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'photo'),
          eq(files.excludedFromCategories, false)
        ),
        orderBy: [desc(files.createdAt)],
      });

      // Filter out photos in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const photoFiles = await filterAccessiblePhotos(context, allPhotoFiles);

      // Get all metadata
      const photoIds = photoFiles.map((p) => p.id);
      const metadataList = photoIds.length > 0
        ? await db.query.photoMetadata.findMany({
            where: sql`${photoMetadata.fileId} IN (${sql.join(
              photoIds.map((id) => sql`${id}`),
              sql`, `
            )})`,
          })
        : [];

      const metadataMap = new Map(metadataList.map((m) => [m.fileId, m]));

      // Group by date
      const groups: Record<string, typeof photoFiles> = {};

      for (const photo of photoFiles) {
        const metadata = metadataMap.get(photo.id);
        const date = metadata?.dateTaken || photo.createdAt;
        const dateKey = new Date(date).toISOString().split('T')[0];

        // Filter by year/month if specified
        const dateObj = new Date(date);
        if (year && dateObj.getFullYear() !== year) continue;
        if (month && dateObj.getMonth() + 1 !== month) continue;

        if (!groups[dateKey]) {
          groups[dateKey] = [];
        }
        groups[dateKey].push(photo);
      }

      // Convert to sorted array
      const timeline = Object.entries(groups)
        .map(([date, photos]) => ({
          date,
          count: photos.length,
          photos: photos.slice(0, 50), // Limit photos per group for performance
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      return { success: true, data: { timeline } };
    }
  );

  // Get photos grouped by location
  app.get(
    '/locations',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Get all photos with location data
      const allMetadata = await db.query.photoMetadata.findMany({
        where: and(
          isNotNull(photoMetadata.latitude),
          isNotNull(photoMetadata.longitude)
        ),
      });

      // Get the associated files for this household
      const fileIds = allMetadata.map((m) => m.fileId);
      if (fileIds.length === 0) {
        return { success: true, data: { locations: [] } };
      }

      const allPhotoFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'photo'),
          eq(files.excludedFromCategories, false),
          sql`${files.id} IN (${sql.join(
            fileIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        ),
      });

      // Filter out photos in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const photoFiles = await filterAccessiblePhotos(context, allPhotoFiles);

      const validFileIds = new Set(photoFiles.map((f) => f.id));
      const validMetadata = allMetadata.filter((m) => validFileIds.has(m.fileId));

      // Cluster locations (simple grid-based clustering)
      const clusters: Map<string, { lat: number; lng: number; count: number; photos: string[] }> = new Map();

      for (const meta of validMetadata) {
        if (meta.latitude == null || meta.longitude == null) continue;

        // Round to 2 decimal places for clustering (~1km resolution)
        const clusterKey = `${meta.latitude.toFixed(2)},${meta.longitude.toFixed(2)}`;

        if (!clusters.has(clusterKey)) {
          clusters.set(clusterKey, {
            lat: meta.latitude,
            lng: meta.longitude,
            count: 0,
            photos: [],
          });
        }

        const cluster = clusters.get(clusterKey)!;
        cluster.count++;
        if (cluster.photos.length < 10) {
          cluster.photos.push(meta.fileId);
        }
      }

      const locations = Array.from(clusters.values()).sort((a, b) => b.count - a.count);

      return { success: true, data: { locations } };
    }
  );

  // Get photo with full EXIF metadata
  app.get<{ Params: { id: string } }>(
    '/:id/metadata',
    { preHandler: [authMiddleware] },
    async (request) => {
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'photo')
        ),
      });

      if (!file) throw Errors.notFound('Photo');

      // Check if user can access this photo (respects folder restrictions)
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const canAccess = await permissionService.canAccess(context, 'file', file.id, 'view');
      if (!canAccess) throw Errors.notFound('Photo');

      const metadata = await exifService.getPhotoMetadata(request.params.id);

      return { success: true, data: { photo: file, metadata } };
    }
  );

  // ===== SMART ALBUMS =====

  // List smart albums
  app.get(
    '/smart-albums',
    { preHandler: [authMiddleware] },
    async (request) => {
      const albumList = await db.query.smartAlbums.findMany({
        where: eq(smartAlbums.householdId, request.user!.householdId),
        orderBy: [desc(smartAlbums.createdAt)],
      });

      return { success: true, data: { albums: albumList } };
    }
  );

  // Create smart album
  app.post(
    '/smart-albums',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createSmartAlbumSchema.parse(request.body);

      const [album] = await db
        .insert(smartAlbums)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          description: input.description,
          criteria: input.criteria as SmartAlbumCriteria,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { album } };
    }
  );

  // Get smart album with photos
  app.get<{ Params: { id: string } }>(
    '/smart-albums/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const album = await db.query.smartAlbums.findFirst({
        where: and(
          eq(smartAlbums.id, request.params.id),
          eq(smartAlbums.householdId, request.user!.householdId)
        ),
      });

      if (!album) throw Errors.notFound('Smart Album');

      // Get photos matching criteria
      const photos = await getPhotosMatchingCriteria(
        request.user!.householdId,
        request.user!.id,
        album.criteria as SmartAlbumCriteria,
        request.user!.role
      );

      return { success: true, data: { album, photos } };
    }
  );

  // Update smart album
  app.put<{ Params: { id: string } }>(
    '/smart-albums/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createSmartAlbumSchema.partial().parse(request.body);

      const existing = await db.query.smartAlbums.findFirst({
        where: and(
          eq(smartAlbums.id, request.params.id),
          eq(smartAlbums.householdId, request.user!.householdId)
        ),
      });

      if (!existing) throw Errors.notFound('Smart Album');

      const [album] = await db
        .update(smartAlbums)
        .set({
          name: input.name,
          description: input.description,
          criteria: input.criteria as SmartAlbumCriteria | undefined,
          updatedAt: new Date(),
        })
        .where(eq(smartAlbums.id, request.params.id))
        .returning();

      return { success: true, data: { album } };
    }
  );

  // Delete smart album
  app.delete<{ Params: { id: string } }>(
    '/smart-albums/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db.delete(smartAlbums).where(eq(smartAlbums.id, request.params.id));

      return { success: true, data: { message: 'Smart album deleted' } };
    }
  );

  // Get available camera makes/models for filters
  app.get(
    '/cameras',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Get all photo IDs for this household (excluding files marked as excluded)
      const allPhotoFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId),
          eq(files.type, 'photo'),
          eq(files.excludedFromCategories, false)
        ),
        columns: { id: true },
      });

      // Filter out photos in restricted folders that user can't access
      const context: PermissionContext = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
      };
      const photoFiles = await filterAccessiblePhotos(context, allPhotoFiles);

      const photoIds = photoFiles.map((p) => p.id);
      if (photoIds.length === 0) {
        return { success: true, data: { cameras: [] } };
      }

      // Get distinct camera makes/models
      const metadataList = await db.query.photoMetadata.findMany({
        where: sql`${photoMetadata.fileId} IN (${sql.join(
          photoIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        columns: { cameraMake: true, cameraModel: true },
      });

      const cameras = new Map<string, Set<string>>();

      for (const meta of metadataList) {
        if (meta.cameraMake) {
          if (!cameras.has(meta.cameraMake)) {
            cameras.set(meta.cameraMake, new Set());
          }
          if (meta.cameraModel) {
            cameras.get(meta.cameraMake)!.add(meta.cameraModel);
          }
        }
      }

      const result = Array.from(cameras.entries()).map(([make, models]) => ({
        make,
        models: Array.from(models),
      }));

      return { success: true, data: { cameras: result } };
    }
  );
}

async function getPhotosMatchingCriteria(
  householdId: string,
  userId: string,
  criteria: SmartAlbumCriteria,
  userRole: 'admin' | 'member' | 'kid' | 'visitor' = 'member'
): Promise<typeof files.$inferSelect[]> {
  // Get all photos for this household (excluding files marked as excluded)
  const allPhotoFiles = await db.query.files.findMany({
    where: and(
      eq(files.householdId, householdId),
      eq(files.type, 'photo'),
      eq(files.excludedFromCategories, false)
    ),
  });

  if (allPhotoFiles.length === 0) return [];

  // Filter out photos in restricted folders that user can't access
  const context: PermissionContext = {
    userId,
    householdId,
    userRole,
  };
  const photoFiles = await filterAccessiblePhotos(context, allPhotoFiles);

  // Get all metadata
  const photoIds = photoFiles.map((p) => p.id);
  const metadataList = await db.query.photoMetadata.findMany({
    where: sql`${photoMetadata.fileId} IN (${sql.join(
      photoIds.map((id) => sql`${id}`),
      sql`, `
    )})`,
  });

  const metadataMap = new Map(metadataList.map((m) => [m.fileId, m]));

  // Get favorites if needed
  let userFavorites: Set<string> = new Set();
  if (criteria.isFavorite) {
    const favs = await db.query.favorites.findMany({
      where: eq(favorites.userId, userId),
    });
    userFavorites = new Set(favs.map((f) => f.fileId));
  }

  // Filter photos
  return photoFiles.filter((photo) => {
    const meta = metadataMap.get(photo.id);

    // Date range filter
    if (criteria.dateRange) {
      const date = meta?.dateTaken || photo.createdAt;
      if (new Date(date) < new Date(criteria.dateRange.start)) return false;
      if (new Date(date) > new Date(criteria.dateRange.end)) return false;
    }

    // Location filter (within radius)
    if (criteria.location && meta?.latitude && meta?.longitude) {
      const distance = calculateDistance(
        criteria.location.lat,
        criteria.location.lng,
        meta.latitude,
        meta.longitude
      );
      if (distance > criteria.location.radiusKm) return false;
    }

    // Location name filter
    if (criteria.locationName && meta?.locationName !== criteria.locationName) {
      return false;
    }

    // Camera filters
    if (criteria.cameraMake && meta?.cameraMake !== criteria.cameraMake) {
      return false;
    }
    if (criteria.cameraModel && meta?.cameraModel !== criteria.cameraModel) {
      return false;
    }

    // Favorite filter
    if (criteria.isFavorite && !userFavorites.has(photo.id)) {
      return false;
    }

    return true;
  });
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Haversine formula
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
