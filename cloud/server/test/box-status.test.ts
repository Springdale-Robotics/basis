import { describe, expect, it } from 'vitest';
import { boxStatusFor } from '../src/modules/boxes/boxes.service.js';

describe('boxStatusFor', () => {
  it('maps the internal lifecycle onto the coarse box contract', () => {
    expect(boxStatusFor('active')).toBe('active');
    // In-grace boxes must not alarm the family.
    expect(boxStatusFor('past_due')).toBe('active');
    expect(boxStatusFor('unpaid')).toBe('suspended');
    expect(boxStatusFor('suspended')).toBe('suspended');
    expect(boxStatusFor('canceled')).toBe('canceled');
  });
});
