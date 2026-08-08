import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { transcribeReceipt } from '../../src/modules/receipts/receipt-ocr.js';

// Wraps the real sharp so HEIC conversion still actually runs (needed for the
// "clear error on unsupported codec" test below to be genuine rather than
// mocked), while letting tests assert on whether it was invoked at all —
// which is the pass-through-vs-convert routing this suite needs to prove.
vi.mock('sharp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sharp')>();
  return { default: vi.fn(actual.default) };
});

const workDir = join(tmpdir(), 'basis-receipt-ocr-test');

beforeAll(async () => {
  await mkdir(workDir, { recursive: true });
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('transcribeReceipt', () => {
  it('rejects a path that does not exist', async () => {
    await expect(
      transcribeReceipt(join(workDir, 'missing.jpg'))
    ).rejects.toThrow(/not found|no such file/i);
  });

  it('rejects a file that is not an image', async () => {
    const path = join(workDir, 'notanimage.jpg');
    await writeFile(path, 'this is plain text, not a JPEG');

    // Note on output cleanliness: this does not reach Tesseract at all.
    // transcribeReceipt sniffs the file's magic bytes and rejects unrecognized
    // formats before creating a worker, specifically because Tesseract's own
    // decode-failure path is not quiet — its WASM core runs inside a
    // worker_threads.Worker with its own console/stdio, so its diagnostics
    // write straight to the process's inherited stderr and cannot be caught
    // or silenced from this thread (a console.error spy here has no effect
    // on another thread's console). See receipt-ocr.ts's resolveRecognitionInput.
    await expect(transcribeReceipt(path)).rejects.toThrow();
  });

  it('does not re-encode a format Tesseract already reads', async () => {
    vi.mocked(sharp).mockClear();
    await transcribeReceipt(join(__dirname, 'fixtures', 'sample-receipt.jpg'));
    expect(sharp).not.toHaveBeenCalled();
  });

  it('routes a HEIC file through sharp instead of rejecting it outright', async () => {
    vi.mocked(sharp).mockClear();
    const heicPath = join(__dirname, 'fixtures', 'sample-receipt.heic');

    // What "success" looks like here is genuinely environment-dependent, and
    // that's the point of asserting both branches rather than picking one:
    // sharp's own prebuilt npm binary ships without an HEVC decoder (a
    // documented licensing constraint upstream — see lovell/sharp#3680,
    // #4050, #4132 — confirmed directly against this exact fixture before
    // writing this test: `sharp(...).jpeg().toBuffer()` throws "No decoding
    // plugin installed for this compression format"). So on a standard
    // install, real iPhone-shot HEIC/HEVC hits the clear-error branch below,
    // not silent success — that is expected today, not a bug in this test.
    // What must always be true, on any install: the byte-level HEIF
    // detection routes real 'heic'-branded bytes into sharp at all (proving
    // it isn't misclassified as "unrecognized format" the way it would have
    // been before this fix), and if conversion fails, the failure is our
    // clear, named error — never Tesseract's opaque one.
    try {
      const result = await transcribeReceipt(heicPath);
      expect(result.rawText.length).toBeGreaterThan(0);
    } catch (error) {
      expect((error as Error).message).toMatch(/HEIC|HEIF/i);
    }

    expect(sharp).toHaveBeenCalledWith(heicPath);
  });
});

// Accuracy check against a real receipt image. Skipped by default: it
// downloads a ~2MB language model on first run and its output depends on the
// tesseract build. Run deliberately with RUN_OCR_ACCURACY=1.
describe.skipIf(!process.env.RUN_OCR_ACCURACY)('transcribeReceipt accuracy', () => {
  it('reads lines off a sample receipt', async () => {
    const result = await transcribeReceipt(
      join(__dirname, 'fixtures', 'sample-receipt.jpg')
    );
    expect(result.rawText.length).toBeGreaterThan(20);
    expect(result.lines.length).toBeGreaterThan(3);
    for (const line of result.lines) {
      expect(line.confidence).toBeGreaterThanOrEqual(0);
      expect(line.confidence).toBeLessThanOrEqual(1);
    }
  }, 120000);
});
