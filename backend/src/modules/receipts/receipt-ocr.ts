import { access, open } from 'fs/promises';
import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import sharp from 'sharp';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

/**
 * Receipts are dense printed text, which is Tesseract's home turf and not
 * what the image-parse VLM was built for. A captioning model asked to read 40
 * receipt lines invents plausible ones; here a hallucinated line would become
 * wrong stock, so transcription is deterministic and the LLM only ever sees
 * text Tesseract actually read.
 *
 * This module knows nothing about receipts as a domain — no parsing, no
 * line-item logic. It turns an image path into transcribed text and hands
 * the result back.
 */

export interface TranscribedLine {
  text: string;
  /** 0–1. Tesseract reports 0–100; normalized here. */
  confidence: number;
}

export interface TranscriptionResult {
  rawText: string;
  lines: TranscribedLine[];
  processingTimeMs: number;
}

// tesseract.js@7's worker rejects the failing job's promise correctly, but
// *also* unconditionally re-throws inside its internal message handler
// unless an `errorHandler` is supplied — without one, a corrupt/non-image
// input crashes the process with an uncaught exception instead of just
// rejecting `recognize()`. Swallow it here; the rejection is all we need.
const workerOptions = {
  errorHandler: (error: unknown) => {
    logger.debug({ error }, 'Tesseract worker reported a recognition error');
  },
};

function createReceiptWorker(): Promise<Worker> {
  return createWorker(config.RECEIPT_OCR_LANG, undefined, workerOptions);
}

// Tesseract's decode failures are not a clean rejection: the WASM core runs
// inside a worker_threads.Worker with its own console/stdio, so its printErr
// output (bound to that thread's console.error) writes straight to the
// process's inherited stderr fd — it cannot be caught or silenced from here,
// including by spying on this thread's `console.error`. Sniffing the file's
// magic bytes ourselves and rejecting unrecognized formats up front means we
// simply never hand Tesseract something it would choke on, so the decoder
// (and its stderr chatter) is never invoked for that case.
const IMAGE_SIGNATURES: Array<(header: Buffer) => boolean> = [
  (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, // JPEG
  (h) => h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47, // PNG
  (h) => h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46, // GIF
  (h) => h[0] === 0x42 && h[1] === 0x4d, // BMP
  (h) => h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2a && h[3] === 0x00, // TIFF (little-endian)
  (h) => h[0] === 0x4d && h[1] === 0x4d && h[2] === 0x00 && h[3] === 0x2a, // TIFF (big-endian)
  (h) => h.toString('ascii', 0, 4) === 'RIFF' && h.toString('ascii', 8, 12) === 'WEBP', // WebP
];

// HEIC/HEIF (what iPhones shoot by default — the primary capture path this
// feature exists for) is an ISO-BMFF container Leptonica cannot decode at
// all. It is detected separately from IMAGE_SIGNATURES above because it
// isn't read directly: it's read as a box structure, not a fixed magic
// number, and it must be *converted* rather than passed through.
//
// Box layout: bytes 0-3 are the `ftyp` box's own size (irrelevant here),
// bytes 4-7 are the literal ASCII box type "ftyp", and bytes 8-11 are the
// four-character major brand. A 12-byte header is exactly enough to read
// both — confirmed against a real HEIC file (see
// test/receipts/fixtures/sample-receipt.heic): its major brand sits at
// exactly those offsets.
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs',
]);

function isHeifBrand(header: Buffer, bytesRead: number): boolean {
  if (bytesRead < 12) return false;
  if (header.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIF_BRANDS.has(header.toString('ascii', 8, 12));
}

async function readHeader(imagePath: string): Promise<{ header: Buffer; bytesRead: number }> {
  const handle = await open(imagePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    return { header, bytesRead };
  } finally {
    await handle.close();
  }
}

// Decides what to feed `worker.recognize()`. Formats Tesseract already reads
// pass through completely untouched — the original path string, no re-encode
// (no generational loss on an already-clean JPEG). HEIC/HEIF is converted to
// a JPEG buffer with sharp, which tesseract.js accepts directly (no temp
// file). Anything matching no known signature is rejected here, before a
// worker is ever created — that's what keeps the "not an image" test's
// output pristine (see the comment on workerOptions above): Tesseract's own
// decode-failure path is never reached for unrecognized input.
async function resolveRecognitionInput(imagePath: string): Promise<string | Buffer> {
  const { header, bytesRead } = await readHeader(imagePath);

  if (bytesRead >= 3 && IMAGE_SIGNATURES.some((matches) => matches(header))) {
    return imagePath;
  }

  if (isHeifBrand(header, bytesRead)) {
    try {
      return await sharp(imagePath).jpeg().toBuffer();
    } catch (error) {
      // Don't fall through to Tesseract on a failed conversion — that would
      // reproduce exactly the confusing, unsuppressable WASM stderr failure
      // this format check exists to avoid. Name the format so the caller
      // (and whoever's debugging a 500) isn't left guessing.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`HEIC/HEIF image could not be converted for OCR: ${imagePath} (${message})`);
    }
  }

  throw new Error(`Unrecognized image format: ${imagePath}`);
}

// isStructurerAvailable (receipt-structurer.ts) bounds its probe the same
// way. This one is about to sit on a page-load path (the inventory page's
// capability check) rather than only ever running from a worker, so a hung
// worker init — unlike transcribeReceipt's recognize() call, this has no
// bound of its own — must not hang that request.
const OCR_AVAILABILITY_TIMEOUT_MS = 5000;

export async function isOcrAvailable(): Promise<boolean> {
  let timedOut = false;
  const workerPromise = createReceiptWorker();

  try {
    const worker = await Promise.race([
      workerPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(new Error(`Tesseract worker init timed out after ${OCR_AVAILABILITY_TIMEOUT_MS}ms`));
        }, OCR_AVAILABILITY_TIMEOUT_MS);
      }),
    ]);
    await worker.terminate();
    return true;
  } catch (error) {
    logger.warn({ error }, 'Tesseract worker could not be created');
    return false;
  } finally {
    // The race above abandons workerPromise on a timeout, not the worker
    // init itself — if it eventually resolves, terminate it rather than
    // leaking a worker thread. (On the non-timeout path the worker was
    // already terminated above; this is a no-op there.)
    if (timedOut) {
      workerPromise.then((w) => w.terminate()).catch(() => {});
    }
  }
}

function normalizeConfidence(raw: unknown): number {
  const value = Number(raw ?? 0) / 100;
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Flatten tesseract.js's block > paragraph > line hierarchy (only populated
// when `recognize` is asked for `output: { blocks: true }`) into the flat
// per-line shape callers want.
function extractLines(data: {
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ text?: string; confidence?: number }> }> }> | null;
  text?: string;
  confidence?: number;
}): TranscribedLine[] {
  const blockLines = (data.blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? [])
  );

  if (blockLines.length > 0) {
    return blockLines
      .map((line) => ({
        text: String(line.text ?? '').trim(),
        confidence: normalizeConfidence(line.confidence),
      }))
      .filter((line) => line.text.length > 0);
  }

  // Fallback so callers always get a line list even if per-line data is
  // unavailable (e.g. blocks output not populated). Every line shares the
  // page-level confidence, which is coarser than real per-line data.
  const rawText = (data.text ?? '').trim();
  const pageConfidence = normalizeConfidence(data.confidence);
  return rawText
    .split('\n')
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ text, confidence: pageConfidence }));
}

export async function transcribeReceipt(imagePath: string): Promise<TranscriptionResult> {
  try {
    await access(imagePath);
  } catch {
    throw new Error(`Receipt image not found: ${imagePath}`);
  }

  const recognitionInput = await resolveRecognitionInput(imagePath);

  const startTime = Date.now();
  const worker = await createReceiptWorker();

  try {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Tesseract OCR timed out after ${config.RECEIPT_OCR_TIMEOUT_MS}ms`));
      }, config.RECEIPT_OCR_TIMEOUT_MS);
    });

    // A genuine bound on the call: if recognize() never settles, the timeout
    // promise wins the race and this function returns/throws on schedule.
    // The `finally` below still terminates the worker either way, which is
    // what actually kills the in-flight recognition on a timeout.
    let data;
    try {
      const result = await Promise.race([
        worker.recognize(recognitionInput, {}, { blocks: true }),
        timeoutPromise,
      ]);
      data = result.data;
    } finally {
      clearTimeout(timeoutHandle!);
    }

    const rawText = (data.text ?? '').trim();
    if (rawText.length === 0) {
      throw new Error('Tesseract produced no text — the image may be unreadable');
    }

    const lines = extractLines(data);
    const processingTimeMs = Date.now() - startTime;
    logger.info({ imagePath, lineCount: lines.length, processingTimeMs }, 'Receipt transcribed');

    return { rawText, lines, processingTimeMs };
  } finally {
    await worker.terminate();
  }
}
