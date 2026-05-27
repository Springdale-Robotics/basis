import type { FastifyInstance } from 'fastify';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { promises as fs, statfsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { config } from '../../config/index.js';
import { db } from '../../config/database.js';
import { sql } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';

const exec = promisify(execCallback);
const EXEC_TIMEOUT_MS = 3_000;
const backendStartedAt = Date.now();

type ServiceState = 'active' | 'inactive' | 'failed' | 'unknown' | 'not-installed';

interface ServiceStatus {
  name: string;
  state: ServiceState;
  uptimeSec?: number;
}

/**
 * Probe a systemd service's state. Returns 'not-installed' when systemctl
 * isn't available (dev mode, container without systemd, macOS, etc.) so
 * the UI can degrade gracefully.
 */
async function probeService(name: string): Promise<ServiceStatus> {
  try {
    const { stdout } = await exec(`systemctl is-active ${name}`, {
      timeout: EXEC_TIMEOUT_MS,
    });
    const state = stdout.trim() as ServiceState;
    // Try to get uptime as well — non-fatal if it fails.
    let uptimeSec: number | undefined;
    try {
      const r = await exec(
        `systemctl show ${name} --property=ActiveEnterTimestampMonotonic`,
        { timeout: EXEC_TIMEOUT_MS }
      );
      const m = r.stdout.match(/ActiveEnterTimestampMonotonic=(\d+)/);
      if (m) {
        // Monotonic clock value in microseconds; convert to seconds-since-active
        // by comparing with the host's clock_gettime(CLOCK_MONOTONIC).
        const monotonicNow = process.hrtime.bigint() / 1_000n;
        const enteredAt = BigInt(m[1]);
        if (enteredAt > 0n && enteredAt < monotonicNow) {
          uptimeSec = Number((monotonicNow - enteredAt) / 1_000_000n);
        }
      }
    } catch {
      /* uptime is best-effort */
    }
    return { name, state, uptimeSec };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    // systemctl returns exit code 3 with stdout "inactive" or "failed" when
    // the unit exists but isn't running. We treat those as real states, not
    // errors.
    const stdout = (e.stdout ?? '').trim();
    if (stdout === 'inactive' || stdout === 'failed' || stdout === 'unknown') {
      return { name, state: stdout as ServiceState };
    }
    // Various ways systemd-isn't-here can surface:
    //   - command not found (no systemctl binary)
    //   - "System has not been booted with systemd" (WSL2, some containers)
    //   - "Failed to connect to bus" (rootless container, no dbus)
    const stderr = e.stderr ?? '';
    if (
      e.code === 'ENOENT' ||
      /command not found|not recognized/i.test(stderr) ||
      /not been booted with systemd|failed to connect to bus/i.test(stderr)
    ) {
      return { name, state: 'not-installed' };
    }
    return { name, state: 'unknown' };
  }
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/status',
    { preHandler: [authMiddleware, requireAdmin()] },
    async () => {
      // ─── service states ──────────────────────────────────────────────
      const services = await Promise.all([
        probeService('basis.service'),
        probeService('basis-worker.service'),
        probeService('postgresql.service'),
        probeService('redis-server.service'),
      ]);

      // ─── disk usage (storage path) ───────────────────────────────────
      let storage: {
        path: string;
        totalBytes?: number;
        freeBytes?: number;
        usedBytes?: number;
        error?: string;
      } = { path: resolvePath(config.STORAGE_PATH) };
      try {
        const s = statfsSync(storage.path);
        storage.totalBytes = s.bsize * s.blocks;
        storage.freeBytes = s.bsize * s.bavail;
        storage.usedBytes = storage.totalBytes - s.bsize * s.bfree;
      } catch (err) {
        storage.error = (err as Error).message;
      }

      // ─── database size ───────────────────────────────────────────────
      let dbSize: { bytes?: number; error?: string } = {};
      try {
        const result = await db.execute<{ size: string }>(
          sql`SELECT pg_database_size(current_database())::text AS size`
        );
        // drizzle execute returns the raw pg result — first row's `size`.
        const row = (result as any).rows?.[0] ?? (result as any)[0];
        if (row?.size) dbSize.bytes = parseInt(row.size, 10);
      } catch (err) {
        dbSize.error = (err as Error).message;
        logger.debug({ err }, 'pg_database_size query failed');
      }

      // ─── last backup ────────────────────────────────────────────────
      // Convention: backups are written under /opt/basis/data/backups/ by the
      // (still-to-build) BullMQ recurring job. Tolerate missing dir.
      let lastBackup: { filename?: string; mtime?: string; bytes?: number } = {};
      try {
        const backupDir = resolvePath(config.STORAGE_PATH, '../backups');
        const entries = await fs.readdir(backupDir, { withFileTypes: true });
        const dumps = entries
          .filter((e) => e.isFile() && e.name.endsWith('.sql.gz'))
          .map((e) => e.name);
        if (dumps.length > 0) {
          const stats = await Promise.all(
            dumps.map(async (n) => ({
              name: n,
              stat: await fs.stat(resolvePath(backupDir, n)),
            }))
          );
          stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
          const newest = stats[0];
          lastBackup = {
            filename: newest.name,
            mtime: newest.stat.mtime.toISOString(),
            bytes: newest.stat.size,
          };
        }
      } catch {
        /* no backup dir yet — fall through with empty object */
      }

      // ─── current version ────────────────────────────────────────────
      let version = 'dev';
      if (config.FRONTEND_DIST) {
        try {
          const versionFile = resolvePath(config.FRONTEND_DIST, '../VERSION');
          version = (await fs.readFile(versionFile, 'utf8')).trim();
        } catch {
          version = 'unknown';
        }
      }

      return {
        success: true,
        data: {
          version,
          backendUptimeSec: Math.floor((Date.now() - backendStartedAt) / 1000),
          systemUptimeSec: Math.floor(process.uptime() * 0 + (Date.now() - backendStartedAt) / 1000),
          // The actual OS uptime is more useful for "did the box reboot recently".
          // Read from /proc/uptime where available.
          hostUptimeSec: await readHostUptime(),
          services,
          storage,
          database: dbSize,
          lastBackup,
          timestamp: new Date().toISOString(),
        },
      };
    }
  );
}

async function readHostUptime(): Promise<number | undefined> {
  try {
    const content = await fs.readFile('/proc/uptime', 'utf8');
    return Math.floor(parseFloat(content.split(/\s+/)[0]));
  } catch {
    return undefined;
  }
}
