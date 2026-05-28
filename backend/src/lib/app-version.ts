import { promises as fs } from 'fs';
import { resolve as resolvePath } from 'path';
import { config } from '../config/index.js';

let cached: string | undefined;

/**
 * Best-effort current app version, read once from the VERSION file at the
 * deployed version root (.../current/VERSION — two levels above FRONTEND_DIST,
 * which is .../current/frontend/dist). Returns 'dev' when unset and 'unknown'
 * when the file is missing.
 */
export async function getAppVersion(): Promise<string> {
  if (cached !== undefined) return cached;
  if (!config.FRONTEND_DIST) {
    cached = 'dev';
    return cached;
  }
  try {
    const versionFile = resolvePath(config.FRONTEND_DIST, '../../VERSION');
    cached = (await fs.readFile(versionFile, 'utf8')).trim() || 'unknown';
  } catch {
    cached = 'unknown';
  }
  return cached;
}
