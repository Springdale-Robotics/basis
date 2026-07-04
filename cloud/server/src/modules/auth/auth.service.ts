import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { accounts, sessions, type Account } from '../../db/schema/index.js';
import { newSessionId } from '../../lib/tokens.js';
import { config } from '../../config/index.js';

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
