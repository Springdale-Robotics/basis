import { describe, expect, it } from 'vitest';
import { validateSubdomainFormat } from '../src/lib/reserved-subdomains.js';

describe('validateSubdomainFormat', () => {
  it.each(['smith', 'the-smiths', 'abc', 'a1b2c3', 'x'.repeat(30)])(
    'accepts %s',
    (name) => {
      expect(validateSubdomainFormat(name)).toBeNull();
    }
  );

  it.each([
    ['ab', 'too short'],
    ['x'.repeat(31), 'too long'],
    ['-smith', 'leading hyphen'],
    ['smith-', 'trailing hyphen'],
    ['sm--ith', 'double hyphen'],
    ['Smith', 'uppercase'],
    ['smith.jones', 'dot'],
    ['smith_jones', 'underscore'],
    ['smïth', 'non-ascii'],
  ])('rejects %s (%s)', (name) => {
    expect(validateSubdomainFormat(name)).toBe('invalid_format');
  });

  it.each(['www', 'api', 'admin', 'mail', 'billing', 'basis', 'relay'])(
    'rejects reserved name %s',
    (name) => {
      expect(validateSubdomainFormat(name)).toBe('reserved');
    }
  );

  it('rejects punycode prefixes', () => {
    expect(validateSubdomainFormat('xn--mnchen-3ya')).toBe('punycode');
  });
});
