import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transcribeReceipt } from '../../src/modules/receipts/receipt-ocr.js';

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
    await expect(transcribeReceipt(path)).rejects.toThrow();
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
