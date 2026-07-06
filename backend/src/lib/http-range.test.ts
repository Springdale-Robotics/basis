import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from './http-range.js';

describe('parseRangeHeader', () => {
  const SIZE = 1000;

  it('returns full when no header', () => {
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: 'full' });
  });

  it('parses a bounded range and clamps the end', () => {
    expect(parseRangeHeader('bytes=0-499', SIZE)).toEqual({
      kind: 'range',
      range: { start: 0, end: 499 },
    });
    expect(parseRangeHeader('bytes=500-99999', SIZE)).toEqual({
      kind: 'range',
      range: { start: 500, end: 999 },
    });
  });

  it('parses an open-ended range', () => {
    expect(parseRangeHeader('bytes=200-', SIZE)).toEqual({
      kind: 'range',
      range: { start: 200, end: 999 },
    });
  });

  it('parses a suffix range (Safari sends these; NaN crash before)', () => {
    expect(parseRangeHeader('bytes=-500', SIZE)).toEqual({
      kind: 'range',
      range: { start: 500, end: 999 },
    });
    // Suffix longer than the file → whole file
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({
      kind: 'range',
      range: { start: 0, end: 999 },
    });
  });

  it('returns unsatisfiable (→416) for out-of-range starts', () => {
    expect(parseRangeHeader('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=5000-6000', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignores malformed headers (serves full, not 500)', () => {
    expect(parseRangeHeader('bytes=abc-def', SIZE)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('items=0-10', SIZE)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=-', SIZE)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=500-100', SIZE)).toEqual({ kind: 'full' });
  });
});
