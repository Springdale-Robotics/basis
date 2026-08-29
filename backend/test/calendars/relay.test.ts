import { describe, expect, it } from 'vitest';
import { googleRedirectUri, relayStartUrl } from '../../src/modules/calendars/relay.js';

describe('relay URLs', () => {
  it('uses the one registered Google redirect URI', () => {
    expect(googleRedirectUri()).toBe('https://connect.home-basis.com/oauth/google');
  });

  it('points the pre-flight at the start page', () => {
    expect(relayStartUrl()).toBe('https://connect.home-basis.com/oauth/google/start');
  });

  it('is HTTPS and has no query string — Google requires both', () => {
    const parsed = new URL(googleRedirectUri());
    expect(parsed.protocol).toBe('https:');
    expect(parsed.search).toBe('');
  });
});
