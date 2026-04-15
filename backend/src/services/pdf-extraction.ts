/**
 * Extract text content from a PDF buffer.
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // Dynamic import since pdf-parse has CommonJS issues with ESM
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  return data.text;
}
