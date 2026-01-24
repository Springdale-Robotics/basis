import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { files, mediaProcessingJobs } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { thumbnailService } from '../services/thumbnail.service.js';
import { exifService } from '../services/exif.service.js';

export interface MediaJobData {
  type: 'thumbnail' | 'exif' | 'video_info';
  fileId: string;
  householdId: string;
  storagePath: string;
  mimeType: string;
}

export async function processMediaJob(job: Job<MediaJobData>): Promise<void> {
  const { type, fileId, householdId, storagePath, mimeType } = job.data;

  logger.info({ jobId: job.id, type, fileId }, 'Processing media job');

  // Update job status
  await updateJobStatus(fileId, type, 'processing');

  try {
    switch (type) {
      case 'thumbnail':
        await processThumbnailJob(fileId, householdId, storagePath, mimeType, job);
        break;
      case 'exif':
        await processExifJob(fileId, storagePath, job);
        break;
      case 'video_info':
        await processVideoInfoJob(fileId, storagePath, job);
        break;
      default:
        throw new Error(`Unknown job type: ${type}`);
    }

    await updateJobStatus(fileId, type, 'completed');
    logger.info({ jobId: job.id, type, fileId }, 'Media job completed');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await updateJobStatus(fileId, type, 'failed', errorMessage);
    logger.error({ jobId: job.id, type, fileId, err }, 'Media job failed');
    throw err;
  }
}

async function processThumbnailJob(
  fileId: string,
  householdId: string,
  storagePath: string,
  mimeType: string,
  job: Job<MediaJobData>
): Promise<void> {
  await job.updateProgress(10);

  let results;
  if (mimeType.startsWith('image/')) {
    results = await thumbnailService.generateImageThumbnails(fileId, householdId, storagePath);
  } else if (mimeType.startsWith('video/')) {
    results = await thumbnailService.generateVideoThumbnail(fileId, householdId, storagePath);
  } else {
    logger.warn({ fileId, mimeType }, 'Unsupported mime type for thumbnail generation');
    return;
  }

  await job.updateProgress(80);

  if (results.length > 0) {
    await thumbnailService.saveThumbnails(fileId, results);

    // Update file metadata with small thumbnail path
    const smThumbnail = results.find((r) => r.size === 'sm');
    if (smThumbnail) {
      await db
        .update(files)
        .set({
          metadata: {
            thumbnailPath: smThumbnail.storagePath,
          },
          updatedAt: new Date(),
        })
        .where(eq(files.id, fileId));
    }
  }

  await job.updateProgress(100);
}

async function processExifJob(
  fileId: string,
  storagePath: string,
  job: Job<MediaJobData>
): Promise<void> {
  await job.updateProgress(10);

  const exifData = await exifService.extractExif(storagePath);

  await job.updateProgress(50);

  if (Object.keys(exifData).length > 0) {
    await exifService.savePhotoMetadata(fileId, exifData);

    // Update file metadata with dimensions
    if (exifData.width && exifData.height) {
      const file = await db.query.files.findFirst({
        where: eq(files.id, fileId),
      });

      if (file) {
        await db
          .update(files)
          .set({
            metadata: {
              ...(file.metadata || {}),
              width: exifData.width,
              height: exifData.height,
              exif: exifData.rawExif,
            },
            updatedAt: new Date(),
          })
          .where(eq(files.id, fileId));
      }
    }
  }

  await job.updateProgress(100);
}

async function processVideoInfoJob(
  fileId: string,
  storagePath: string,
  job: Job<MediaJobData>
): Promise<void> {
  await job.updateProgress(10);

  try {
    // Try to use ffprobe if available
    const ffmpeg = await import('fluent-ffmpeg');

    const videoInfo = await new Promise<{
      duration: number;
      width: number;
      height: number;
      codec: string;
      framerate: number;
      hasAudio: boolean;
    }>((resolve, reject) => {
      ffmpeg.default.ffprobe(storagePath, (err: Error | null, data: any) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
        const audioStream = data.streams.find((s: any) => s.codec_type === 'audio');

        resolve({
          duration: parseFloat(data.format.duration) || 0,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          codec: videoStream?.codec_name || '',
          framerate: eval(videoStream?.r_frame_rate) || 0,
          hasAudio: !!audioStream,
        });
      });
    });

    await job.updateProgress(70);

    // Update file metadata
    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });

    if (file) {
      await db
        .update(files)
        .set({
          metadata: {
            ...(file.metadata || {}),
            duration: videoInfo.duration,
            width: videoInfo.width,
            height: videoInfo.height,
            codec: videoInfo.codec,
            framerate: videoInfo.framerate,
            hasAudio: videoInfo.hasAudio,
          },
          updatedAt: new Date(),
        })
        .where(eq(files.id, fileId));
    }
  } catch (err) {
    logger.warn({ err, fileId }, 'ffprobe not available for video info extraction');
  }

  await job.updateProgress(100);
}

async function updateJobStatus(
  fileId: string,
  jobType: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  error?: string
): Promise<void> {
  const now = new Date();
  const updates: Partial<typeof mediaProcessingJobs.$inferInsert> = {
    status,
  };

  if (status === 'processing') {
    updates.startedAt = now;
  } else if (status === 'completed' || status === 'failed') {
    updates.completedAt = now;
  }

  if (error) {
    updates.error = error;
  }

  // Try to update existing job or create new one
  const existing = await db.query.mediaProcessingJobs.findFirst({
    where: (j, { and, eq: equals }) =>
      and(equals(j.fileId, fileId), equals(j.jobType, jobType)),
  });

  if (existing) {
    await db
      .update(mediaProcessingJobs)
      .set(updates)
      .where(eq(mediaProcessingJobs.id, existing.id));
  } else {
    await db.insert(mediaProcessingJobs).values({
      fileId,
      jobType,
      status,
      error,
      startedAt: status === 'processing' ? now : undefined,
      completedAt: status === 'completed' || status === 'failed' ? now : undefined,
    });
  }
}
