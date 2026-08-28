import { describe, expect, it } from 'vitest';
import {
  buildCallbackUrl,
  classifyCallback,
  parseStartFragment,
} from '../../relay/lib.js';

describe('parseStartFragment', () => {
  const frag = (r: string, t: string) =>
    `return=${encodeURIComponent(r)}&to=${encodeURIComponent(t)}`;

  it('reads both values out of the fragment', () => {
    const result = parseStartFragment(
      frag('http://192.168.1.152:3000', 'https://accounts.google.com/o/oauth2/v2/auth?x=1')
    );
    expect(result.returnUrl).toBe('http://192.168.1.152:3000');
    expect(result.to).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it('tolerates a leading hash', () => {
    const result = parseStartFragment('#' + frag('http://box.local', 'https://accounts.google.com/x'));
    expect(result.returnUrl).toBe('http://box.local');
  });

  it.each([
    ['', 'empty fragment'],
    ['return=http%3A%2F%2Fbox.local', 'no destination'],
    [frag('', 'https://accounts.google.com/x'), 'empty return'],
    [frag('javascript:alert(1)', 'https://accounts.google.com/x'), 'javascript: return'],
    [frag('//evil.example', 'https://accounts.google.com/x'), 'protocol-relative return'],
    [frag('/settings', 'https://accounts.google.com/x'), 'relative return'],
    [frag('http://box.local', 'http://evil.example/steal'), 'destination is not Google'],
  ])('rejects %s (%s)', (fragment) => {
    expect(() => parseStartFragment(fragment)).toThrow();
  });
});

describe('buildCallbackUrl', () => {
  it('appends the box callback path and passes the query through intact', () => {
    const url = buildCallbackUrl('http://192.168.1.152:3000', '?code=abc%2F123&state=xyz');
    expect(url).toBe(
      'http://192.168.1.152:3000/api/v1/calendars/sync/google/callback?code=abc%2F123&state=xyz'
    );
  });

  it('does not double a trailing slash on the return URL', () => {
    const url = buildCallbackUrl('https://shelden.home-basis.com/', '?code=a&state=b');
    expect(url).toBe(
      'https://shelden.home-basis.com/api/v1/calendars/sync/google/callback?code=a&state=b'
    );
  });

  it('rejects a return URL that is not http(s)', () => {
    expect(() => buildCallbackUrl('javascript:alert(1)', '?code=a')).toThrow();
  });
});

describe('classifyCallback', () => {
  it('recognises a code', () => {
    expect(classifyCallback('?code=abc&state=xyz')).toEqual({ kind: 'code' });
  });

  it('reports the error Google sent', () => {
    const result = classifyCallback('?error=access_denied&state=xyz');
    expect(result.kind).toBe('error');
    expect(result).toHaveProperty('message', expect.stringContaining('access_denied'));
  });

  it('treats a query with neither code nor error as an error', () => {
    expect(classifyCallback('?state=xyz').kind).toBe('error');
  });
});
