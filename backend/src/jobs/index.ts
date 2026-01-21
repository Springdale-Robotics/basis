import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

// Job queues
export const notificationQueue = new Queue('notifications', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

export const syncQueue = new Queue('sync', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const backupQueue = new Queue('backup', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

export const cleanupQueue = new Queue('cleanup', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 20,
    removeOnFail: 50,
    attempts: 2,
  },
});

export const inventoryQueue = new Queue('inventory', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// Job type definitions
export interface NotificationJobData {
  type: 'low_stock' | 'expiring_soon' | 'task_due' | 'sync_error' | 'custom';
  householdId: string;
  userId?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SyncJobData {
  fromHouseholdId: string;
  toHouseholdId: string;
  resourceType: string;
  resourceId: string;
  operation: 'share' | 'update' | 'delete';
}

export interface BackupJobData {
  householdId: string;
  scheduleId?: string;
  includeFiles: boolean;
  encryptionKey?: string;
}

export interface CleanupJobData {
  type: 'expired_sessions' | 'old_notifications' | 'old_audit_logs' | 'orphaned_files';
  householdId?: string;
}

export interface InventoryJobData {
  type: 'check_low_stock' | 'check_expiring' | 'update_quantities';
  householdId: string;
}

// Initialize workers
let workers: Worker[] = [];

export async function initializeWorkers(): Promise<void> {
  // Notification worker
  const notificationWorker = new Worker(
    'notifications',
    async (job: Job<NotificationJobData>) => {
      const { processNotificationJob } = await import('./notification.worker.js');
      return processNotificationJob(job);
    },
    { connection: redis, concurrency: 5 }
  );

  notificationWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, type: job.name }, 'Notification job completed');
  });

  notificationWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, type: job?.name, error }, 'Notification job failed');
  });

  // Sync worker
  const syncWorker = new Worker(
    'sync',
    async (job: Job<SyncJobData>) => {
      const { processSyncJob } = await import('./sync.worker.js');
      return processSyncJob(job);
    },
    { connection: redis, concurrency: 3 }
  );

  syncWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, type: job.name }, 'Sync job completed');
  });

  syncWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, type: job?.name, error }, 'Sync job failed');
  });

  // Backup worker
  const backupWorker = new Worker(
    'backup',
    async (job: Job<BackupJobData>) => {
      const { processBackupJob } = await import('./backup.worker.js');
      return processBackupJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  backupWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, householdId: job.data.householdId }, 'Backup job completed');
  });

  backupWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, householdId: job?.data.householdId, error }, 'Backup job failed');
  });

  // Cleanup worker
  const cleanupWorker = new Worker(
    'cleanup',
    async (job: Job<CleanupJobData>) => {
      const { processCleanupJob } = await import('./cleanup.worker.js');
      return processCleanupJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  cleanupWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, 'Cleanup job completed');
  });

  cleanupWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, type: job?.data.type, error }, 'Cleanup job failed');
  });

  // Inventory worker
  const inventoryWorker = new Worker(
    'inventory',
    async (job: Job<InventoryJobData>) => {
      const { processInventoryJob } = await import('./inventory.worker.js');
      return processInventoryJob(job);
    },
    { connection: redis, concurrency: 2 }
  );

  inventoryWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, type: job.data.type }, 'Inventory job completed');
  });

  inventoryWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, type: job?.data.type, error }, 'Inventory job failed');
  });

  workers = [notificationWorker, syncWorker, backupWorker, cleanupWorker, inventoryWorker];
  logger.info('Background workers initialized');
}

// Schedule recurring jobs
export async function scheduleRecurringJobs(): Promise<void> {
  // Clean up expired sessions every hour
  await cleanupQueue.add(
    'expired_sessions',
    { type: 'expired_sessions' },
    {
      repeat: { pattern: '0 * * * *' }, // Every hour
      jobId: 'cleanup:expired_sessions',
    }
  );

  // Clean up old notifications every day at 3 AM
  await cleanupQueue.add(
    'old_notifications',
    { type: 'old_notifications' },
    {
      repeat: { pattern: '0 3 * * *' }, // Daily at 3 AM
      jobId: 'cleanup:old_notifications',
    }
  );

  // Clean up old audit logs monthly
  await cleanupQueue.add(
    'old_audit_logs',
    { type: 'old_audit_logs' },
    {
      repeat: { pattern: '0 4 1 * *' }, // 1st of every month at 4 AM
      jobId: 'cleanup:old_audit_logs',
    }
  );

  logger.info('Recurring jobs scheduled');
}

// Graceful shutdown
export async function shutdownWorkers(): Promise<void> {
  logger.info('Shutting down workers...');

  await Promise.all(workers.map((worker) => worker.close()));

  await notificationQueue.close();
  await syncQueue.close();
  await backupQueue.close();
  await cleanupQueue.close();
  await inventoryQueue.close();

  logger.info('All workers shut down');
}

// Helper to add notification job
export async function queueNotification(data: NotificationJobData): Promise<void> {
  await notificationQueue.add(data.type, data);
}

// Helper to add sync job
export async function queueSync(data: SyncJobData): Promise<void> {
  await syncQueue.add(data.operation, data, {
    jobId: `sync:${data.resourceType}:${data.resourceId}:${data.toHouseholdId}`,
  });
}

// Helper to add backup job
export async function queueBackup(data: BackupJobData): Promise<void> {
  await backupQueue.add('backup', data, {
    jobId: `backup:${data.householdId}:${Date.now()}`,
  });
}

// Helper to add inventory check job
export async function queueInventoryCheck(householdId: string, type: InventoryJobData['type']): Promise<void> {
  await inventoryQueue.add(type, { type, householdId }, {
    jobId: `inventory:${type}:${householdId}`,
  });
}
