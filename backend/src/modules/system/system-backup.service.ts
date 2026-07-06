import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { resolve as resolvePath, basename } from 'path';
import { pipeline } from 'stream/promises';
import { createGzip, createGunzip } from 'zlib';
import { config } from '../../config/index.js';
import { Errors } from '../../lib/errors.js';

const exec = promisify(execCallback);

/**
 * Backups directory — sibling to STORAGE_PATH so production
 * (/opt/basis/data/storage + /opt/basis/data/backups) and dev (./storage +
 * ./backups) both land in sensible places.
 */
export const BACKUP_DIR = resolvePath(config.STORAGE_PATH, '../backups');
export const SUFFIX = '.sql.gz';

export async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

/** Strip any path components from a user-supplied filename to prevent
 *  /api/v1/system/backups/../../../etc/passwd shenanigans. */
export function safeFilename(name: string): string {
  const cleaned = basename(name);
  if (!cleaned.endsWith(SUFFIX)) {
    throw Errors.validation('Filename must end with .sql.gz');
  }
  return cleaned;
}

export async function pgDumpAvailable(): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await exec('pg_dump --version', { timeout: 3_000 });
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false };
  }
}

export async function psqlAvailable(): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout } = await exec('psql --version', { timeout: 3_000 });
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false };
  }
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

/**
 * Restore the database from a gzipped plain-SQL pg_dump file by streaming
 * gunzip -> psql. The dump is created with --clean --if-exists, and psql runs
 * with --single-transaction + ON_ERROR_STOP=1, so the restore is atomic: it
 * either fully applies or rolls back, never leaving a half-restored database.
 * Throws if psql exits non-zero (with captured stderr).
 */
export async function runPgRestore(sourceFile: string): Promise<void> {
  const parts = parseDatabaseUrl(config.DATABASE_URL);
  const args = [
    '-h', parts.host,
    '-p', parts.port,
    '-U', parts.user,
    '-d', parts.database,
    '-v', 'ON_ERROR_STOP=1',
    '--single-transaction',
  ];

  const proc = spawn('psql', args, {
    env: { ...process.env, PGPASSWORD: parts.password },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  // Drain stdout so the process isn't blocked on a full pipe buffer.
  proc.stdout.resume();

  await Promise.all([
    pipeline(createReadStream(sourceFile), createGunzip(), proc.stdin),
    new Promise<void>((resolveExit, rejectExit) => {
      proc.on('error', rejectExit);
      proc.on('exit', (code) => {
        if (code === 0) resolveExit();
        else rejectExit(new Error(`psql exited with code ${code}: ${stderr.slice(-800)}`));
      });
    }),
  ]);
}

export interface BackupInfo {
  filename: string;
  bytes: number;
  mtime: string;
}

/** List existing backup files, newest first. */
export async function listBackups(): Promise<BackupInfo[]> {
  await ensureBackupDir();
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(SUFFIX))
    .map((e) => e.name);

  const stats = await Promise.all(
    files.map(async (name) => {
      const stat = await fs.stat(resolvePath(BACKUP_DIR, name));
      return { filename: name, bytes: stat.size, mtime: stat.mtime.toISOString() };
    })
  );
  stats.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return stats;
}

/** Create a new gzipped pg_dump backup. Returns the filename and size. */
export async function createBackup(): Promise<{ filename: string; bytes: number; elapsedMs: number }> {
  await ensureBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `basis-${ts}${SUFFIX}`;
  const target = resolvePath(BACKUP_DIR, filename);
  const start = Date.now();
  const { bytes } = await runPgDump(target);
  return { filename, bytes, elapsedMs: Date.now() - start };
}

/**
 * Copy a finished backup off-host by running the operator-configured
 * BACKUP_REMOTE_CMD (rclone/rsync/scp/etc.). The file path is passed via
 * environment, not string interpolation, so a path never lands unquoted in a
 * shell. No-op when unconfigured. Returns whether a command ran.
 */
export async function copyBackupOffHost(filename: string): Promise<boolean> {
  const cmd = config.BACKUP_REMOTE_CMD;
  if (!cmd) return false;
  const filePath = resolvePath(BACKUP_DIR, safeFilename(filename));
  await exec(cmd, {
    timeout: 30 * 60_000, // large libraries / slow uplinks
    env: {
      ...process.env,
      BASIS_BACKUP_FILE: filePath,
      BASIS_BACKUP_DIR: BACKUP_DIR,
      // Uploaded media lives here (not in the DB dump). Exposed so an operator's
      // remote command can sync it too, closing the media-backup gap.
      BASIS_STORAGE_DIR: resolvePath(config.STORAGE_PATH),
    },
  });
  return true;
}

/** Prefix the update script gives pre-update rollback snapshots. */
export const PRE_UPDATE_PREFIX = 'pre-update-';

/**
 * Delete all but the `keep` newest *nightly* backups. Returns the filenames
 * removed.
 *
 * Pre-update rollback snapshots (`pre-update-*`) are excluded: they share the
 * `.sql.gz` suffix and directory with nightly dumps, so pruning by recency
 * across everything silently aged out the documented rollback point in ≤14
 * days (and a burst of updates crowded out nightly backups). They have their
 * own retention via prunePreUpdateSnapshots.
 */
export async function pruneBackups(keep: number): Promise<string[]> {
  if (keep <= 0) return [];
  const backups = (await listBackups()).filter(
    (b) => !b.filename.startsWith(PRE_UPDATE_PREFIX)
  ); // newest first
  const stale = backups.slice(keep);
  await Promise.all(
    stale.map((b) => fs.unlink(resolvePath(BACKUP_DIR, b.filename)).catch(() => {}))
  );
  return stale.map((b) => b.filename);
}

/**
 * Retention for pre-update rollback snapshots, independent of nightly backups.
 */
export async function prunePreUpdateSnapshots(keep: number): Promise<string[]> {
  if (keep <= 0) return [];
  const snapshots = (await listBackups()).filter((b) =>
    b.filename.startsWith(PRE_UPDATE_PREFIX)
  ); // newest first
  const stale = snapshots.slice(keep);
  await Promise.all(
    stale.map((b) => fs.unlink(resolvePath(BACKUP_DIR, b.filename)).catch(() => {}))
  );
  return stale.map((b) => b.filename);
}
