import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  newClaimCode,
  newTunnelToken,
  normalizeClaimCode,
  sha256Hex,
} from '../src/lib/tokens.js';

describe('claim codes', () => {
  it('generates XXXX-XXXX-XXXX with an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = newClaimCode();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[01IO]/);
    }
  });

  it('normalizes lowercase / spaced / dashless input to canonical form', () => {
    const code = newClaimCode();
    expect(normalizeClaimCode(code)).toBe(code);
    expect(normalizeClaimCode(code.toLowerCase())).toBe(code);
    expect(normalizeClaimCode(code.replace(/-/g, ''))).toBe(code);
    expect(normalizeClaimCode(` ${code.replace(/-/g, ' ')} `)).toBe(code);
  });

  it('rejects garbage', () => {
    expect(normalizeClaimCode('nope')).toBeNull();
    expect(normalizeClaimCode('AAAA-BBBB-CCC!')).toBeNull();
    expect(normalizeClaimCode('')).toBeNull();
  });
});

describe('tokens', () => {
  it('tunnel tokens are prefixed and unique', () => {
    const a = newTunnelToken();
    const b = newTunnelToken();
    expect(a).toMatch(/^brt_/);
    expect(a).not.toBe(b);
  });

  it('sha256Hex is stable', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('constantTimeEqual compares correctly', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true);
    expect(constantTimeEqual('secret', 'secrex')).toBe(false);
    expect(constantTimeEqual('secret', 'longer-secret')).toBe(false);
  });
});
