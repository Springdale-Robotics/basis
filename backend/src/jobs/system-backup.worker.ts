import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import {
  pgDumpAvailable,
  createBackup,
  pruneBackups,
} from '../modules/system/system-backup.service.js';

const QUEUE_NAME = 'system-backup';

const connection = { connectionName: 'system-backup' } as const;

/** Newest backups to keep after each automatic run. */
const RETAIN_COUNT = 14;

export const systemBackupQueue = new Queue(QUEUE_NAME, {
  connection: { url: config.REDIS_URL, ...connection },
  defaultJobOptions: {
    attempts: 1,
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

  const pruned = await pruneBackups(RETAIN_COUNT);
  if (pruned.length > 0) {
    log.info({ removed: pruned.length, retained: RETAIN_COUNT }, 'Pruned old backups');
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
