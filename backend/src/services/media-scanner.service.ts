import * as fs from 'fs/promises';
import * as path from 'path';
import { db } from '../config/database.js';
import {
  files,
  movies,
  tvShows,
  tvEpisodes,
  artists,
  musicAlbums,
  tracks,
  mediaSettings,
} from '../db/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { queueMediaProcessing } from '../jobs/index.js';

// File type detection
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];

// TV show filename patterns
const TV_PATTERNS = [
  /^(.+?)[\s._-]+[Ss](\d+)[Ee](\d+)/,         // ShowName S01E01
  /^(.+?)[\s._-]+(\d+)x(\d+)/,                 // ShowName 1x01
  /^(.+?)[\s._-]+[Ss]eason[\s._-]*(\d+)[\s._-]+[Ee]pisode[\s._-]*(\d+)/i, // Season 1 Episode 1
];

// Movie filename patterns
const MOVIE_YEAR_PATTERN = /^(.+?)[\s._-]+\(?\d{4}\)?/;

export interface ScanResult {
  newFiles: number;
  processedFiles: number;
  errors: string[];
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  type: 'photo' | 'video' | 'music' | 'document';
  mimeType: string;
}

export class MediaScannerService {
  private storagePath: string;

  constructor() {
    this.storagePath = config.STORAGE_PATH;
  }

  async scanLibrary(householdId: string): Promise<ScanResult> {
    const result: ScanResult = {
      newFiles: 0,
      processedFiles: 0,
      errors: [],
    };

    try {
      // Scan each media type folder
      for (const type of ['photos', 'videos', 'music', 'documents']) {
        const folderPath = path.join(this.storagePath, type, householdId);

        try {
          await fs.access(folderPath);
          const folderResult = await this.scanFolder(householdId, folderPath, type);
          result.newFiles += folderResult.newFiles;
          result.processedFiles += folderResult.processedFiles;
          result.errors.push(...folderResult.errors);
        } catch {
          // Folder doesn't exist, skip
          continue;
        }
      }

      // Update last scan time
      await this.updateLastScanTime(householdId);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, householdId }, 'Library scan failed');
      result.errors.push(`Scan failed: ${errorMessage}`);
    }

    return result;
  }

  private async scanFolder(
    householdId: string,
    folderPath: string,
    type: string
  ): Promise<ScanResult> {
    const result: ScanResult = {
      newFiles: 0,
      processedFiles: 0,
      errors: [],
    };

    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subResult = await this.scanFolder(
            householdId,
            path.join(folderPath, entry.name),
            type
          );
          result.newFiles += subResult.newFiles;
          result.processedFiles += subResult.processedFiles;
          result.errors.push(...subResult.errors);
        } else if (entry.isFile()) {
          try {
            const filePath = path.join(folderPath, entry.name);
            const ext = path.extname(entry.name).toLowerCase();

            // Check if file is already tracked
            const existingFile = await db.query.files.findFirst({
              where: and(
                eq(files.householdId, householdId),
                eq(files.storagePath, filePath)
              ),
            });

            if (!existingFile) {
              // Get file info
              const stat = await fs.stat(filePath);
              const mimeType = this.getMimeType(ext);
              const fileType = this.getFileType(ext);

              if (fileType) {
                // Create file record
                const [newFile] = await db
                  .insert(files)
                  .values({
                    householdId,
                    uploadedBy: householdId, // System upload
                    filename: entry.name,
                    storagePath: filePath,
                    mimeType,
                    sizeBytes: stat.size,
                    type: fileType,
                  })
                  .returning();

                // Queue media processing
                await queueMediaProcessing(newFile.id, householdId, filePath, mimeType);

                // Auto-match video files
                if (fileType === 'video') {
                  await this.autoMatchVideo(newFile.id, householdId, entry.name);
                }

                // Auto-match audio files
                if (fileType === 'music') {
                  await this.autoMatchAudio(newFile.id, householdId, entry.name);
                }

                result.newFiles++;
              }
            }

            result.processedFiles++;
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            result.errors.push(`Failed to process ${entry.name}: ${errorMessage}`);
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Failed to scan ${folderPath}: ${errorMessage}`);
    }

    return result;
  }

  private async autoMatchVideo(fileId: string, householdId: string, filename: string): Promise<void> {
    // Try to match TV show pattern
    for (const pattern of TV_PATTERNS) {
      const match = filename.match(pattern);
      if (match) {
        const [, showName, seasonStr, episodeStr] = match;
        const cleanShowName = this.cleanTitle(showName);
        const seasonNumber = parseInt(seasonStr, 10);
        const episodeNumber = parseInt(episodeStr, 10);

        // Find or create TV show
        let show = await db.query.tvShows.findFirst({
          where: and(
            eq(tvShows.householdId, householdId),
            sql`LOWER(${tvShows.name}) = LOWER(${cleanShowName})`
          ),
        });

        if (!show) {
          const [newShow] = await db
            .insert(tvShows)
            .values({
              householdId,
              name: cleanShowName,
            })
            .returning();
          show = newShow;
        }

        // Create episode
        await db
          .insert(tvEpisodes)
          .values({
            showId: show.id,
            fileId,
            seasonNumber,
            episodeNumber,
          })
          .onConflictDoNothing();

        return;
      }
    }

    // If not a TV show, treat as movie
    const movieMatch = filename.match(MOVIE_YEAR_PATTERN);
    const title = movieMatch ? this.cleanTitle(movieMatch[1]) : this.cleanTitle(path.parse(filename).name);

    await db
      .insert(movies)
      .values({
        fileId,
        householdId,
        title,
      })
      .onConflictDoNothing();
  }

  private async autoMatchAudio(fileId: string, householdId: string, filename: string): Promise<void> {
    // For now, just create a track with the filename as title
    // Music metadata service will fill in the details later
    const title = this.cleanTitle(path.parse(filename).name);

    await db
      .insert(tracks)
      .values({
        fileId,
        title,
      })
      .onConflictDoNothing();
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\s*\[.*?\]\s*/, '') // Remove bracketed content at start
      .replace(/\s*\[.*?\]\s*$/, '') // Remove bracketed content at end
      .replace(/^\s*\(.*?\)\s*/, '') // Remove parenthetical content at start
      .trim();
  }

  private getFileType(extension: string): 'photo' | 'video' | 'music' | 'document' | null {
    if (IMAGE_EXTENSIONS.includes(extension)) return 'photo';
    if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
    if (AUDIO_EXTENSIONS.includes(extension)) return 'music';
    return null;
  }

  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.heic': 'image/heic',
      '.heif': 'image/heif',
      '.bmp': 'image/bmp',
      // Videos
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.webm': 'video/webm',
      '.m4v': 'video/x-m4v',
      // Audio
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.wma': 'audio/x-ms-wma',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  private async updateLastScanTime(householdId: string): Promise<void> {
    const existing = await db.query.mediaSettings.findFirst({
      where: eq(mediaSettings.householdId, householdId),
    });

    if (existing) {
      await db
        .update(mediaSettings)
        .set({
          lastScanAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mediaSettings.id, existing.id));
    } else {
      await db.insert(mediaSettings).values({
        householdId,
        lastScanAt: new Date(),
      });
    }
  }

  async getMediaSettings(householdId: string): Promise<typeof mediaSettings.$inferSelect | null> {
    const settings = await db.query.mediaSettings.findFirst({
      where: eq(mediaSettings.householdId, householdId),
    });

    return settings || null;
  }

  async updateMediaSettings(
    householdId: string,
    updates: Partial<{
      enableTmdb: boolean;
      enableMusicbrainz: boolean;
      enableTranscoding: boolean;
      tmdbApiKey: string;
      transcodeProfiles: string[];
      autoScanEnabled: boolean;
      autoScanInterval: number;
    }>
  ): Promise<typeof mediaSettings.$inferSelect> {
    const existing = await db.query.mediaSettings.findFirst({
      where: eq(mediaSettings.householdId, householdId),
    });

    if (existing) {
      const [updated] = await db
        .update(mediaSettings)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(mediaSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(mediaSettings)
        .values({
          householdId,
          ...updates,
        })
        .returning();
      return created;
    }
  }
}

export const mediaScannerService = new MediaScannerService();
