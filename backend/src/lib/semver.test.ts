import { describe, it, expect } from 'vitest';
import { compareVersions } from './semver.js';

describe('compareVersions', () => {
  it('orders by numeric core, not lexically', () => {
    // The bug this replaces: string compare ranks "0.1.9" above "0.1.14".
    expect(compareVersions('0.1.14', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.9', '0.1.14')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
  });

  it('treats a v-prefix and whitespace as equal', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions(' 1.2.3 ', '1.2.3')).toBe(0);
  });

  it('ranks a release above its prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
    expect(compareVersions('0.1.14-alpha', '0.1.14')).toBeLessThan(0);
  });

  it('orders prerelease identifiers', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.10')).toBeLessThan(0);
    expect(compareVersions('0.1.14-alpha', '0.1.14-alpha')).toBe(0);
  });

  it('never reports an older tag as an update over a newer alpha', () => {
    // The concrete downgrade scenario: installed 0.1.14-alpha, GitHub top item 0.1.9-alpha.
    expect(compareVersions('0.1.9-alpha', '0.1.14-alpha')).toBeLessThan(0);
  });
});
