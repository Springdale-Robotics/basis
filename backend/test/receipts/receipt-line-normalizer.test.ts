import { describe, expect, it } from 'vitest';
import {
  stripLineNoise,
  expandAbbreviations,
  normalizeReceiptLine,
} from '../../src/modules/receipts/receipt-line-normalizer.js';

describe('stripLineNoise', () => {
  it('pulls a leading Costco item number off the line', () => {
    expect(stripLineNoise('1234567 KS ORG EVOO')).toEqual({
      text: 'KS ORG EVOO',
      code: '1234567',
    });
  });

  it('returns a null code when the merchant prints none', () => {
    expect(stripLineNoise('ORGANIC SPINACH')).toEqual({
      text: 'ORGANIC SPINACH',
      code: null,
    });
  });

  it('strips a trailing tax flag', () => {
    expect(stripLineNoise('1234567 KS ORG EVOO A').text).toBe('KS ORG EVOO');
    expect(stripLineNoise('BANANAS E').text).toBe('BANANAS');
  });

  it('does not mistake a short numeric run for an item code', () => {
    // "2%" milk and similar must survive; codes are 5+ digits.
    expect(stripLineNoise('2% MILK GALLON')).toEqual({
      text: '2% MILK GALLON',
      code: null,
    });
  });

  it('collapses repeated whitespace', () => {
    expect(stripLineNoise('KS   ORG    EVOO').text).toBe('KS ORG EVOO');
  });
});

describe('expandAbbreviations', () => {
  it('expands a known brand prefix', () => {
    expect(expandAbbreviations('KS ORG EVOO')).toBe(
      'kirkland signature organic extra virgin olive oil'
    );
  });

  it('expands mid-line tokens', () => {
    expect(expandAbbreviations('ORG CHKN BRST')).toBe('organic chicken breast');
  });

  it('leaves unknown tokens alone', () => {
    expect(expandAbbreviations('BANANAS')).toBe('bananas');
  });

  it('only matches whole tokens', () => {
    // "ORGY" must not become "organicY".
    expect(expandAbbreviations('ORGY')).toBe('orgy');
  });
});

describe('normalizeReceiptLine', () => {
  it('turns a raw Costco line into something the matcher can score', () => {
    expect(normalizeReceiptLine('1234567 KS ORG EVOO A')).toBe(
      'kirkland signature extra virgin olive oil'
    );
  });

  it('is stable across the same line read twice', () => {
    const a = normalizeReceiptLine('96253 ORG SPNCH  5OZ E');
    const b = normalizeReceiptLine('96253 ORG SPNCH 5OZ E');
    expect(a).toBe(b);
  });

  it('never returns an empty string for a non-empty line', () => {
    expect(normalizeReceiptLine('1234567 A').length).toBeGreaterThan(0);
  });
});
