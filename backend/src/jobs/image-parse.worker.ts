import type { Job } from 'bullmq';
import { logger } from '../lib/logger.js';
import type { ImageParseJobData } from './index.js';

export async function processImageParseJob(job: Job<ImageParseJobData>): Promise<void> {
  const { sessionId, householdId } = job.data;

  logger.info({ sessionId, jobId: job.id }, 'Starting image parse job');

  try {
    // Dynamic import to avoid circular dependencies
    const { processImageWithAI } = await import('../modules/image-parse/image-parse.service.js');

    await processImageWithAI(sessionId, householdId);

    logger.info({ sessionId, jobId: job.id }, 'Image parse job completed successfully');
  } catch (error) {
    logger.error({ sessionId, jobId: job.id, error }, 'Image parse job failed');
    throw error;
  }
}
