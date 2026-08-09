import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import type { ReceiptJobData } from './index.js';

export async function processReceiptJob(job: Job<ReceiptJobData>): Promise<void> {
  const { scanId, householdId } = job.data;

  logger.info({ scanId, jobId: job.id }, 'Starting receipt scan job');

  try {
    // Dynamic import to avoid circular dependencies
    const { processReceiptScan } = await import('../modules/receipts/receipts.service.js');

    await processReceiptScan(scanId, householdId);

    logger.info({ scanId, jobId: job.id }, 'Receipt scan job completed successfully');
  } catch (error) {
    logger.error({ scanId, jobId: job.id, error }, 'Receipt scan job failed');
    throw error;
  }
}
