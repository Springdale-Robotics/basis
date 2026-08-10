import { describe, expect, it } from 'vitest';
import {
  parseStructuredResponse,
  attachConfidences,
} from '../../src/modules/receipts/receipt-structurer.js';

const COSTCO_RESPONSE = JSON.stringify({
  merchant: 'Costco Wholesale',
  purchased_at: '2026-08-01',
  lines: [
    { raw_text: '1234567 KS ORG EVOO', code: '1234567', count: 1, price: 21.99 },
    { raw_text: '96253 ORG SPNCH', code: '96253', count: 2, price: 7.98 },
  ],
});

describe('parseStructuredResponse', () => {
  it('maps snake_case model output to our shape', () => {
    const result = parseStructuredResponse(COSTCO_RESPONSE);
    expect(result.merchant).toBe('Costco Wholesale');
    expect(result.purchasedAt).toBe('2026-08-01');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]).toMatchObject({
      rawText: '96253 ORG SPNCH',
      code: '96253',
      count: 2,
      price: 7.98,
    });
  });

  it('tolerates a model that wraps JSON in prose or fences', () => {
    const wrapped = 'Here you go:\n```json\n' + COSTCO_RESPONSE + '\n```';
    expect(parseStructuredResponse(wrapped).lines).toHaveLength(2);
  });

  it('defaults a missing count to 1', () => {
    const result = parseStructuredResponse(
      JSON.stringify({ lines: [{ raw_text: 'BANANAS' }] })
    );
    expect(result.lines[0].count).toBe(1);
    expect(result.lines[0].code).toBeNull();
    expect(result.lines[0].price).toBeNull();
  });

  it('drops lines with no usable text rather than inventing one', () => {
    const result = parseStructuredResponse(
      JSON.stringify({ lines: [{ raw_text: '' }, { raw_text: '  ' }, { raw_text: 'MILK' }] })
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].rawText).toBe('MILK');
  });

  it('rejects a response with no lines array', () => {
    expect(() => parseStructuredResponse('{"merchant":"Costco"}')).toThrow(
      /lines/i
    );
  });

  it('rejects unparseable output', () => {
    expect(() => parseStructuredResponse('the model apologised')).toThrow();
  });

  it('rejects a negative count', () => {
    expect(() =>
      parseStructuredResponse(JSON.stringify({ lines: [{ raw_text: 'X', count: -2 }] }))
    ).toThrow(/count/i);
  });

  it('nulls an unparseable purchase date and warns instead of failing the whole receipt', () => {
    const result = parseStructuredResponse(
      JSON.stringify({
        merchant: 'Costco',
        purchased_at: 'not a real date',
        lines: [{ raw_text: 'MILK' }, { raw_text: 'EGGS' }],
      })
    );

    // The lines survive — a garbage date must not discard correctly-parsed
    // product lines.
    expect(result.lines).toHaveLength(2);
    expect(result.purchasedAt).toBeNull();
    expect(result.purchasedAtWarning).toMatch(/date/i);
  });

  it('leaves purchasedAtWarning null for a well-formed date', () => {
    const result = parseStructuredResponse(COSTCO_RESPONSE);
    expect(result.purchasedAtWarning).toBeNull();
  });

  it('leaves purchasedAtWarning null when no date was given at all', () => {
    const result = parseStructuredResponse(
      JSON.stringify({ lines: [{ raw_text: 'MILK' }] })
    );
    expect(result.purchasedAt).toBeNull();
    expect(result.purchasedAtWarning).toBeNull();
  });
});

describe('attachConfidences', () => {
  it('carries the OCR confidence of the line the text came from', () => {
    const structured = parseStructuredResponse(COSTCO_RESPONSE);
    const lines = attachConfidences(structured, [
      { text: '1234567 KS ORG EVOO', confidence: 0.91 },
      { text: '96253 ORG SPNCH', confidence: 0.44 },
    ]);
    expect(lines[0].ocrConfidence).toBe(0.91);
    expect(lines[1].ocrConfidence).toBe(0.44);
  });

  it('matches loosely so minor reformatting still joins', () => {
    const structured = parseStructuredResponse(COSTCO_RESPONSE);
    const lines = attachConfidences(structured, [
      { text: '1234567  KS  ORG  EVOO', confidence: 0.88 },
      { text: '96253 ORG SPNCH', confidence: 0.5 },
    ]);
    expect(lines[0].ocrConfidence).toBe(0.88);
  });

  it('leaves confidence null when no transcribed line corresponds', () => {
    const structured = parseStructuredResponse(COSTCO_RESPONSE);
    const lines = attachConfidences(structured, [
      { text: 'TOTAL 29.97', confidence: 0.99 },
    ]);
    expect(lines[0].ocrConfidence).toBeNull();
  });

  it('gives each duplicate line its own transcription confidence', () => {
    // Buying the same product twice prints two lines, each scanning at whatever
    // confidence that impression happened to get. A single-value-per-text join
    // would hand both lines the last one's confidence.
    const structured = parseStructuredResponse(
      JSON.stringify({
        lines: [{ raw_text: 'MILK' }, { raw_text: 'MILK' }],
      })
    );
    const lines = attachConfidences(structured, [
      { text: 'MILK', confidence: 0.95 },
      { text: 'MILK', confidence: 0.31 },
    ]);
    expect(lines[0].ocrConfidence).toBe(0.95);
    expect(lines[1].ocrConfidence).toBe(0.31);
  });

  it('leaves the surplus duplicate null rather than reusing a confidence', () => {
    const structured = parseStructuredResponse(
      JSON.stringify({
        lines: [{ raw_text: 'MILK' }, { raw_text: 'MILK' }],
      })
    );
    const lines = attachConfidences(structured, [{ text: 'MILK', confidence: 0.95 }]);
    expect(lines[0].ocrConfidence).toBe(0.95);
    expect(lines[1].ocrConfidence).toBeNull();
  });
});
