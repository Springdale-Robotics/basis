import type { FastifyInstance } from 'fastify';
import { createReadStream, promises as fs } from 'fs';
import { resolve as resolvePath } from 'path';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import {
  BACKUP_DIR,
  listBackups,
  safeFilename,
  pgDumpAvailable,
  psqlAvailable,
  createBackup,
  runPgRestore,
} from './system-backup.service.js';

export async function systemBackupRoutes(app: FastifyInstance): Promise<void> {
  // List backups (filesystem scan, newest first).
  app.get(
    '/',
    { preHandler: [authMiddleware, requireAdmin()] },
    async () => {
      const backups = await listBackups();
      const pgDump = await pgDumpAvailable();

      return {
        success: true,
        data: {
          backups,
          backupDir: BACKUP_DIR,
          pgDumpAvailable: pgDump.available,
          pgDumpVersion: pgDump.version,
        },
      };
    }
  );

  // Create a new backup synchronously. pg_dump is fast enough for household-
  // scale databases that streaming progress isn't worth the complexity.
  app.post(
    '/',
    { preHandler: [authMiddleware, requireAdmin()] },
    async () => {
      const pgDump = await pgDumpAvailable();
      if (!pgDump.available) {
        // Pre-flight check with a helpful message instead of bubbling up an
        // opaque ENOENT from spawn. Most likely cause in dev: postgres is in
        // Docker but the client tools aren't on the host. In prod the install
        // script ensures pg_dump is present.
        throw Errors.validation(
          'pg_dump is not installed on this host. Install postgresql-client (Ubuntu/Debian: `sudo apt install postgresql-client`) and try again.'
        );
      }

      try {
        const { filename, bytes, elapsedMs } = await createBackup();
        logger.info({ filename, bytes, ms: elapsedMs }, 'Backup created');
        return { success: true, data: { filename, bytes, elapsedMs } };
      } catch (err) {
        logger.error({ err }, 'pg_dump failed');
        throw Errors.internal(
          `Backup failed: ${err instanceof Error ? err.message : 'unknown'}`
        );
      }
    }
  );

  // Download a backup file.
  app.get<{ Params: { filename: string } }>(
    '/:filename/download',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request, reply) => {
      const filename = safeFilename(request.params.filename);
      const target = resolvePath(BACKUP_DIR, filename);
      try {
        await fs.access(target);
      } catch {
        throw Errors.notFound('Backup');
      }
      reply
        .header('Content-Type', 'application/gzip')
        .header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(createReadStream(target));
    }
  );

  // Restore the database from a backup. Destructive: replaces all current data
  // with the backup's contents. Atomic (single transaction) so a failed restore
  // leaves the existing database untouched.
  app.post<{ Params: { filename: string } }>(
    '/:filename/restore',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const filename = safeFilename(request.params.filename);
      const target = resolvePath(BACKUP_DIR, filename);
      try {
        await fs.access(target);
      } catch {
        throw Errors.notFound('Backup');
      }

      const psql = await psqlAvailable();
      if (!psql.available) {
        throw Errors.validation(
          'psql is not installed on this host. Install postgresql-client (Ubuntu/Debian: `sudo apt install postgresql-client`) and try again.'
        );
      }

      const start = Date.now();
      try {
        await runPgRestore(target);
        const elapsedMs = Date.now() - start;
        logger.warn({ filename, ms: elapsedMs }, 'Database restored from backup');
        return {
          success: true,
          data: {
            filename,
            elapsedMs,
            message:
              'Database restored. All sessions were reset — sign in again, and restart the app if anything looks stale.',
          },
        };
      } catch (err) {
        logger.error({ err }, 'Restore failed');
        throw Errors.internal(
          `Restore failed (database left unchanged): ${err instanceof Error ? err.message : 'unknown'}`
        );
      }
    }
  );

  // Delete a backup.
  app.delete<{ Params: { filename: string } }>(
    '/:filename',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const filename = safeFilename(request.params.filename);
      const target = resolvePath(BACKUP_DIR, filename);
      try {
        await fs.unlink(target);
        return { success: true, data: { message: 'Backup deleted' } };
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === 'ENOENT') throw Errors.notFound('Backup');
        throw err;
      }
    }
  );
}
