import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, sql as sqlClient } from '../../config/database.js';
import {
  files,
  folders,
  albums,
  albumFiles,
  playlists,
  playlistItems,
  favorites,
  ratings,
  thumbnails,
  households,
} from '../../db/schema/index.js';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { requireFileAccess, requireAlbumAccess, requireFilesAccess } from '../../middleware/permission.middleware.js';
import { setResourceDefaults, getRestrictionInfo, setRestriction, canAccess } from '../../services/permission.service.js';
import { Errors, ErrorCode, AppError } from '../../lib/errors.js';
import { config } from '../../config/index.js';
import { fileTypeSchema } from '../../lib/validators.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { queueMediaProcessing } from '../../jobs/index.js';
import { thumbnailService } from '../../services/thumbnail.service.js';
import { mediaScannerService } from '../../services/media-scanner.service.js';

// Helper to get effective storage limit for a household
async function getEffectiveStorageLimit(householdId: string): Promise<{
  limitBytes: number;
  source: 'household' | 'system' | 'disk';
  householdLimitGb: number | null;
  systemLimitGb: number | null;
}> {
  // Get household settings
  const household = await db.query.households.findFirst({
    where: eq(households.id, householdId),
    columns: { settings: true },
  });

  const settings = household?.settings as any;
  const householdLimitGb = settings?.storage?.limitGb ?? null;
  const systemLimitGb = config.STORAGE_QUOTA_GB ?? null;

  // Priority: household setting → system env var → disk capacity
  if (householdLimitGb !== null) {
    return {
      limitBytes: householdLimitGb * 1024 * 1024 * 1024,
      source: 'household',
      householdLimitGb,
      systemLimitGb,
    };
  }

  if (systemLimitGb !== null) {
    return {
      limitBytes: systemLimitGb * 1024 * 1024 * 1024,
      source: 'system',
      householdLimitGb,
      systemLimitGb,
    };
  }

  // Fallback to disk capacity
  try {
    const fsModule = await import('node:fs/promises');
    const stats = await fsModule.statfs(config.STORAGE_PATH);
    const availableBytes = stats.bavail * stats.bsize;
    // Get current usage to add to available
    const fileList = await db.query.files.findMany({
      where: eq(files.householdId, householdId),
      columns: { sizeBytes: true },
    });
    const currentUsage = fileList.reduce((sum, f) => sum + f.sizeBytes, 0);

    return {
      limitBytes: availableBytes + currentUsage,
      source: 'disk',
      householdLimitGb,
      systemLimitGb,
    };
  } catch {
    // If we can't get disk stats, return 0 (unlimited)
    return {
      limitBytes: 0,
      source: 'disk',
      householdLimitGb,
      systemLimitGb,
    };
  }
}

// Check if an upload would exceed the storage quota
async function checkStorageQuota(
  householdId: string,
  uploadSizeBytes: number
): Promise<{ allowed: boolean; currentUsage: number; limit: number; source: string }> {
  const { limitBytes, source } = await getEffectiveStorageLimit(householdId);

  // If no limit, allow the upload
  if (limitBytes === 0) {
    return { allowed: true, currentUsage: 0, limit: 0, source };
  }

  // Get current usage
  const fileList = await db.query.files.findMany({
    where: eq(files.householdId, householdId),
    columns: { sizeBytes: true },
  });
  const currentUsage = fileList.reduce((sum, f) => sum + f.sizeBytes, 0);

  const allowed = currentUsage + uploadSizeBytes <= limitBytes;
  return { allowed, currentUsage, limit: limitBytes, source };
}

// ===== RECURSIVE QUERY HELPERS =====

// Get all descendant folder IDs (including the selected folders)
async function getDescendantFolderIds(householdId: string, folderIds: string[]): Promise<string[]> {
  if (folderIds.length === 0) return [];

  // Use raw postgres client for recursive CTE
  const result = await sqlClient`
    WITH RECURSIVE folder_tree AS (
      SELECT id FROM folders
      WHERE id = ANY(${folderIds}::uuid[])
        AND household_id = ${householdId}
      UNION ALL
      SELECT f.id FROM folders f
      INNER JOIN folder_tree ft ON f.parent_id = ft.id
      WHERE f.household_id = ${householdId}
    )
    SELECT id FROM folder_tree
  `;

  return result.map((row: { id: string }) => row.id);
}

// Get all files inside a folder tree
async function getFilesInFolders(householdId: string, folderIds: string[]): Promise<typeof files.$inferSelect[]> {
  if (folderIds.length === 0) return [];

  // First get all descendant folder IDs
  const allFolderIds = await getDescendantFolderIds(householdId, folderIds);
  if (allFolderIds.length === 0) return [];

  // Then get all files in those folders
  const fileList = await db.query.files.findMany({
    where: and(
      eq(files.householdId, householdId),
      sql`${files.folderId} IN (${sql.join(allFolderIds.map(id => sql`${id}`), sql`, `)})`
    ),
  });

  return fileList;
}

// Check if target folder is a descendant of any selected folders (for move validation)
async function isDescendantOf(householdId: string, targetFolderId: string, potentialAncestorIds: string[]): Promise<boolean> {
  if (potentialAncestorIds.length === 0) return false;

  // Use raw postgres client for recursive CTE
  const result = await sqlClient`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, parent_id FROM folders
      WHERE id = ${targetFolderId}::uuid AND household_id = ${householdId}
      UNION ALL
      SELECT f.id, f.parent_id FROM folders f
      INNER JOIN ancestor_chain ac ON f.id = ac.parent_id
      WHERE f.household_id = ${householdId}
    )
    SELECT EXISTS (
      SELECT 1 FROM ancestor_chain
      WHERE id = ANY(${potentialAncestorIds}::uuid[])
    ) as is_descendant
  `;

  return result[0]?.is_descendant ?? false;
}

const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().uuid().optional(),
  type: z.enum(['general', 'photos', 'videos', 'music', 'documents']).default('general'),
});

const createAlbumSchema = z.object({
  name: z.string().min(1).max(255),
  coverFileId: z.string().uuid().optional(),
});

const createPlaylistSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['music', 'video']),
});

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  // ===== FILES =====

  // List files
  app.get(
    '/',
    { preHandler: [authMiddleware, requireFilesAccess('view')] },
    async (request) => {
      const { type, folderId, parentId } = request.query as any;
      // Support both folderId and parentId for backwards compatibility
      const targetFolderId = folderId || parentId;

      const user = request.user!;
      const isAdmin = user.role === 'admin';

      // If navigating into a specific folder, check access first
      if (targetFolderId && !isAdmin) {
        const targetFolder = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, targetFolderId),
            eq(folders.householdId, user.householdId)
          ),
        });

        if (targetFolder) {
          const restrictionInfo = await getRestrictionInfo('folder', targetFolder.id);
          if (restrictionInfo.isRestricted) {
            const context = {
              userId: user.id,
              householdId: user.householdId,
              userRole: user.role,
            };
            const hasAccess = await canAccess(context, 'file', targetFolder.id, 'view');
            if (!hasAccess) {
              throw Errors.forbidden('You do not have access to this folder');
            }
          }
        }
      }

      // Get files
      const fileList = await db.query.files.findMany({
        where: eq(files.householdId, user.householdId),
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      });

      // Get folders and transform to match file structure
      const folderList = await db.query.folders.findMany({
        where: eq(folders.householdId, user.householdId),
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      });

      // Transform folders to match FileItem interface
      const foldersAsFiles = folderList.map((folder) => ({
        id: folder.id,
        householdId: folder.householdId,
        uploadedBy: folder.createdBy,
        folderId: folder.parentId,
        filename: folder.name,
        storagePath: '',
        mimeType: null,
        sizeBytes: 0,
        type: 'folder' as const,
        metadata: null,
        excludedFromCategories: false,
        isRestricted: folder.isRestricted,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      }));

      // Combine files and folders, adding isRestricted field for files
      let combined: Array<typeof foldersAsFiles[0] | (typeof fileList[0] & { isRestricted: boolean })> = [
        ...foldersAsFiles,
        ...fileList.map(f => ({ ...f, isRestricted: f.isRestricted })),
      ];

      // Filter by type if specified
      if (type) {
        combined = combined.filter((f) => f.type === type);
      }

      // Filter by folder
      if (targetFolderId) {
        combined = combined.filter((f) => f.folderId === targetFolderId);
      } else {
        // When no folder specified, only show items at root level (no parent folder)
        combined = combined.filter((f) => !f.folderId);
      }

      // Filter out restricted items for non-admins
      // Admins see everything but regular users only see:
      // - Unrestricted items
      // - Items they have explicit permission for
      if (!isAdmin) {
        const context = {
          userId: user.id,
          householdId: user.householdId,
          userRole: user.role,
        };

        // For each restricted item, check if user has explicit access
        const filteredCombined = [];
        for (const item of combined) {
          if (!item.isRestricted) {
            filteredCombined.push(item);
            continue;
          }

          // Check folder inheritance for restricted items
          const resourceType = item.type === 'folder' ? 'folder' : 'file';
          const restrictionInfo = await getRestrictionInfo(resourceType as 'file' | 'folder', item.id);

          if (!restrictionInfo.isRestricted) {
            filteredCombined.push(item);
            continue;
          }

          // Check if user has explicit permission on this resource
          const hasAccess = await canAccess(context, 'file', item.id, 'view');
          if (hasAccess) {
            filteredCombined.push(item);
          }
        }
        combined = filteredCombined;
      }

      // Sort: folders first, then by creation date
      combined.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return { success: true, data: { files: combined } };
    }
  );

  // Upload file
  app.post(
    '/upload',
    { preHandler: [authMiddleware, requireFilesAccess('edit')] },
    async (request, reply) => {
      const data = await request.file();

      if (!data) {
        throw Errors.validation('No file uploaded');
      }

      const { folderId, type } = z
        .object({
          folderId: z.string().uuid().optional(),
          type: fileTypeSchema.optional(),
        })
        .parse(request.query);

      // Buffer the file to get its size
      const buffer = await data.toBuffer();

      // Check storage quota before processing
      const quotaCheck = await checkStorageQuota(request.user!.householdId, buffer.length);
      if (!quotaCheck.allowed) {
        throw new AppError(
          ErrorCode.RESOURCE_LIMIT_EXCEEDED,
          'Storage quota exceeded. Delete files or increase your storage limit.',
          {
            currentUsage: quotaCheck.currentUsage,
            limit: quotaCheck.limit,
            uploadSize: buffer.length,
            limitSource: quotaCheck.source,
          }
        );
      }

      // Determine file type from MIME type if not specified
      let fileType = type;
      if (!fileType) {
        if (data.mimetype.startsWith('image/')) {
          fileType = 'photo';
        } else if (data.mimetype.startsWith('video/')) {
          fileType = 'video';
        } else if (data.mimetype.startsWith('audio/')) {
          fileType = 'music';
        } else {
          fileType = 'document';
        }
      }

      // Generate storage path
      const fileId = randomUUID();
      const ext = path.extname(data.filename);
      const storagePath = path.join(
        config.STORAGE_PATH,
        fileType + 's',
        request.user!.householdId,
        `${fileId}${ext}`
      );

      // Ensure directory exists
      await fs.mkdir(path.dirname(storagePath), { recursive: true });

      // Save file
      await fs.writeFile(storagePath, buffer);

      // Create database record
      const [file] = await db
        .insert(files)
        .values({
          id: fileId,
          householdId: request.user!.householdId,
          uploadedBy: request.user!.id,
          folderId,
          filename: data.filename,
          storagePath,
          mimeType: data.mimetype,
          sizeBytes: buffer.length,
          type: fileType,
        })
        .returning();

      // Queue media processing (thumbnails, EXIF, etc.)
      await queueMediaProcessing(fileId, request.user!.householdId, storagePath, data.mimetype);

      // Set default permissions for the new file
      await setResourceDefaults('file', file.id, request.user!.id, request.user!.householdId);

      return { success: true, data: { file } };
    }
  );

  // Get file metadata
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireFileAccess('view')] },
    async (request) => {
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      return { success: true, data: { file } };
    }
  );

  // Download file
  app.get<{ Params: { id: string } }>(
    '/:id/download',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const user = request.user!;
      const isAdmin = user.role === 'admin';

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, user.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Check access for non-admins on restricted files
      if (!isAdmin) {
        const restrictionInfo = await getRestrictionInfo('file', file.id);
        if (restrictionInfo.isRestricted) {
          const context = {
            userId: user.id,
            householdId: user.householdId,
            userRole: user.role,
          };
          const hasAccess = await canAccess(context, 'file', file.id, 'view');
          if (!hasAccess) {
            throw Errors.forbidden('You do not have access to this file');
          }
        }
      }

      const fileBuffer = await fs.readFile(file.storagePath);

      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .send(fileBuffer);
    }
  );

  // Delete file
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireFileAccess('admin')] },
    async (request) => {
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Delete from storage
      try {
        await fs.unlink(file.storagePath);
      } catch {
        // Ignore if file doesn't exist
      }

      // Delete from database
      await db.delete(files).where(eq(files.id, request.params.id));

      return { success: true, data: { message: 'File deleted' } };
    }
  );

  // ===== RESTRICTION ENDPOINTS =====

  // Set restriction on a file
  app.put<{ Params: { id: string } }>(
    '/:id/restrict',
    { preHandler: [authMiddleware, requireFileAccess('admin')] },
    async (request) => {
      const { restricted } = z
        .object({ restricted: z.boolean() })
        .parse(request.body);

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      await setRestriction('file', request.params.id, restricted);

      return {
        success: true,
        data: {
          message: restricted ? 'File restricted' : 'Restriction removed',
          isRestricted: restricted,
        },
      };
    }
  );

  // Get restriction status for a file
  app.get<{ Params: { id: string } }>(
    '/:id/restriction',
    { preHandler: [authMiddleware] },
    async (request) => {
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      const restrictionInfo = await getRestrictionInfo('file', request.params.id);

      return { success: true, data: restrictionInfo };
    }
  );

  // Set restriction on a folder
  app.put<{ Params: { id: string } }>(
    '/folders/:id/restrict',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { restricted } = z
        .object({ restricted: z.boolean() })
        .parse(request.body);

      const folder = await db.query.folders.findFirst({
        where: and(
          eq(folders.id, request.params.id),
          eq(folders.householdId, request.user!.householdId)
        ),
      });

      if (!folder) throw Errors.notFound('Folder');

      // Only admins or the folder creator can restrict
      const isAdmin = request.user!.role === 'admin';
      const isCreator = folder.createdBy === request.user!.id;
      if (!isAdmin && !isCreator) {
        throw Errors.forbidden('Only admins or the folder creator can restrict access');
      }

      await setRestriction('folder', request.params.id, restricted);

      // Get count of affected items
      const descendantFolderIds = await getDescendantFolderIds(request.user!.householdId, [request.params.id]);
      const affectedFiles = descendantFolderIds.length > 0
        ? await db.query.files.findMany({
            where: and(
              eq(files.householdId, request.user!.householdId),
              sql`${files.folderId} IN (${sql.join(descendantFolderIds.map(id => sql`${id}`), sql`, `)})`
            ),
            columns: { id: true },
          })
        : [];

      return {
        success: true,
        data: {
          message: restricted ? 'Folder restricted' : 'Restriction removed',
          isRestricted: restricted,
          affectedFolders: descendantFolderIds.length,
          affectedFiles: affectedFiles.length,
        },
      };
    }
  );

  // Get restriction status for a folder
  app.get<{ Params: { id: string } }>(
    '/folders/:id/restriction',
    { preHandler: [authMiddleware] },
    async (request) => {
      const folder = await db.query.folders.findFirst({
        where: and(
          eq(folders.id, request.params.id),
          eq(folders.householdId, request.user!.householdId)
        ),
      });

      if (!folder) throw Errors.notFound('Folder');

      const restrictionInfo = await getRestrictionInfo('folder', request.params.id);

      return { success: true, data: restrictionInfo };
    }
  );

  // Move file to a different folder
  app.put<{ Params: { id: string } }>(
    '/:id/move',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { targetFolderId } = z
        .object({
          targetFolderId: z.string().uuid().nullable(),
        })
        .parse(request.body);

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // If targetFolderId is provided, verify it exists and belongs to the household
      if (targetFolderId) {
        const targetFolder = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, targetFolderId),
            eq(folders.householdId, request.user!.householdId)
          ),
        });

        if (!targetFolder) throw Errors.notFound('Target folder');
      }

      await db
        .update(files)
        .set({ folderId: targetFolderId, updatedAt: new Date() })
        .where(eq(files.id, request.params.id));

      return { success: true, data: { message: 'File moved' } };
    }
  );

  // ===== BULK OPERATIONS =====

  // Bulk exclude/include from categories
  app.put(
    '/bulk/exclude',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileIds, folderIds, excluded } = z
        .object({
          fileIds: z.array(z.string().uuid()).default([]),
          folderIds: z.array(z.string().uuid()).default([]),
          excluded: z.boolean(),
        })
        .parse(request.body);

      if (fileIds.length === 0 && folderIds.length === 0) {
        throw Errors.validation('At least one file or folder ID is required');
      }

      const householdId = request.user!.householdId;

      // Get files directly selected
      let allFileIds = [...fileIds];

      // Get files inside selected folders (recursively)
      if (folderIds.length > 0) {
        const filesInFolders = await getFilesInFolders(householdId, folderIds);
        allFileIds = [...new Set([...allFileIds, ...filesInFolders.map(f => f.id)])];
      }

      if (allFileIds.length === 0) {
        return {
          success: true,
          data: { message: 'No files to update', affectedCount: 0 },
        };
      }

      // Verify all direct fileIds belong to the household
      if (fileIds.length > 0) {
        const fileList = await db.query.files.findMany({
          where: and(
            eq(files.householdId, householdId),
            sql`${files.id} IN (${sql.join(
              fileIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          ),
        });

        if (fileList.length !== fileIds.length) {
          throw Errors.notFound('One or more files not found');
        }
      }

      await db
        .update(files)
        .set({ excludedFromCategories: excluded, updatedAt: new Date() })
        .where(
          and(
            eq(files.householdId, householdId),
            sql`${files.id} IN (${sql.join(
              allFileIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        );

      return {
        success: true,
        data: {
          message: `${allFileIds.length} files ${excluded ? 'excluded from' : 'included in'} categories`,
          affectedCount: allFileIds.length,
        },
      };
    }
  );

  // Bulk delete files and/or folders
  app.delete(
    '/bulk',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileIds, folderIds } = z
        .object({
          fileIds: z.array(z.string().uuid()).default([]),
          folderIds: z.array(z.string().uuid()).default([]),
        })
        .parse(request.body);

      if (fileIds.length === 0 && folderIds.length === 0) {
        throw Errors.validation('At least one file or folder ID is required');
      }

      const householdId = request.user!.householdId;
      let deletedFilesCount = 0;
      let deletedFoldersCount = 0;

      // Get all files to delete (direct + inside folders)
      let allFilesToDelete: typeof files.$inferSelect[] = [];

      // Get files inside selected folders (recursively)
      if (folderIds.length > 0) {
        const filesInFolders = await getFilesInFolders(householdId, folderIds);
        allFilesToDelete = [...filesInFolders];
      }

      // Get directly selected files
      if (fileIds.length > 0) {
        const directFiles = await db.query.files.findMany({
          where: and(
            eq(files.householdId, householdId),
            sql`${files.id} IN (${sql.join(
              fileIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          ),
        });
        // Merge, avoiding duplicates
        const existingIds = new Set(allFilesToDelete.map(f => f.id));
        for (const file of directFiles) {
          if (!existingIds.has(file.id)) {
            allFilesToDelete.push(file);
          }
        }
      }

      // Delete files from storage
      for (const file of allFilesToDelete) {
        try {
          await fs.unlink(file.storagePath);
          deletedFilesCount++;
        } catch {
          // Ignore if file doesn't exist, but still count it
          deletedFilesCount++;
        }
      }

      // Delete files from database
      if (allFilesToDelete.length > 0) {
        await db
          .delete(files)
          .where(
            and(
              eq(files.householdId, householdId),
              sql`${files.id} IN (${sql.join(
                allFilesToDelete.map((f) => sql`${f.id}`),
                sql`, `
              )})`
            )
          );
      }

      // Delete folders (DB cascade handles subfolders)
      if (folderIds.length > 0) {
        // Verify folders belong to household
        const folderList = await db.query.folders.findMany({
          where: and(
            eq(folders.householdId, householdId),
            sql`${folders.id} IN (${sql.join(
              folderIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          ),
        });

        if (folderList.length > 0) {
          // Get count of all folders that will be deleted (including descendants)
          const allFolderIds = await getDescendantFolderIds(householdId, folderIds);
          deletedFoldersCount = allFolderIds.length;

          // Delete the top-level selected folders (cascade handles subfolders)
          await db
            .delete(folders)
            .where(
              and(
                eq(folders.householdId, householdId),
                sql`${folders.id} IN (${sql.join(
                  folderIds.map((id) => sql`${id}`),
                  sql`, `
                )})`
              )
            );
        }
      }

      return {
        success: true,
        data: {
          message: `Deleted ${deletedFilesCount} files and ${deletedFoldersCount} folders`,
          deletedFiles: deletedFilesCount,
          deletedFolders: deletedFoldersCount,
        },
      };
    }
  );

  // Bulk move files and/or folders
  app.put(
    '/bulk/move',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileIds, folderIds, targetFolderId } = z
        .object({
          fileIds: z.array(z.string().uuid()).default([]),
          folderIds: z.array(z.string().uuid()).default([]),
          targetFolderId: z.string().uuid().nullable(),
        })
        .parse(request.body);

      if (fileIds.length === 0 && folderIds.length === 0) {
        throw Errors.validation('At least one file or folder ID is required');
      }

      const householdId = request.user!.householdId;

      // Verify target folder exists if specified
      if (targetFolderId) {
        const targetFolder = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, targetFolderId),
            eq(folders.householdId, householdId)
          ),
        });

        if (!targetFolder) throw Errors.notFound('Target folder');

        // CRITICAL: Check that target is not a descendant of any selected folder
        if (folderIds.length > 0) {
          const isDescendant = await isDescendantOf(householdId, targetFolderId, folderIds);
          if (isDescendant) {
            throw Errors.validation('Cannot move a folder into itself or its subfolder');
          }

          // Also check if target is one of the selected folders
          if (folderIds.includes(targetFolderId)) {
            throw Errors.validation('Cannot move a folder into itself');
          }
        }
      }

      let movedFilesCount = 0;
      let movedFoldersCount = 0;

      // Move files
      if (fileIds.length > 0) {
        // Verify all files belong to the household
        const fileList = await db.query.files.findMany({
          where: and(
            eq(files.householdId, householdId),
            sql`${files.id} IN (${sql.join(
              fileIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          ),
        });

        if (fileList.length !== fileIds.length) {
          throw Errors.notFound('One or more files not found');
        }

        await db
          .update(files)
          .set({ folderId: targetFolderId, updatedAt: new Date() })
          .where(
            and(
              eq(files.householdId, householdId),
              sql`${files.id} IN (${sql.join(
                fileIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
          );

        movedFilesCount = fileList.length;
      }

      // Move folders (contents move automatically with parent)
      if (folderIds.length > 0) {
        // Verify all folders belong to the household
        const folderList = await db.query.folders.findMany({
          where: and(
            eq(folders.householdId, householdId),
            sql`${folders.id} IN (${sql.join(
              folderIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          ),
        });

        if (folderList.length !== folderIds.length) {
          throw Errors.notFound('One or more folders not found');
        }

        await db
          .update(folders)
          .set({ parentId: targetFolderId, updatedAt: new Date() })
          .where(
            and(
              eq(folders.householdId, householdId),
              sql`${folders.id} IN (${sql.join(
                folderIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
          );

        movedFoldersCount = folderList.length;
      }

      return {
        success: true,
        data: {
          message: `Moved ${movedFilesCount} files and ${movedFoldersCount} folders`,
          movedFiles: movedFilesCount,
          movedFolders: movedFoldersCount,
        },
      };
    }
  );

  // ===== THUMBNAILS =====

  // Get thumbnail
  app.get<{ Params: { id: string; size: string } }>(
    '/:id/thumbnail/:size',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id, size } = request.params;
      const user = request.user!;
      const isAdmin = user.role === 'admin';

      if (!['sm', 'md', 'lg'].includes(size)) {
        throw Errors.validation('Invalid thumbnail size. Use sm, md, or lg.');
      }

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, id),
          eq(files.householdId, user.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Check access for non-admins on restricted files
      if (!isAdmin) {
        const restrictionInfo = await getRestrictionInfo('file', file.id);
        if (restrictionInfo.isRestricted) {
          const context = {
            userId: user.id,
            householdId: user.householdId,
            userRole: user.role,
          };
          const hasAccess = await canAccess(context, 'file', file.id, 'view');
          if (!hasAccess) {
            throw Errors.forbidden('You do not have access to this file');
          }
        }
      }

      const result = await thumbnailService.serveThumbnail(id, size as 'sm' | 'md' | 'lg');

      if (!result) {
        throw Errors.notFound('Thumbnail');
      }

      reply
        .header('Content-Type', result.mimeType)
        .header('Cache-Control', 'public, max-age=86400')
        .send(result.buffer);
    }
  );

  // Regenerate thumbnails for files missing them
  app.post(
    '/thumbnails/regenerate',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileIds } = z
        .object({
          fileIds: z.array(z.string().uuid()).optional(),
        })
        .parse(request.body);

      const householdId = request.user!.householdId;

      // Get files to regenerate thumbnails for
      let filesToProcess: typeof files.$inferSelect[];

      if (fileIds && fileIds.length > 0) {
        // Specific files requested
        filesToProcess = await db.query.files.findMany({
          where: and(
            eq(files.householdId, householdId),
            sql`${files.id} IN (${sql.join(fileIds.map((id) => sql`${id}`), sql`, `)})`
          ),
        });
      } else {
        // Find all files missing thumbnails (images and videos)
        const allFiles = await db.query.files.findMany({
          where: and(
            eq(files.householdId, householdId),
            sql`(${files.mimeType} LIKE 'image/%' OR ${files.mimeType} LIKE 'video/%')`
          ),
        });

        // Get files that have thumbnails
        const existingThumbnails = await db.query.thumbnails.findMany({
          columns: { fileId: true },
        });
        const filesWithThumbnails = new Set(existingThumbnails.map((t) => t.fileId));

        // Filter to only files missing thumbnails
        filesToProcess = allFiles.filter((f) => !filesWithThumbnails.has(f.id));
      }

      // Queue thumbnail jobs for each file
      let queued = 0;
      for (const file of filesToProcess) {
        await queueMediaProcessing(file.id, householdId, file.storagePath, file.mimeType);
        queued++;
      }

      return {
        success: true,
        data: {
          message: `Queued thumbnail regeneration for ${queued} files`,
          queuedCount: queued,
        },
      };
    }
  );

  // ===== FAVORITES =====

  // Get user's favorites
  app.get(
    '/favorites',
    { preHandler: [authMiddleware] },
    async (request) => {
      const userFavorites = await db.query.favorites.findMany({
        where: eq(favorites.userId, request.user!.id),
        orderBy: (f, { desc: d }) => [d(f.createdAt)],
      });

      const fileIds = userFavorites.map((f) => f.fileId);

      if (fileIds.length === 0) {
        return { success: true, data: { files: [] } };
      }

      const favoriteFiles = await db.query.files.findMany({
        where: and(
          eq(files.householdId, request.user!.householdId)
        ),
      });

      const filtered = favoriteFiles.filter((f) => fileIds.includes(f.id));

      return { success: true, data: { files: filtered } };
    }
  );

  // Add to favorites
  app.post<{ Params: { id: string } }>(
    '/:id/favorite',
    { preHandler: [authMiddleware] },
    async (request) => {
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Check if already favorited
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.userId, request.user!.id),
          eq(favorites.fileId, request.params.id)
        ),
      });

      if (existing) {
        return { success: true, data: { message: 'Already favorited' } };
      }

      await db.insert(favorites).values({
        userId: request.user!.id,
        fileId: request.params.id,
      });

      return { success: true, data: { message: 'Added to favorites' } };
    }
  );

  // Remove from favorites
  app.delete<{ Params: { id: string } }>(
    '/:id/favorite',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(favorites)
        .where(
          and(
            eq(favorites.userId, request.user!.id),
            eq(favorites.fileId, request.params.id)
          )
        );

      return { success: true, data: { message: 'Removed from favorites' } };
    }
  );

  // ===== RATINGS =====

  // Set rating
  app.put<{ Params: { id: string } }>(
    '/:id/rating',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { rating: ratingValue } = z
        .object({ rating: z.number().int().min(1).max(5) })
        .parse(request.body);

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      const existing = await db.query.ratings.findFirst({
        where: and(
          eq(ratings.userId, request.user!.id),
          eq(ratings.fileId, request.params.id)
        ),
      });

      if (existing) {
        await db
          .update(ratings)
          .set({ rating: ratingValue, updatedAt: new Date() })
          .where(eq(ratings.id, existing.id));
      } else {
        await db.insert(ratings).values({
          userId: request.user!.id,
          fileId: request.params.id,
          rating: ratingValue,
        });
      }

      return { success: true, data: { rating: ratingValue } };
    }
  );

  // Get rating
  app.get<{ Params: { id: string } }>(
    '/:id/rating',
    { preHandler: [authMiddleware] },
    async (request) => {
      const rating = await db.query.ratings.findFirst({
        where: and(
          eq(ratings.userId, request.user!.id),
          eq(ratings.fileId, request.params.id)
        ),
      });

      return { success: true, data: { rating: rating?.rating || null } };
    }
  );

  // Delete rating
  app.delete<{ Params: { id: string } }>(
    '/:id/rating',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(ratings)
        .where(
          and(
            eq(ratings.userId, request.user!.id),
            eq(ratings.fileId, request.params.id)
          )
        );

      return { success: true, data: { message: 'Rating removed' } };
    }
  );

  // ===== STREAMING =====

  // Stream file (for audio/video playback)
  app.get<{ Params: { id: string } }>(
    '/:id/stream',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const user = request.user!;
      const isAdmin = user.role === 'admin';

      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, user.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      // Check access for non-admins on restricted files
      if (!isAdmin) {
        const restrictionInfo = await getRestrictionInfo('file', file.id);
        if (restrictionInfo.isRestricted) {
          const context = {
            userId: user.id,
            householdId: user.householdId,
            userRole: user.role,
          };
          const hasAccess = await canAccess(context, 'file', file.id, 'view');
          if (!hasAccess) {
            throw Errors.forbidden('You do not have access to this file');
          }
        }
      }

      const stat = await fs.stat(file.storagePath);
      const fileSize = stat.size;
      const range = request.headers.range;

      if (range) {
        // Range request for seeking
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const { createReadStream } = await import('fs');
        const stream = createReadStream(file.storagePath, { start, end });

        return reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
          .header('Accept-Ranges', 'bytes')
          .header('Content-Length', chunkSize)
          .header('Content-Type', file.mimeType)
          .send(stream);
      } else {
        // Full file
        const { createReadStream } = await import('fs');
        const stream = createReadStream(file.storagePath);

        return reply
          .header('Content-Length', fileSize)
          .header('Content-Type', file.mimeType)
          .header('Accept-Ranges', 'bytes')
          .send(stream);
      }
    }
  );

  // ===== FOLDERS =====

  app.get(
    '/folders',
    { preHandler: [authMiddleware] },
    async (request) => {
      const folderList = await db.query.folders.findMany({
        where: eq(folders.householdId, request.user!.householdId),
      });

      return { success: true, data: { folders: folderList } };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/folders/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const user = request.user!;
      const isAdmin = user.role === 'admin';

      const folder = await db.query.folders.findFirst({
        where: and(
          eq(folders.id, request.params.id),
          eq(folders.householdId, user.householdId)
        ),
      });

      if (!folder) throw Errors.notFound('Folder');

      // Check if user has access to this folder
      if (!isAdmin) {
        const restrictionInfo = await getRestrictionInfo('folder', folder.id);
        if (restrictionInfo.isRestricted) {
          const context = {
            userId: user.id,
            householdId: user.householdId,
            userRole: user.role,
          };
          const hasAccess = await canAccess(context, 'file', folder.id, 'view');
          if (!hasAccess) {
            throw Errors.forbidden('You do not have access to this folder');
          }
        }
      }

      let subfolderList = await db.query.folders.findMany({
        where: eq(folders.parentId, folder.id),
      });

      let folderFiles = await db.query.files.findMany({
        where: eq(files.folderId, folder.id),
      });

      // Filter restricted items for non-admins
      if (!isAdmin) {
        const context = {
          userId: user.id,
          householdId: user.householdId,
          userRole: user.role,
        };

        // Filter subfolders
        const filteredSubfolders = [];
        for (const subfolder of subfolderList) {
          if (!subfolder.isRestricted) {
            filteredSubfolders.push(subfolder);
            continue;
          }
          const restrictionInfo = await getRestrictionInfo('folder', subfolder.id);
          if (!restrictionInfo.isRestricted) {
            filteredSubfolders.push(subfolder);
            continue;
          }
          const hasAccess = await canAccess(context, 'file', subfolder.id, 'view');
          if (hasAccess) {
            filteredSubfolders.push(subfolder);
          }
        }
        subfolderList = filteredSubfolders;

        // Filter files
        const filteredFiles = [];
        for (const file of folderFiles) {
          if (!file.isRestricted) {
            filteredFiles.push(file);
            continue;
          }
          const restrictionInfo = await getRestrictionInfo('file', file.id);
          if (!restrictionInfo.isRestricted) {
            filteredFiles.push(file);
            continue;
          }
          const hasAccess = await canAccess(context, 'file', file.id, 'view');
          if (hasAccess) {
            filteredFiles.push(file);
          }
        }
        folderFiles = filteredFiles;
      }

      return { success: true, data: { folder, subfolders: subfolderList, files: folderFiles } };
    }
  );

  // Get folder breadcrumb (path from root to folder)
  app.get<{ Params: { id: string } }>(
    '/folders/:id/breadcrumb',
    { preHandler: [authMiddleware] },
    async (request) => {
      const user = request.user!;
      const isAdmin = user.role === 'admin';
      const breadcrumb: { id: string; name: string; parentId: string | null }[] = [];

      let currentId: string | null = request.params.id;

      // Walk up the folder tree
      while (currentId) {
        const folder = await db.query.folders.findFirst({
          where: and(
            eq(folders.id, currentId),
            eq(folders.householdId, user.householdId)
          ),
        });

        if (!folder) break;

        // Check access for non-admins
        if (!isAdmin) {
          const restrictionInfo = await getRestrictionInfo('folder', folder.id);
          if (restrictionInfo.isRestricted) {
            const context = {
              userId: user.id,
              householdId: user.householdId,
              userRole: user.role,
            };
            const hasAccess = await canAccess(context, 'file', folder.id, 'view');
            if (!hasAccess) {
              // User doesn't have access to this folder - stop here
              break;
            }
          }
        }

        breadcrumb.unshift({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
        });

        currentId = folder.parentId;
      }

      return { success: true, data: { breadcrumb } };
    }
  );

  app.post(
    '/folders',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createFolderSchema.parse(request.body);

      const [folder] = await db
        .insert(folders)
        .values({
          householdId: request.user!.householdId,
          parentId: input.parentId,
          name: input.name,
          type: input.type,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { folder } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/folders/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { force } = z.object({ force: z.boolean().default(false) }).parse(request.query);

      const folder = await db.query.folders.findFirst({
        where: eq(folders.id, request.params.id),
      });

      if (!folder) throw Errors.notFound('Folder');

      // Check if folder has contents
      const hasFiles = await db.query.files.findFirst({
        where: eq(files.folderId, folder.id),
      });

      const hasSubfolders = await db.query.folders.findFirst({
        where: eq(folders.parentId, folder.id),
      });

      if ((hasFiles || hasSubfolders) && !force) {
        throw Errors.validation('Folder is not empty. Use force=true to delete anyway.');
      }

      await db.delete(folders).where(eq(folders.id, request.params.id));

      return { success: true, data: { message: 'Folder deleted' } };
    }
  );

  // ===== ALBUMS =====

  app.get(
    '/albums',
    { preHandler: [authMiddleware] },
    async (request) => {
      const albumList = await db.query.albums.findMany({
        where: eq(albums.householdId, request.user!.householdId),
      });

      return { success: true, data: { albums: albumList } };
    }
  );

  app.post(
    '/albums',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createAlbumSchema.parse(request.body);

      const [album] = await db
        .insert(albums)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          coverFileId: input.coverFileId,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { album } };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/albums/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const album = await db.query.albums.findFirst({
        where: and(
          eq(albums.id, request.params.id),
          eq(albums.householdId, request.user!.householdId)
        ),
      });

      if (!album) throw Errors.notFound('Album');

      const photos = await db.query.albumFiles.findMany({
        where: eq(albumFiles.albumId, album.id),
        with: { file: true },
        orderBy: (af, { asc }) => [asc(af.sortOrder)],
      });

      return { success: true, data: { album, photos: photos.map((p) => p.file) } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/albums/:id/photos',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { fileIds } = z.object({ fileIds: z.array(z.string().uuid()) }).parse(request.body);

      const entries = fileIds.map((fileId, index) => ({
        albumId: request.params.id,
        fileId,
        sortOrder: index,
      }));

      await db.insert(albumFiles).values(entries);

      return { success: true, data: { message: 'Photos added to album' } };
    }
  );

  app.delete<{ Params: { id: string; fileId: string } }>(
    '/albums/:id/photos/:fileId',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(albumFiles)
        .where(
          and(
            eq(albumFiles.albumId, request.params.id),
            eq(albumFiles.fileId, request.params.fileId)
          )
        );

      return { success: true, data: { message: 'Photo removed from album' } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/albums/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db.delete(albums).where(eq(albums.id, request.params.id));

      return { success: true, data: { message: 'Album deleted' } };
    }
  );

  // ===== PLAYLISTS =====

  app.get(
    '/playlists',
    { preHandler: [authMiddleware] },
    async (request) => {
      const playlistList = await db.query.playlists.findMany({
        where: eq(playlists.householdId, request.user!.householdId),
      });

      return { success: true, data: { playlists: playlistList } };
    }
  );

  app.post(
    '/playlists',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createPlaylistSchema.parse(request.body);

      const [playlist] = await db
        .insert(playlists)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          type: input.type,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { playlist } };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/playlists/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const playlist = await db.query.playlists.findFirst({
        where: and(
          eq(playlists.id, request.params.id),
          eq(playlists.householdId, request.user!.householdId)
        ),
      });

      if (!playlist) throw Errors.notFound('Playlist');

      const items = await db.query.playlistItems.findMany({
        where: eq(playlistItems.playlistId, playlist.id),
        with: { file: true },
        orderBy: (pi, { asc }) => [asc(pi.sortOrder)],
      });

      return { success: true, data: { playlist, items: items.map((i) => i.file) } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/playlists/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db.delete(playlists).where(eq(playlists.id, request.params.id));

      return { success: true, data: { message: 'Playlist deleted' } };
    }
  );

  // Storage usage
  app.get(
    '/storage/usage',
    { preHandler: [authMiddleware] },
    async (request) => {
      const fileList = await db.query.files.findMany({
        where: eq(files.householdId, request.user!.householdId),
        columns: { type: true, sizeBytes: true },
      });

      const breakdown: Record<string, number> = {
        photos: 0,
        videos: 0,
        music: 0,
        documents: 0,
      };

      let totalUsed = 0;
      for (const file of fileList) {
        breakdown[file.type + 's'] = (breakdown[file.type + 's'] || 0) + file.sizeBytes;
        totalUsed += file.sizeBytes;
      }

      // Get filesystem stats
      let filesystem: { totalBytes: number; availableBytes: number } | null = null;
      try {
        const fsModule = await import('node:fs/promises');
        const stats = await fsModule.statfs(config.STORAGE_PATH);
        filesystem = {
          totalBytes: stats.blocks * stats.bsize,
          availableBytes: stats.bavail * stats.bsize,
        };
      } catch {
        // Filesystem stats unavailable (permissions, path doesn't exist, etc.)
      }

      // Get effective limit with source info
      const { limitBytes, source, householdLimitGb, systemLimitGb } = await getEffectiveStorageLimit(
        request.user!.householdId
      );

      const effectiveLimit = limitBytes;
      const percentUsed = effectiveLimit > 0 ? (totalUsed / effectiveLimit) * 100 : 0;

      return {
        success: true,
        data: {
          usedBytes: totalUsed,
          breakdown,
          filesystem,
          effectiveLimit,
          percentUsed: Math.min(percentUsed, 100), // Cap at 100%
          limitSource: source,
          householdLimitGb,
          systemLimitGb,
        },
      };
    }
  );

  // ===== LIBRARY SCANNING =====

  // Trigger library scan
  app.post(
    '/library/scan',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const result = await mediaScannerService.scanLibrary(request.user!.householdId);

      return {
        success: true,
        data: {
          message: `Scan complete. Found ${result.newFiles} new files, processed ${result.processedFiles} total.`,
          ...result,
        },
      };
    }
  );

  // Get media settings
  app.get(
    '/library/settings',
    { preHandler: [authMiddleware] },
    async (request) => {
      const settings = await mediaScannerService.getMediaSettings(request.user!.householdId);

      return {
        success: true,
        data: {
          settings: settings || {
            enableTmdb: true,
            enableMusicbrainz: true,
            enableTranscoding: true,
            autoScanEnabled: false,
            autoScanInterval: 3600,
          },
        },
      };
    }
  );

  // Update media settings
  app.put(
    '/library/settings',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = z
        .object({
          enableTmdb: z.boolean().optional(),
          enableMusicbrainz: z.boolean().optional(),
          enableTranscoding: z.boolean().optional(),
          tmdbApiKey: z.string().optional(),
          transcodeProfiles: z.array(z.string()).optional(),
          autoScanEnabled: z.boolean().optional(),
          autoScanInterval: z.number().int().min(300).optional(),
        })
        .parse(request.body);

      const settings = await mediaScannerService.updateMediaSettings(
        request.user!.householdId,
        input
      );

      return { success: true, data: { settings } };
    }
  );
}
