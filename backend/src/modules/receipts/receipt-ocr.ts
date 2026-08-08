import { access, open } from 'fs/promises';
import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
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

async function assertReadableImage(imagePath: string): Promise<void> {
  const handle = await open(imagePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, 12, 0);
    const isRecognizedFormat = bytesRead >= 3 && IMAGE_SIGNATURES.some((matches) => matches(header));
    if (!isRecognizedFormat) {
      throw new Error(`Unrecognized image format: ${imagePath}`);
    }
  } finally {
    await handle.close();
  }
}

export async function isOcrAvailable(): Promise<boolean> {
  try {
    const worker = await createReceiptWorker();
    await worker.terminate();
    return true;
  } catch (error) {
    logger.warn({ error }, 'Tesseract worker could not be created');
    return false;
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

  await assertReadableImage(imagePath);

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
        worker.recognize(imagePath, {}, { blocks: true }),
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
