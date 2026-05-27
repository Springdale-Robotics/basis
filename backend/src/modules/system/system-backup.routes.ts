import type { FastifyInstance } from 'fastify';
import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { createReadStream, promises as fs } from 'fs';
import { resolve as resolvePath, basename } from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';

const exec = promisify(execCallback);

async function pgDumpAvailable(): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await exec('pg_dump --version', { timeout: 3_000 });
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false };
  }
}

/**
 * Backups directory — sibling to STORAGE_PATH so production
 * (/opt/basis/data/storage + /opt/basis/data/backups) and dev (./storage +
 * ./backups) both land in sensible places.
 */
const BACKUP_DIR = resolvePath(config.STORAGE_PATH, '../backups');
const SUFFIX = '.sql.gz';

async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/** Strip any path components from a user-supplied filename to prevent
 *  /api/v1/system/backups/../../../etc/passwd shenanigans. */
function safeFilename(name: string): string {
  const cleaned = basename(name);
  if (!cleaned.endsWith(SUFFIX)) {
    throw Errors.validation('Filename must end with .sql.gz');
  }
  return cleaned;
}

interface DatabaseUrlParts {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

function parseDatabaseUrl(url: string): DatabaseUrlParts {
  // Use the URL parser — handles encoded passwords, IPv6 hosts, etc.
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Run pg_dump and stream output to a gzipped file. Resolves when done.
 * Throws if pg_dump exits non-zero (we delete the partial file).
 */
async function runPgDump(targetFile: string): Promise<{ bytes: number }> {
  const parts = parseDatabaseUrl(config.DATABASE_URL);
  const args = [
    '-h', parts.host,
    '-p', parts.port,
    '-U', parts.user,
    '-d', parts.database,
    '--no-owner',
    '--no-acl',
    '--clean',          // drops objects before re-creating, so restoring is idempotent
    '--if-exists',      // use IF EXISTS on the drops so restoring into a fresh DB doesn't error
    '--format=plain',
  ];

  const proc = spawn('pg_dump', args, {
    env: { ...process.env, PGPASSWORD: parts.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const gzip = createGzip({ level: 6 });
  const tmpFile = `${targetFile}.tmp`;
  const out = (await fs.open(tmpFile, 'w')).createWriteStream();

  try {
    await Promise.all([
      pipeline(proc.stdout, gzip, out),
      new Promise<void>((resolveExit, rejectExit) => {
        proc.on('error', rejectExit);
        proc.on('exit', (code) => {
          if (code === 0) resolveExit();
          else rejectExit(new Error(`pg_dump exited with code ${code}: ${stderr.slice(0, 500)}`));
        });
      }),
    ]);
  } catch (err) {
    // Clean up the partial file before bubbling up.
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }

  await fs.rename(tmpFile, targetFile);
  const stat = await fs.stat(targetFile);
  return { bytes: stat.size };
}

export async function systemBackupRoutes(app: FastifyInstance): Promise<void> {
  // List backups (filesystem scan, newest first).
  app.get(
    '/',
    { preHandler: [authMiddleware, requireAdmin()] },
    async () => {
      await ensureBackupDir();
      const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith(SUFFIX))
        .map((e) => e.name);

      const stats = await Promise.all(
        files.map(async (name) => {
          const stat = await fs.stat(resolvePath(BACKUP_DIR, name));
          return {
            filename: name,
            bytes: stat.size,
            mtime: stat.mtime.toISOString(),
          };
        })
      );
      stats.sort((a, b) => b.mtime.localeCompare(a.mtime));

      const pgDump = await pgDumpAvailable();

      return {
        success: true,
        data: {
          backups: stats,
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

      await ensureBackupDir();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `basis-${ts}${SUFFIX}`;
      const target = resolvePath(BACKUP_DIR, filename);
      const start = Date.now();

      try {
        const { bytes } = await runPgDump(target);
        logger.info({ filename, bytes, ms: Date.now() - start }, 'Backup created');
        return {
          success: true,
          data: { filename, bytes, elapsedMs: Date.now() - start },
        };
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
