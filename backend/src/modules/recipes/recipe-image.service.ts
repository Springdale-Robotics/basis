import { loadSharp } from '../../lib/sharp.js';

const MAX_WIDTH = 800;
const WEBP_QUALITY = 80;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB input limit
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface ProcessedImage {
  data: string;      // base64
  mimeType: string;  // 'image/webp'
  width: number;
  height: number;
}

/**
 * Process a recipe image buffer:
 * - Validate file type
 * - Resize to max 800px width (maintain aspect ratio)
 * - Convert to WebP at quality 80
 * - Strip EXIF metadata for privacy
 * - Return base64 string with dimensions
 */
export async function processRecipeImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_FILE_SIZE) {
    throw new Error('Image file too large. Maximum size is 10MB.');
  }

  const sharp = await loadSharp();

  // Get image metadata to validate format
  const metadata = await sharp(input).metadata();

  if (!metadata.format) {
    throw new Error('Unable to determine image format');
  }

  const mimeType = `image/${metadata.format}`;
  if (!ALLOWED_MIME_TYPES.includes(mimeType) && metadata.format !== 'jpg') {
    throw new Error(`Unsupported image format: ${metadata.format}. Allowed formats: JPEG, PNG, WebP, GIF.`);
  }

  // Process the image
  let pipeline = sharp(input)
    .rotate() // Auto-rotate based on EXIF orientation, then strip EXIF
    .withMetadata({ orientation: undefined }); // Strip EXIF metadata

  // Resize if wider than MAX_WIDTH
  if (metadata.width && metadata.width > MAX_WIDTH) {
    pipeline = pipeline.resize(MAX_WIDTH, null, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Convert to WebP
  const outputBuffer = await pipeline
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  // Get final dimensions
  const outputMetadata = await sharp(outputBuffer).metadata();

  return {
    data: outputBuffer.toString('base64'),
    mimeType: 'image/webp',
    width: outputMetadata.width || 0,
    height: outputMetadata.height || 0,
  };
}

/**
 * Fetch an image from a URL and return it as a buffer
 */
export async function fetchImageFromUrl(url: string): Promise<Buffer> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Invalid image URL');
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid URL protocol. Only HTTP and HTTPS are supported.');
  }

  // Fetch with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Basis/1.0 (Recipe Image Fetcher)',
        'Accept': 'image/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      throw new Error('URL does not point to an image');
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
      throw new Error('Image file too large. Maximum size is 10MB.');
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}
