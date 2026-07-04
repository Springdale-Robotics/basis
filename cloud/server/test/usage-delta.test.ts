import { describe, expect, it } from 'vitest';
import { computeDelta } from '../src/services/usage-meter.service.js';
import { bytesToGb, currentMonthKey } from '../src/modules/usage/usage.service.js';

describe('computeDelta', () => {
  it('returns the increment when counters grow', () => {
    expect(computeDelta(1000, 1500)).toBe(500);
    expect(computeDelta(0, 0)).toBe(0);
  });

  it('treats a backwards counter (frps restart / midnight) as counted-from-zero', () => {
    expect(computeDelta(9_000_000, 250)).toBe(250);
    expect(computeDelta(5, 0)).toBe(0);
  });
});

describe('usage helpers', () => {
  it('bytesToGb rounds to 2dp decimal gigabytes', () => {
    expect(bytesToGb(0)).toBe(0);
    expect(bytesToGb(1e9)).toBe(1);
    expect(bytesToGb(2_505_000_000)).toBe(2.51);
  });

  it('currentMonthKey is first-of-month UTC', () => {
    expect(currentMonthKey(new Date('2026-07-04T23:59:59Z'))).toBe('2026-07-01');
    expect(currentMonthKey(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12-01');
  });
});
