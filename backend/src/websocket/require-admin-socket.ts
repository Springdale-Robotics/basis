import type { Namespace } from 'socket.io';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../config/database.js';
import { sessions, users } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

/**
 * Session-cookie + admin-role gate for a socket.io namespace.
 *
 * Both namespaces that use it (/install, /llm) expose the host itself — a PTY
 * running privileged installers, and what is installed on the box — so they
 * are gated identically and deliberately. That gate used to be copied
 * byte-for-byte between the two, differing only in the log label, which meant
 * a fix to session validation had to land in two places and the next
 * namespace would have copied it a third time. This is the one copy.
 *
 * Note `websocket/index.ts` carries its own, differently-shaped parseCookie
 * for the main namespace's user-level auth; it is not an admin gate and is
 * left alone.
 *
 * @param label namespace name used only for the failure log line.
 */
export function requireAdminSocket(ns: Namespace, label: string): void {
  ns.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const sessionId = cookies['session'];
      if (!sessionId) return next(new Error('Authentication required'));

      const now = new Date();
      const result = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
        .limit(1);

      if (result.length === 0) return next(new Error('Session expired'));
      const { user } = result[0];
      if (user.role !== 'admin') return next(new Error('Admin role required'));

      // Stash on the socket for later logging.
      const authed = socket as typeof socket & { userId?: string; householdId?: string };
      authed.userId = user.id;
      authed.householdId = user.householdId;
      next();
    } catch (err) {
      logger.error({ err }, `${label} namespace auth failed`);
      next(new Error('Authentication failed'));
    }
  });
}
