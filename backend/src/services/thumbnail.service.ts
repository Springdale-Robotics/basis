import { loadSharp } from '../lib/sharp.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { config } from '../config/index.js';
import { db } from '../config/database.js';
import { thumbnails, files } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

export interface ThumbnailSize {
  name: 'sm' | 'md' | 'lg';
  width: number;
}

const THUMBNAIL_SIZES: ThumbnailSize[] = [
  { name: 'sm', width: 150 },
  { name: 'md', width: 400 },
  { name: 'lg', width: 800 },
];

// Parse thumbnail sizes from config
function getThumbnailSizes(): ThumbnailSize[] {
  const sizes = config.THUMBNAIL_SIZES.split(',').map((s) => parseInt(s.trim(), 10));
  return [
    { name: 'sm', width: sizes[0] || 150 },
    { name: 'md', width: sizes[1] || 400 },
    { name: 'lg', width: sizes[2] || 800 },
  ];
}

export interface ThumbnailResult {
  size: 'sm' | 'md' | 'lg';
  width: number;
  height: number;
  storagePath: string;
  blurHash?: string;
}

export class ThumbnailService {
  private storagePath: string;

  constructor() {
    this.storagePath = config.STORAGE_PATH;
  }

  private getThumbnailDir(householdId: string, fileId: string): string {
    return path.join(this.storagePath, 'thumbnails', householdId, fileId);
  }

  async generateImageThumbnails(
    fileId: string,
    householdId: string,
    sourcePath: string
  ): Promise<ThumbnailResult[]> {
    const sharp = await loadSharp();
    const sizes = getThumbnailSizes();
    const thumbnailDir = this.getThumbnailDir(householdId, fileId);

    // Ensure thumbnail directory exists
    await fs.mkdir(thumbnailDir, { recursive: true });

    const results: ThumbnailResult[] = [];

    for (const size of sizes) {
      try {
        const outputPath = path.join(thumbnailDir, `${size.name}.webp`);

        // Generate thumbnail
        const image = sharp(sourcePath);
        const metadata = await image.metadata();

        // Calculate dimensions maintaining aspect ratio
        const originalWidth = metadata.width || 0;
        const originalHeight = metadata.height || 0;
        const aspectRatio = originalHeight / originalWidth;
        const targetHeight = Math.round(size.width * aspectRatio);

        await image
          .resize(size.width, targetHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: config.THUMBNAIL_QUALITY })
          .toFile(outputPath);

        // Get actual output dimensions
        const outputMeta = await sharp(outputPath).metadata();

        results.push({
          size: size.name,
          width: outputMeta.width || size.width,
          height: outputMeta.height || targetHeight,
          storagePath: outputPath,
        });

        // Generate blur hash for smallest size (for progressive loading)
        if (size.name === 'sm') {
          try {
            const blurHash = await this.generateBlurPlaceholder(sourcePath);
            results[results.length - 1].blurHash = blurHash;
          } catch (err) {
            logger.warn({ err, fileId }, 'Failed to generate blur placeholder');
          }
        }
      } catch (err) {
        logger.error({ err, fileId, size: size.name }, 'Failed to generate thumbnail');
        throw err;
      }
    }

    return results;
  }

  async generateVideoThumbnail(
    fileId: string,
    householdId: string,
    sourcePath: string
  ): Promise<ThumbnailResult[]> {
    // For video thumbnails, we'll use a frame extraction approach
    const thumbnailDir = this.getThumbnailDir(householdId, fileId);

    await fs.mkdir(thumbnailDir, { recursive: true });

    // Check if ffmpeg is available by trying to import fluent-ffmpeg
    try {
      const ffmpeg = await import('fluent-ffmpeg');

      // Set ffmpeg path - check config first, then common locations
      const ffmpegPath = config.FFMPEG_PATH ||
        (await this.findExecutable('ffmpeg'));
      const ffprobePath = config.FFPROBE_PATH ||
        (await this.findExecutable('ffprobe'));

      if (ffmpegPath) {
        ffmpeg.default.setFfmpegPath(ffmpegPath);
        logger.debug({ ffmpegPath }, 'Using ffmpeg path');
      }
      if (ffprobePath) {
        ffmpeg.default.setFfprobePath(ffprobePath);
      }

      // Extract a frame at 10% of the video
      const tempFramePath = path.join(thumbnailDir, 'temp_frame.jpg');

      logger.debug({ fileId, sourcePath, thumbnailDir }, 'Generating video thumbnail');

      await new Promise<void>((resolve, reject) => {
        ffmpeg.default(sourcePath)
          .on('start', (cmd: string) => {
            logger.debug({ cmd }, 'ffmpeg command started');
          })
          .on('error', (err: Error) => {
            logger.error({ err, fileId, sourcePath }, 'ffmpeg error during video thumbnail');
            reject(err);
          })
          .on('end', () => {
            logger.debug({ fileId }, 'ffmpeg screenshot extraction completed');
            resolve();
          })
          .screenshots({
            timestamps: ['10%'],
            filename: 'temp_frame.jpg',
            folder: thumbnailDir,
            size: '1280x?',
          });
      });

      // Verify the temp frame was created
      try {
        await fs.access(tempFramePath);
      } catch {
        logger.error({ fileId, tempFramePath }, 'Temp frame was not created');
        return [];
      }

      // Now generate thumbnails from the extracted frame
      const results = await this.generateImageThumbnails(fileId, householdId, tempFramePath);

      // Clean up temp frame
      await fs.unlink(tempFramePath).catch(() => {});

      return results;
    } catch (err) {
      logger.error({ err, fileId, sourcePath }, 'Failed to generate video thumbnail');
      // Return empty results if ffmpeg is not available
      return [];
    }
  }

  private async findExecutable(name: string): Promise<string | undefined> {
    const { execSync } = await import('child_process');
    try {
      const result = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
      return result || undefined;
    } catch {
      // Try common paths
      const commonPaths = [
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
        `/usr/bin/${name}`,
      ];
      for (const p of commonPaths) {
        try {
          await fs.access(p);
          return p;
        } catch {
          continue;
        }
      }
      return undefined;
    }
  }

  private async generateBlurPlaceholder(sourcePath: string): Promise<string> {
    const sharp = await loadSharp();
    // Generate a tiny blurred version as a base64 data URL
    const tiny = await sharp(sourcePath)
      .resize(16, 16, { fit: 'inside' })
      .blur(5)
      .toBuffer();

    return `data:image/webp;base64,${tiny.toString('base64')}`;
  }

  async saveThumbnails(fileId: string, results: ThumbnailResult[]): Promise<void> {
    for (const result of results) {
      // Skip blur hash if too long for database column (varchar 100)
      const blurHash = result.blurHash && result.blurHash.length <= 100
        ? result.blurHash
        : undefined;

      await db
        .insert(thumbnails)
        .values({
          fileId,
          size: result.size,
          width: result.width,
          height: result.height,
          storagePath: result.storagePath,
          blurHash,
        })
        .onConflictDoNothing();
    }
  }

  async getThumbnails(fileId: string): Promise<typeof thumbnails.$inferSelect[]> {
    return db.query.thumbnails.findMany({
      where: eq(thumbnails.fileId, fileId),
    });
  }

  async getThumbnail(
    fileId: string,
    size: 'sm' | 'md' | 'lg'
  ): Promise<typeof thumbnails.$inferSelect | null> {
    const result = await db.query.thumbnails.findFirst({
      where: (t, { and, eq: equals }) =>
        and(equals(t.fileId, fileId), equals(t.size, size)),
    });
    return result || null;
  }

  async deleteThumbnails(fileId: string, householdId: string): Promise<void> {
    // Delete from filesystem
    const thumbnailDir = this.getThumbnailDir(householdId, fileId);
    await fs.rm(thumbnailDir, { recursive: true, force: true }).catch(() => {});

    // Delete from database
    await db.delete(thumbnails).where(eq(thumbnails.fileId, fileId));
  }

  async serveThumbnail(
    fileId: string,
    size: 'sm' | 'md' | 'lg'
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const thumbnail = await this.getThumbnail(fileId, size);
    if (!thumbnail) return null;

    try {
      // Try reading from the stored path directly first
      const buffer = await fs.readFile(thumbnail.storagePath);
      return { buffer, mimeType: 'image/webp' };
    } catch {
      // If that fails, the stored path may be relative to a different base
      // Try using the thumbnail directory structure from config
      try {
        // Extract the household/file/size.webp part from stored path
        const match = thumbnail.storagePath.match(/thumbnails\/(.+)$/);
        if (match) {
          const relativePart = match[1];
          const fullPath = path.join(this.storagePath, 'thumbnails', relativePart);
          const buffer = await fs.readFile(fullPath);
          return { buffer, mimeType: 'image/webp' };
        }
      } catch {
        // Fall through to return null
      }
      return null;
    }
  }
}

export const thumbnailService = new ThumbnailService();
