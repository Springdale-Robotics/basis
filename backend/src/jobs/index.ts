import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../config/redis.js';
import { logger } from '../lib/logger.js';

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

export const calendarReminderQueue = new Queue('calendar-reminders', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

export const calendarSyncQueue = new Queue('calendar-sync', {
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

export const mediaQueue = new Queue('media', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const imageParseQueue = new Queue('image-parse', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const receiptQueue = new Queue('receipts', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 2,
  },
});

export const bugReportQueue = new Queue('bug-reports', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 200,
    // Long backoff — most failures are GitHub outages or missing credentials;
    // hammering doesn't help and we want to give admins time to fix the token.
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 30_000,
    },
  },
});

// Job type definitions
export interface NotificationJobData {
  type: 'low_stock' | 'expiring_soon' | 'leftover_expiring' | 'task_due' | 'sync_error' | 'custom';
  householdId: string;
  userId?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface CleanupJobData {
  type: 'expired_sessions' | 'old_notifications' | 'old_audit_logs' | 'orphaned_files' | 'old_leftovers';
  householdId?: string;
}

export interface InventoryJobData {
  type: 'check_low_stock' | 'check_expiring' | 'check_leftovers_expiring';
  // Omitted for the recurring jobs, which run the check for every household.
  householdId?: string;
}

export interface CalendarReminderJobData {
  type: 'check_reminders';
}

export interface CalendarSyncJobData {
  type: 'sync_all' | 'sync_single';
  calendarId?: string;
  householdId?: string;
}

export interface MediaJobData {
  type: 'thumbnail' | 'exif' | 'video_info';
  fileId: string;
  householdId: string;
  storagePath: string;
  mimeType: string;
}

export interface ImageParseJobData {
  sessionId: string;
  householdId: string;
}

export interface BugReportJobData {
  reportId: string;
}

export interface ReceiptJobData {
  scanId: string;
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

  // Calendar reminder worker
  const calendarReminderWorker = new Worker(
    'calendar-reminders',
    async (job: Job<CalendarReminderJobData>) => {
      const { processCalendarReminderJob } = await import('./calendar-reminder.worker.js');
      return processCalendarReminderJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  calendarReminderWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Calendar reminder job completed');
  });

  calendarReminderWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error }, 'Calendar reminder job failed');
  });

  // Calendar sync worker
  const calendarSyncWorker = new Worker(
    'calendar-sync',
    async (job: Job<CalendarSyncJobData>) => {
      const { processCalendarSyncJob } = await import('./calendar-sync.worker.js');
      return processCalendarSyncJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  calendarSyncWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Calendar sync job completed');
  });

  calendarSyncWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error }, 'Calendar sync job failed');
  });

  // Media worker
  const mediaWorker = new Worker(
    'media',
    async (job: Job<MediaJobData>) => {
      const { processMediaJob } = await import('./media.worker.js');
      return processMediaJob(job);
    },
    { connection: redis, concurrency: 3 }
  );

  mediaWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, type: job.data.type }, 'Media job completed');
  });

  mediaWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, type: job?.data.type, error }, 'Media job failed');
  });

  // Image parse worker
  const imageParseWorker = new Worker(
    'image-parse',
    async (job: Job<ImageParseJobData>) => {
      const { processImageParseJob } = await import('./image-parse.worker.js');
      return processImageParseJob(job);
    },
    { connection: redis, concurrency: 2 }
  );

  imageParseWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, sessionId: job.data.sessionId }, 'Image parse job completed');
  });

  imageParseWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, sessionId: job?.data.sessionId, error }, 'Image parse job failed');
  });

  // Bug report worker — posts user-submitted reports to GitHub Issues
  const bugReportWorker = new Worker(
    'bug-reports',
    async (job: Job<BugReportJobData>) => {
      const { processBugReportJob } = await import('./bug-report.worker.js');
      return processBugReportJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  bugReportWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, reportId: job.data.reportId }, 'Bug report delivered');
  });

  bugReportWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, reportId: job?.data.reportId, error }, 'Bug report delivery failed');
  });

  // Receipt scan worker
  const receiptWorker = new Worker(
    'receipts',
    async (job: Job<ReceiptJobData>) => {
      const { processReceiptJob } = await import('./receipts.worker.js');
      return processReceiptJob(job);
    },
    { connection: redis, concurrency: 1 }
  );

  receiptWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, scanId: job.data.scanId }, 'Receipt scan job completed');
  });

  receiptWorker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, scanId: job?.data.scanId, error }, 'Receipt scan job failed');
  });

  workers = [notificationWorker, cleanupWorker, inventoryWorker, calendarReminderWorker, calendarSyncWorker, mediaWorker, imageParseWorker, bugReportWorker, receiptWorker];
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

  // Clean up old finished leftovers weekly
  await cleanupQueue.add(
    'old_leftovers',
    { type: 'old_leftovers' },
    {
      repeat: { pattern: '0 5 * * 0' }, // Every Sunday at 5 AM
      jobId: 'cleanup:old_leftovers',
    }
  );

  // Inventory checks — daily, across all households (the processor iterates
  // households when no householdId is supplied).
  await inventoryQueue.add(
    'check_low_stock',
    { type: 'check_low_stock' },
    { repeat: { pattern: '0 8 * * *' }, jobId: 'inventory:low_stock' } // Daily 8 AM
  );
  await inventoryQueue.add(
    'check_expiring',
    { type: 'check_expiring' },
    { repeat: { pattern: '0 9 * * *' }, jobId: 'inventory:expiring' } // Daily 9 AM
  );
  await inventoryQueue.add(
    'check_leftovers_expiring',
    { type: 'check_leftovers_expiring' },
    { repeat: { pattern: '0 9 * * *' }, jobId: 'inventory:leftovers_expiring' } // Daily 9 AM
  );

  // Check calendar reminders every minute
  await calendarReminderQueue.add(
    'check_reminders',
    { type: 'check_reminders' },
    {
      repeat: { pattern: '* * * * *' }, // Every minute
      jobId: 'calendar:check_reminders',
    }
  );

  // Sync external calendars every hour
  await calendarSyncQueue.add(
    'sync_all',
    { type: 'sync_all' },
    {
      repeat: { pattern: '0 * * * *' }, // Every hour at minute 0
      jobId: 'calendar:sync_all',
    }
  );

  // Tailscale serve health probe — daily, idempotent, no-op when tailscale
  // not in use.
  const { scheduleTailscaleHealthJob, startTailscaleHealthWorker } = await import(
    './tailscale-health.worker.js'
  );
  startTailscaleHealthWorker();
  await scheduleTailscaleHealthJob();

  // Daily full-database backup — no-op (warns) when pg_dump isn't installed.
  const { scheduleSystemBackupJob, startSystemBackupWorker } = await import(
    './system-backup.worker.js'
  );
  startSystemBackupWorker();
  await scheduleSystemBackupJob();

  logger.info('Recurring jobs scheduled');
}

// Graceful shutdown
export async function shutdownWorkers(): Promise<void> {
  logger.info('Shutting down workers...');

  await Promise.all(workers.map((worker) => worker.close()));

  await notificationQueue.close();
  await cleanupQueue.close();
  await inventoryQueue.close();
  await calendarReminderQueue.close();
  await calendarSyncQueue.close();
  await mediaQueue.close();
  await imageParseQueue.close();
  await bugReportQueue.close();
  await receiptQueue.close();

  logger.info('All workers shut down');
}

// Helper to add notification job
export async function queueNotification(data: NotificationJobData): Promise<void> {
  await notificationQueue.add(data.type, data);
}

// Helper to add inventory check job
export async function queueInventoryCheck(householdId: string, type: InventoryJobData['type']): Promise<void> {
  // NB: custom job ids must not contain ':' — bullmq >=5.66 rejects them
  // (repeat-job ids above are exempt; the scheduler generates its own keys).
  await inventoryQueue.add(type, { type, householdId }, {
    jobId: `inventory-${type}-${householdId}`,
  });
}

// Helper to add calendar sync job
export async function queueCalendarSync(calendarId: string, householdId: string): Promise<void> {
  await calendarSyncQueue.add('sync_single', {
    type: 'sync_single',
    calendarId,
    householdId,
  }, {
    jobId: `calendar-sync-${calendarId}-${Date.now()}`,
  });
}

// Helper to queue media processing jobs
export async function queueMediaJob(data: MediaJobData): Promise<void> {
  await mediaQueue.add(data.type, data, {
    jobId: `media-${data.type}-${data.fileId}`,
  });
}

// Helper to queue image parse job
export async function queueImageParse(data: ImageParseJobData): Promise<void> {
  await imageParseQueue.add('parse', data, {
    jobId: `image-parse-${data.sessionId}`,
  });
}

// Helper to queue a bug report delivery to GitHub
export async function queueBugReportDelivery(reportId: string): Promise<void> {
  await bugReportQueue.add('deliver', { reportId }, {
    // jobId scoped so a re-submit of the same row replaces the previous attempt
    jobId: `bug-report-${reportId}`,
  });
}

// Helper to queue a receipt scan parse
export async function queueReceiptParse(data: ReceiptJobData): Promise<void> {
  await receiptQueue.add('parse', data, {
    // NB: bullmq >=5.66 rejects ':' in custom job ids (see queueInventoryCheck).
    jobId: `receipt-${data.scanId}`,
  });
}

// Helper to queue all media jobs for a new file
export async function queueMediaProcessing(
  fileId: string,
  householdId: string,
  storagePath: string,
  mimeType: string
): Promise<void> {
  // Queue thumbnail generation
  await queueMediaJob({
    type: 'thumbnail',
    fileId,
    householdId,
    storagePath,
    mimeType,
  });

  // Queue EXIF extraction for images
  if (mimeType.startsWith('image/')) {
    await queueMediaJob({
      type: 'exif',
      fileId,
      householdId,
      storagePath,
      mimeType,
    });
  }

  // Queue video info extraction for videos
  if (mimeType.startsWith('video/')) {
    await queueMediaJob({
      type: 'video_info',
      fileId,
      householdId,
      storagePath,
      mimeType,
    });
  }
}
