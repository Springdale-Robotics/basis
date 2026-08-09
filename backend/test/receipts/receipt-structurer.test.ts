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
});
