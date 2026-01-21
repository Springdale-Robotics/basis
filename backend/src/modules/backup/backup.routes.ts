import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { backups, backupSchedules } from '../../db/schema/index.js';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { config } from '../../config/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../../lib/encryption.js';

const createBackupSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  includeFiles: z.boolean().default(true),
  encryptionKey: z.string().min(16).optional(),
});

const createScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  cronExpression: z.string().min(1),
  retentionDays: z.number().int().min(1).max(365).default(30),
  includeFiles: z.boolean().default(true),
  isEnabled: z.boolean().default(true),
});

const restoreBackupSchema = z.object({
  encryptionKey: z.string().min(16).optional(),
});

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  // List backups
  app.get(
    '/',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const backupList = await db.query.backups.findMany({
        where: eq(backups.householdId, request.user!.householdId),
        orderBy: [desc(backups.createdAt)],
      });

      return { success: true, data: { backups: backupList } };
    }
  );

  // Create manual backup
  app.post(
    '/',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = createBackupSchema.parse(request.body);

      const backupId = randomUUID();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${request.user!.householdId}-${timestamp}.json`;
      const storagePath = path.join(config.STORAGE_PATH, 'backups', request.user!.householdId, filename);

      // Ensure directory exists
      await fs.mkdir(path.dirname(storagePath), { recursive: true });

      // Gather data for backup
      const backupData = await gatherBackupData(request.user!.householdId, input.includeFiles);

      // Optionally encrypt
      let finalData: string;
      let isEncrypted = false;

      if (input.encryptionKey) {
        const encrypted = await encrypt(JSON.stringify(backupData), input.encryptionKey);
        finalData = JSON.stringify({ encrypted: true, data: encrypted });
        isEncrypted = true;
      } else {
        finalData = JSON.stringify(backupData, null, 2);
      }

      // Write backup file
      await fs.writeFile(storagePath, finalData);
      const stats = await fs.stat(storagePath);

      // Create database record
      const [backup] = await db
        .insert(backups)
        .values({
          id: backupId,
          householdId: request.user!.householdId,
          name: input.name || `Backup ${timestamp}`,
          storagePath,
          sizeBytes: stats.size,
          isEncrypted,
          status: 'completed',
          completedAt: new Date(),
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { backup } };
    }
  );

  // Get backup details
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const backup = await db.query.backups.findFirst({
        where: and(
          eq(backups.id, request.params.id),
          eq(backups.householdId, request.user!.householdId)
        ),
      });

      if (!backup) throw Errors.notFound('Backup');

      return { success: true, data: { backup } };
    }
  );

  // Download backup
  app.get<{ Params: { id: string } }>(
    '/:id/download',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const backup = await db.query.backups.findFirst({
        where: and(
          eq(backups.id, request.params.id),
          eq(backups.householdId, request.user!.householdId)
        ),
      });

      if (!backup) throw Errors.notFound('Backup');

      const fileBuffer = await fs.readFile(backup.storagePath);
      const filename = path.basename(backup.storagePath);

      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(fileBuffer);
    }
  );

  // Delete backup
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const backup = await db.query.backups.findFirst({
        where: and(
          eq(backups.id, request.params.id),
          eq(backups.householdId, request.user!.householdId)
        ),
      });

      if (!backup) throw Errors.notFound('Backup');

      // Delete file
      try {
        await fs.unlink(backup.storagePath);
      } catch {
        // Ignore if file doesn't exist
      }

      // Delete record
      await db.delete(backups).where(eq(backups.id, request.params.id));

      return { success: true, data: { message: 'Backup deleted' } };
    }
  );

  // Restore from backup
  app.post<{ Params: { id: string } }>(
    '/:id/restore',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = restoreBackupSchema.parse(request.body);

      const backup = await db.query.backups.findFirst({
        where: and(
          eq(backups.id, request.params.id),
          eq(backups.householdId, request.user!.householdId)
        ),
      });

      if (!backup) throw Errors.notFound('Backup');

      // Read backup file
      const fileContent = await fs.readFile(backup.storagePath, 'utf-8');
      let backupData: any;

      const parsed = JSON.parse(fileContent);

      if (parsed.encrypted) {
        if (!input.encryptionKey) {
          throw Errors.validation('Encryption key required for encrypted backup');
        }
        const decrypted = await decrypt(parsed.data, input.encryptionKey);
        backupData = JSON.parse(decrypted);
      } else {
        backupData = parsed;
      }

      // Restore data (in a real implementation, this would restore all tables)
      // For now, we'll just validate the backup structure
      if (!backupData.version || !backupData.householdId) {
        throw Errors.validation('Invalid backup format');
      }

      // TODO: Implement actual restore logic with transaction

      return {
        success: true,
        data: {
          message: 'Backup restore initiated',
          tables: Object.keys(backupData.data || {}),
        },
      };
    }
  );

  // Upload and restore from external backup
  app.post(
    '/upload',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const data = await request.file();

      if (!data) {
        throw Errors.validation('No backup file uploaded');
      }

      const buffer = await data.toBuffer();
      const content = buffer.toString('utf-8');

      // Validate JSON
      let backupData: any;
      try {
        backupData = JSON.parse(content);
      } catch {
        throw Errors.validation('Invalid backup file format');
      }

      // Save uploaded backup
      const backupId = randomUUID();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `uploaded-${timestamp}.json`;
      const storagePath = path.join(config.STORAGE_PATH, 'backups', request.user!.householdId, filename);

      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, content);

      const [backup] = await db
        .insert(backups)
        .values({
          id: backupId,
          householdId: request.user!.householdId,
          name: `Uploaded backup ${timestamp}`,
          storagePath,
          sizeBytes: buffer.length,
          isEncrypted: !!backupData.encrypted,
          status: 'completed',
          completedAt: new Date(),
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { backup } };
    }
  );

  // ===== BACKUP SCHEDULES =====

  app.get(
    '/schedules',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const scheduleList = await db.query.backupSchedules.findMany({
        where: eq(backupSchedules.householdId, request.user!.householdId),
      });

      return { success: true, data: { schedules: scheduleList } };
    }
  );

  app.post(
    '/schedules',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = createScheduleSchema.parse(request.body);

      const [schedule] = await db
        .insert(backupSchedules)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          cronExpression: input.cronExpression,
          retentionDays: input.retentionDays,
          includeFiles: input.includeFiles,
          isEnabled: input.isEnabled,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { schedule } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/schedules/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = createScheduleSchema.partial().parse(request.body);

      const [updated] = await db
        .update(backupSchedules)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(backupSchedules.id, request.params.id),
            eq(backupSchedules.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Backup schedule');

      return { success: true, data: { schedule: updated } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/schedules/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .delete(backupSchedules)
        .where(
          and(
            eq(backupSchedules.id, request.params.id),
            eq(backupSchedules.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Schedule deleted' } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/schedules/:id/enable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .update(backupSchedules)
        .set({ isEnabled: true, updatedAt: new Date() })
        .where(
          and(
            eq(backupSchedules.id, request.params.id),
            eq(backupSchedules.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Schedule enabled' } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/schedules/:id/disable',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .update(backupSchedules)
        .set({ isEnabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(backupSchedules.id, request.params.id),
            eq(backupSchedules.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Schedule disabled' } };
    }
  );
}

async function gatherBackupData(householdId: string, includeFiles: boolean): Promise<any> {
  // This would gather all household data for backup
  // For now, return a skeleton structure
  return {
    version: '1.0',
    createdAt: new Date().toISOString(),
    householdId,
    data: {
      household: {},
      users: [],
      calendars: [],
      events: [],
      recipes: [],
      inventory: [],
      tasks: [],
      lists: [],
      settings: {},
      ...(includeFiles ? { files: [] } : {}),
    },
  };
}
