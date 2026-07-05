import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** sha256 hex — used for claim codes and tunnel tokens at rest. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

/** Opaque tunnel token: 32 random bytes, base64url, prefixed for greppability. */
export function newTunnelToken(): string {
  return `brt_${randomBytes(32).toString('base64url')}`;
}

/** Password-reset token: 32 random bytes, base64url. Only its sha256 is stored. */
export function newResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Claim code XXXX-XXXX-XXXX from an unambiguous alphabet (no 0/O/1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newClaimCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

/** Normalize user/box input to the canonical XXXX-XXXX-XXXX form. */
export function normalizeClaimCode(input: string): string | null {
  const bare = input.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{12}$/.test(bare)) return null;
  return `${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8, 12)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
