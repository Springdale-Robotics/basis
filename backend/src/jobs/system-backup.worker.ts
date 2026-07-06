import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import {
  pgDumpAvailable,
  createBackup,
  pruneBackups,
  prunePreUpdateSnapshots,
  copyBackupOffHost,
} from '../modules/system/system-backup.service.js';

const QUEUE_NAME = 'system-backup';

const connection = { connectionName: 'system-backup' } as const;

/** Newest nightly backups to keep after each automatic run. */
const RETAIN_COUNT = 14;

/** Newest pre-update rollback snapshots to keep (separate from nightly). */
const RETAIN_PRE_UPDATE = 5;

export const systemBackupQueue = new Queue(QUEUE_NAME, {
  connection: { url: config.REDIS_URL, ...connection },
  defaultJobOptions: {
    // Retry a few times: a transient failure (brief DB lock, momentary I/O
    // error) shouldn't silently skip the whole night's backup.
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86400, count: 10 },
    removeOnFail: { age: 604800 },
  },
});

interface SystemBackupJobData {
  type: 'daily_backup';
}

/**
 * Daily full-database pg_dump backup. No-op (with a warning) when pg_dump is
 * unavailable so a missing client tool never crash-loops the worker. Prunes to
 * the newest RETAIN_COUNT backups afterward.
 */
export async function processSystemBackup(job: Job<SystemBackupJobData>): Promise<void> {
  const log = logger.child({ jobId: job.id });

  const pgDump = await pgDumpAvailable();
  if (!pgDump.available) {
    log.warn('Scheduled backup skipped: pg_dump is not installed on this host');
    return;
  }

  const { filename, bytes, elapsedMs } = await createBackup();
  log.info({ filename, bytes, ms: elapsedMs }, 'Scheduled backup created');

  // Copy off-host if configured. Don't let a remote-copy failure fail the whole
  // job (and burn retries re-dumping) — the local backup already succeeded.
  try {
    const copied = await copyBackupOffHost(filename);
    if (copied) log.info({ filename }, 'Backup copied off-host');
  } catch (err) {
    log.error({ err, filename }, 'Off-host backup copy failed (local backup is intact)');
  }

  const pruned = await pruneBackups(RETAIN_COUNT);
  if (pruned.length > 0) {
    log.info({ removed: pruned.length, retained: RETAIN_COUNT }, 'Pruned old backups');
  }

  // Pre-update rollback snapshots retain independently so a burst of updates
  // can't crowd out nightly backups, and the rollback point doesn't age out.
  const prunedSnapshots = await prunePreUpdateSnapshots(RETAIN_PRE_UPDATE);
  if (prunedSnapshots.length > 0) {
    log.info(
      { removed: prunedSnapshots.length, retained: RETAIN_PRE_UPDATE },
      'Pruned old pre-update snapshots',
    );
  }
}

let worker: Worker<SystemBackupJobData> | null = null;

export function startSystemBackupWorker(): Worker<SystemBackupJobData> {
  if (worker) return worker;
  worker = new Worker<SystemBackupJobData>(QUEUE_NAME, processSystemBackup, {
    connection: { url: config.REDIS_URL, ...connection },
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Scheduled backup job failed');
  });
  return worker;
}

export async function scheduleSystemBackupJob(): Promise<void> {
  await systemBackupQueue.add(
    'daily_backup',
    { type: 'daily_backup' },
    {
      repeat: { pattern: '0 2 * * *' }, // Daily at 2 AM
      jobId: 'system:daily_backup',
    }
  );
}

export async function shutdownSystemBackupWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await systemBackupQueue.close();
}
