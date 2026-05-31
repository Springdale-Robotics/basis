import type SharpNamespace from 'sharp';
import { logger } from './logger.js';

type SharpFactory = typeof SharpNamespace;

let cached: SharpFactory | null = null;
let available = false;

/**
 * Lazily load the native `sharp` module.
 *
 * Image processing is an OPTIONAL subsystem. sharp ships its native binary in
 * platform-specific packages (`@img/sharp-linux-*`); if those are missing or
 * broken — e.g. an update installed deps with `--omit=optional`, or the disk
 * took damage on an unclean power-off — a top-level `import sharp from 'sharp'`
 * throws at module load and crashes the entire backend on boot. That in turn
 * takes down remote access (the Cloudflare tunnel is a child of the backend),
 * which is exactly the failure we never want on an unattended box.
 *
 * Loading sharp lazily, on first use, contains that blast radius: a missing
 * binary degrades only image features (recipe images, photo thumbnails, EXIF)
 * while the rest of the app — including remote access — keeps running.
 */
export async function loadSharp(): Promise<SharpFactory> {
  if (cached) return cached;
  try {
    const mod = await import('sharp');
    cached = mod.default;
    available = true;
    return cached;
  } catch (err) {
    available = false;
    logger.error(
      { err },
      'sharp native module failed to load — image processing (recipe images, thumbnails, EXIF) is unavailable. Reinstall backend deps WITHOUT --omit=optional.',
    );
    throw new Error('Image processing is unavailable on this server (the sharp image library failed to load).');
  }
}

/** True only after a successful {@link loadSharp}. */
export function isSharpAvailable(): boolean {
  return available;
}

/**
 * Best-effort startup probe. Never throws — logs a clear warning if sharp can't
 * load so the problem is visible in the journal immediately (and remotely),
 * rather than only surfacing when a user first uploads an image.
 */
export async function probeSharp(): Promise<boolean> {
  try {
    await loadSharp();
    logger.info('sharp image library loaded — image processing available');
    return true;
  } catch {
    return false;
  }
}
