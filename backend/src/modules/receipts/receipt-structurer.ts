import { z } from 'zod';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import type { TranscribedLine } from './receipt-ocr.js';

/**
 * Turns Tesseract's flat transcription into structured lines using the local
 * LLM. The model reorganizes text it was given; it is never shown the image,
 * so it cannot invent a product that was not on the receipt.
 */

export interface StructuredReceiptLine {
  rawText: string;
  code: string | null;
  count: number;
  price: number | null;
  ocrConfidence: number | null;
}

export interface StructuredReceipt {
  merchant: string | null;
  purchasedAt: string | null;
  lines: StructuredReceiptLine[];
}

const PROMPT = `You are parsing a supermarket receipt that has already been transcribed by OCR.

Return ONLY a JSON object, no commentary, with this exact shape:
{
  "merchant": string or null,
  "purchased_at": "YYYY-MM-DD" or null,
  "lines": [
    { "raw_text": string, "code": string or null, "count": number, "price": number or null }
  ]
}

Rules:
- One entry per purchased product line. Copy "raw_text" VERBATIM from the transcription — do not expand abbreviations, do not correct spelling, do not invent products.
- "code" is the merchant's item number when the line begins with one (Costco prints these), otherwise null.
- "count" is how many units were bought. If the receipt does not say, use 1.
- "price" is the amount charged for that line, or null.
- EXCLUDE subtotals, totals, tax lines, payment/card lines, change due, membership numbers, coupon and discount lines, and store address or phone lines.
- If the transcription contains no product lines, return an empty "lines" array.

Transcription:
`;

const responseSchema = z.object({
  merchant: z.string().nullish(),
  purchased_at: z.string().nullish(),
  lines: z.array(
    z.object({
      raw_text: z.string(),
      code: z.string().nullish(),
      count: z.coerce.number().nonnegative({ message: 'count must not be negative' }).nullish(),
      price: z.coerce.number().nullish(),
    })
  ),
});

/** Models wrap JSON in prose or code fences often enough to handle it here. */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);

  throw new Error('LLM response contained no JSON object');
}

export function parseStructuredResponse(json: string): StructuredReceipt {
  const parsed = responseSchema.parse(JSON.parse(extractJsonObject(json)));

  return {
    merchant: parsed.merchant?.trim() || null,
    purchasedAt: parsed.purchased_at?.trim() || null,
    lines: parsed.lines
      .map((line) => ({
        rawText: line.raw_text.trim(),
        code: line.code?.trim() || null,
        count: line.count ?? 1,
        price: line.price ?? null,
        ocrConfidence: null as number | null,
      }))
      .filter((line) => line.rawText.length > 0),
  };
}

/** Loose key so whitespace or case differences still join. */
function confidenceKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Carry each transcribed line's OCR confidence onto the structured line it
 * produced. Used downstream to decide whether a text-keyed learned link is
 * trustworthy enough to auto-resolve.
 */
export function attachConfidences(
  structured: StructuredReceipt,
  transcribed: TranscribedLine[]
): StructuredReceiptLine[] {
  const byKey = new Map(transcribed.map((line) => [confidenceKey(line.text), line.confidence]));

  return structured.lines.map((line) => ({
    ...line,
    ocrConfidence: byKey.get(confidenceKey(line.rawText)) ?? null,
  }));
}

export async function isStructurerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).some((m) => m.name.startsWith(config.OLLAMA_LLM_MODEL.split(':')[0]));
  } catch {
    return false;
  }
}

export async function structureReceipt(rawText: string): Promise<StructuredReceipt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.RECEIPT_STRUCTURE_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_LLM_MODEL,
        prompt: `${PROMPT}${rawText}`,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as { response: string };
    const structured = parseStructuredResponse(data.response);

    logger.info(
      { merchant: structured.merchant, lineCount: structured.lines.length },
      'Receipt structured'
    );

    return structured;
  } finally {
    clearTimeout(timeout);
  }
}
