/**
 * Extract text content from a PDF buffer.
 *
 * Uses the modern `pdf-parse` class-based API (PDFParse) — the older
 * default-function form was removed in v2 and breaks under ESM.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const { text } = await parser.getText();
    // pdf-parse injects "-- N of M --" page markers in multi-page output.
    // Strip them so they don't leak into the recipe text as instruction noise.
    return (text ?? '').replace(/-- \d+ of \d+ --/g, '').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
