import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config/index.js';
import { db } from '../config/database.js';
import { households } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';
import { getServeStatus, getTailscaleStatus } from '../lib/tailscale.js';

const QUEUE_NAME = 'tailscale-health';

const connection = { connectionName: 'tailscale-health' } as const;

export const tailscaleHealthQueue = new Queue(QUEUE_NAME, {
  connection: { url: config.REDIS_URL, ...connection },
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 86400, count: 10 },
    removeOnFail: { age: 604800 },
  },
});

interface HealthJobData {
  type: 'daily_check';
}

/**
 * Daily probe of Tailscale serve config. If any household has selected
 * `tailscale` mode but the daemon isn't running serve at the expected port,
 * we log a warning — the user's CalDAV URL is stale.
 *
 * We don't fix it automatically: serve config changes need operator perms
 * and an explicit user action. The warning is the signal to re-enable from
 * Settings → Remote Access.
 */
export async function processTailscaleHealth(job: Job<HealthJobData>): Promise<void> {
  logger.debug({ jobId: job.id }, 'Tailscale health check starting');

  // Are any households in tailscale mode?
  const allHouseholds = await db.query.households.findMany({
    columns: { id: true, name: true, settings: true },
  });
  const tailscaleHouseholds = allHouseholds.filter((h) => {
    const settings = h.settings as { remoteAccess?: { mode?: string } } | null;
    return settings?.remoteAccess?.mode === 'tailscale';
  });

  if (tailscaleHouseholds.length === 0) {
    logger.debug('No households in tailscale mode; skipping health check');
    return;
  }

  const status = await getTailscaleStatus();
  if (!status.available) {
    logger.warn(
      {
        issues: status.issues,
        affectedHouseholds: tailscaleHouseholds.length,
      },
      'Tailscale daemon unreachable; households in tailscale mode have stale public URLs'
    );
    return;
  }

  const serve = await getServeStatus();
  if (!serve.configured) {
    logger.warn(
      { affectedHouseholds: tailscaleHouseholds.length },
      'Households expect tailscale serve but it is not configured; re-enable via Settings → Remote Access'
    );
    return;
  }
  if (serve.target && !serve.target.includes(`:${config.PORT}`)) {
    logger.warn(
      { serveTarget: serve.target, expectedPort: config.PORT },
      'Tailscale serve target does not match backend port; configuration may have drifted'
    );
    return;
  }
  logger.debug({ httpsPort: serve.httpsPort, target: serve.target }, 'Tailscale serve healthy');
}

let worker: Worker<HealthJobData> | null = null;

export function startTailscaleHealthWorker(): Worker<HealthJobData> {
  if (worker) return worker;
  worker = new Worker<HealthJobData>(QUEUE_NAME, processTailscaleHealth, {
    connection: { url: config.REDIS_URL, ...connection },
  });
  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err }, 'Tailscale health job failed');
  });
  return worker;
}

export async function scheduleTailscaleHealthJob(): Promise<void> {
  await tailscaleHealthQueue.add(
    'daily_check',
    { type: 'daily_check' },
    {
      repeat: { pattern: '0 6 * * *' }, // Daily at 6 AM
      jobId: 'tailscale:daily_check',
    }
  );
}

export async function shutdownTailscaleHealthWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await tailscaleHealthQueue.close();
}

// Re-export the unused import to satisfy the type checker when removed in the
// future without dropping the symbol from this module.
export const _households = households;
