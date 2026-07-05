import { afterEach, describe, expect, it, vi } from 'vitest';
import { newResetToken, sha256Hex } from '../src/lib/tokens.js';
import { __setTransportForTests, sendMail } from '../src/lib/email.js';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../src/modules/auth/auth.schema.js';

describe('newResetToken', () => {
  it('is url-safe base64 (base64url) and unique', () => {
    for (let i = 0; i < 50; i++) {
      const token = newResetToken();
      // 32 bytes -> 43 base64url chars, no padding, no +/ characters.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(newResetToken()).not.toBe(newResetToken());
  });

  it('hashes to a 64-char sha256 hex (fits token_hash varchar(64))', () => {
    const hash = sha256Hex(newResetToken());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('email lib', () => {
  afterEach(() => {
    // Reset the transport seam so other tests fall back to the real getter.
    __setTransportForTests(null);
  });

  it('sends through the configured transport', async () => {
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'x' });
    // Minimal Transporter stand-in — only sendMail is exercised.
    __setTransportForTests({ sendMail: sendMailMock } as never);

    await sendMail({ to: 'a@example.com', subject: 'Hi', text: 'Body' });

    expect(sendMailMock).toHaveBeenCalledOnce();
    const arg = sendMailMock.mock.calls[0][0];
    expect(arg.to).toBe('a@example.com');
    expect(arg.subject).toBe('Hi');
    expect(arg.text).toBe('Body');
  });

  it('does not throw when SMTP is unconfigured (log fallback)', async () => {
    __setTransportForTests(null);
    await expect(
      sendMail({ to: 'a@example.com', subject: 'Hi', text: 'link here' }),
    ).resolves.toBeUndefined();
  });
});

describe('reset schemas', () => {
  it('forgotPasswordSchema normalizes email', () => {
    const parsed = forgotPasswordSchema.parse({ email: 'A@Example.COM' });
    expect(parsed.email).toBe('a@example.com');
  });

  it('resetPasswordSchema requires a token and a >=10 char password', () => {
    expect(resetPasswordSchema.safeParse({ token: 't', password: 'short' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: '', password: 'longenough1' }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 'abc', password: 'longenough1' }).success,
    ).toBe(true);
  });
});
