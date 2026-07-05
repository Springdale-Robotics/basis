import argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  accounts,
  passwordResetTokens,
  sessions,
  type Account,
} from '../../db/schema/index.js';
import { newResetToken, newSessionId, sha256Hex } from '../../lib/tokens.js';
import { config } from '../../config/index.js';

/** How long a password-reset token is valid. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface SessionInfo {
  id: string;
  expiresAt: Date;
}

export async function createAccount(
  email: string,
  password: string
): Promise<Account | 'email_taken'> {
  const existing = await db.query.accounts.findFirst({
    where: eq(accounts.email, email),
  });
  if (existing) return 'email_taken';

  const passwordHash = await argon2.hash(password);
  const [account] = await db
    .insert(accounts)
    .values({ email, passwordHash })
    .returning();
  return account;
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<Account | null> {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.email, email),
  });
  if (!account) {
    // Burn comparable time so response timing doesn't reveal account existence.
    await argon2
      .verify(
        '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        password
      )
      .catch(() => undefined);
    return null;
  }
  const ok = await argon2.verify(account.passwordHash, password).catch(() => false);
  return ok ? account : null;
}

export async function createSession(
  accountId: string,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<SessionInfo> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + config.SESSION_MAX_AGE_MS);
  await db.insert(sessions).values({
    id,
    accountId,
    expiresAt,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent?.slice(0, 500),
  });
  return { id, expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Issue a password-reset token for the account with `email`. Returns the
 * plaintext token (to email) and the account, or null when no account exists
 * — callers MUST NOT reveal which case occurred. Any prior unused tokens for
 * the account are invalidated first, so only the newest link works.
 */
export async function createPasswordResetToken(
  email: string,
): Promise<{ token: string; account: Account } | null> {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.email, email),
  });
  if (!account) return null;

  // Invalidate any outstanding unused tokens for this account.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.accountId, account.id),
        isNull(passwordResetTokens.usedAt),
      ),
    );

  const token = newResetToken();
  await db.insert(passwordResetTokens).values({
    accountId: account.id,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  return { token, account };
}

export type ResetResult = 'ok' | 'invalid' | 'expired';

/**
 * Consume a reset token and set a new password. On success the account's
 * argon2 hash is replaced, the token is marked used, and ALL of the account's
 * sessions are revoked (forcing a fresh sign-in everywhere).
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const tokenHash = sha256Hex(token);
  const record = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, tokenHash),
  });
  if (!record || record.usedAt) return 'invalid';
  if (record.expiresAt.getTime() <= Date.now()) return 'expired';

  const passwordHash = await argon2.hash(newPassword);
  await db
    .update(accounts)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(accounts.id, record.accountId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));
  await db.delete(sessions).where(eq(sessions.accountId, record.accountId));

  return 'ok';
}
