import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { files, folders, albums, albumFiles, playlists, playlistItems } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { config } from '../../config/index.js';
import { fileTypeSchema } from '../../lib/validators.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

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
    { preHandler: [authMiddleware] },
    async (request) => {
      const { type, folderId } = request.query as any;

      const conditions = [eq(files.householdId, request.user!.householdId)];

      const fileList = await db.query.files.findMany({
        where: and(...conditions),
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      });

      let filtered = fileList;
      if (type) {
        filtered = filtered.filter((f) => f.type === type);
      }
      if (folderId) {
        filtered = filtered.filter((f) => f.folderId === folderId);
      }

      return { success: true, data: { files: filtered } };
    }
  );

  // Upload file
  app.post(
    '/upload',
    { preHandler: [authMiddleware, requireMember()] },
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
      const buffer = await data.toBuffer();
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

      return { success: true, data: { file } };
    }
  );

  // Get file metadata
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
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
      const file = await db.query.files.findFirst({
        where: and(
          eq(files.id, request.params.id),
          eq(files.householdId, request.user!.householdId)
        ),
      });

      if (!file) throw Errors.notFound('File');

      const fileBuffer = await fs.readFile(file.storagePath);

      reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .send(fileBuffer);
    }
  );

  // Delete file
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
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
      const folder = await db.query.folders.findFirst({
        where: and(
          eq(folders.id, request.params.id),
          eq(folders.householdId, request.user!.householdId)
        ),
      });

      if (!folder) throw Errors.notFound('Folder');

      const subfolders = await db.query.folders.findMany({
        where: eq(folders.parentId, folder.id),
      });

      const folderFiles = await db.query.files.findMany({
        where: eq(files.folderId, folder.id),
      });

      return { success: true, data: { folder, subfolders, files: folderFiles } };
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

      return {
        success: true,
        data: {
          usedBytes: totalUsed,
          breakdown,
        },
      };
    }
  );
}
