import { randomBytes } from 'crypto';
import argon2 from 'argon2';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { appPasswords, users } from '../../db/schema/index.js';
import type { AppPassword } from '../../db/schema/app-passwords.js';
import { logger } from '../../lib/logger.js';

export type AppPasswordScope = 'caldav';

export interface AppPasswordSummary {
  id: string;
  label: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface VerifiedAppPassword {
  userId: string;
  passwordId: string;
}

function toSummary(row: AppPassword): AppPasswordSummary {
  return {
    id: row.id,
    label: row.label,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Generate a new app password. The plaintext secret is returned ONCE — the
 * caller must surface it immediately and discard. Only the argon2 hash is
 * persisted.
 */
export async function createAppPassword(
  userId: string,
  label: string,
  scopes: AppPasswordScope[] = ['caldav']
): Promise<{ summary: AppPasswordSummary; secret: string }> {
  // 18 random bytes → 24 base64url chars. Long enough to make brute-force
  // pointless against an argon2 verify cost, short enough to type/paste.
  const secret = randomBytes(18).toString('base64url');
  const secretHash = await argon2.hash(secret);

  const [row] = await db
    .insert(appPasswords)
    .values({ userId, label, secretHash, scopes })
    .returning();

  logger.info({ userId, appPasswordId: row.id, label }, 'Created app password');
  return { summary: toSummary(row), secret };
}

export async function listAppPasswords(userId: string): Promise<AppPasswordSummary[]> {
  const rows = await db.query.appPasswords.findMany({
    where: eq(appPasswords.userId, userId),
    orderBy: [desc(appPasswords.createdAt)],
  });
  return rows.map(toSummary);
}

export async function revokeAppPassword(userId: string, id: string): Promise<boolean> {
  const [row] = await db
    .update(appPasswords)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(appPasswords.id, id),
        eq(appPasswords.userId, userId),
        isNull(appPasswords.revokedAt)
      )
    )
    .returning({ id: appPasswords.id });
  return !!row;
}

/**
 * Verify a Basic-auth credential.
 *
 * Username is the user's email; secret is the plaintext app password.
 * Scans all non-revoked passwords for the user and returns the matching
 * password id on success. Touches lastUsedAt without blocking the response.
 */
export async function verifyAppPassword(
  email: string,
  secret: string,
  requiredScope: AppPasswordScope
): Promise<VerifiedAppPassword | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    columns: { id: true },
  });
  if (!user) return null;

  const candidates = await db.query.appPasswords.findMany({
    where: and(eq(appPasswords.userId, user.id), isNull(appPasswords.revokedAt)),
  });

  for (const row of candidates) {
    if (!row.scopes.includes(requiredScope)) continue;
    const ok = await argon2.verify(row.secretHash, secret).catch(() => false);
    if (!ok) continue;

    // Fire and forget — don't block the request on the touch.
    db.update(appPasswords)
      .set({ lastUsedAt: new Date() })
      .where(eq(appPasswords.id, row.id))
      .catch((err) => logger.warn({ err, appPasswordId: row.id }, 'Failed to touch lastUsedAt'));

    return { userId: user.id, passwordId: row.id };
  }
  return null;
}
