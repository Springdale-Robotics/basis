import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, accounts } from '../db/schema/index.js';

export interface AuthAccount {
  id: string;
  email: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    account?: AuthAccount;
  }
}

export async function resolveSession(sessionId: string): Promise<AuthAccount | null> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: accounts.id,
      email: accounts.email,
      isAdmin: accounts.isAdmin,
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  // Best-effort activity bump; not worth failing the request over.
  void db
    .update(sessions)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .catch(() => undefined);

  return { id: row.id, email: row.email, isAdmin: row.isAdmin };
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const sessionId = request.cookies['session'];
  if (!sessionId) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required' },
    });
    return;
  }
  const account = await resolveSession(sessionId);
  if (!account) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Session expired — sign in again' },
    });
    return;
  }
  request.account = account;
}
