import { FastifyRequest, FastifyReply } from 'fastify';
import { db, enterRlsContext } from '../config/database.js';
import { sessions, users } from '../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { Errors } from '../lib/errors.js';
import type { UserRole } from '../lib/validators.js';

export interface AuthUser {
  id: string;
  householdId: string;
  email: string;
  displayName: string;
  role: UserRole;
  sessionId: string;
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    /** Releases the request's RLS-scoped DB connection; set once auth resolves. */
    rlsRelease?: () => Promise<void>;
  }
}

/**
 * Validate a session id (the value of the `session` cookie) and return the
 * joined session + user, or null if it's unknown/expired. Bumps last-active.
 *
 * Shared by the HTTP auth middleware and the WebSocket auth handshake so the
 * two can't drift — note householdId lives on the *user*, not the session.
 */
export async function resolveSession(sessionId: string) {
  const now = new Date();

  const result = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, now)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  // Update last active time
  await db
    .update(sessions)
    .set({ lastActiveAt: now })
    .where(eq(sessions.id, sessionId));

  return result[0];
}

export async function authMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const sessionId = request.cookies?.['session'];

  if (!sessionId) {
    throw Errors.unauthorized();
  }

  const result = await resolveSession(sessionId);

  if (!result) {
    throw Errors.sessionExpired();
  }

  const { session, user } = result;

  request.user = {
    id: user.id,
    householdId: user.householdId,
    email: user.email,
    displayName: user.displayName,
    role: user.role as UserRole,
    sessionId: session.id,
    deviceId: session.deviceId ?? undefined,
  };

  // Establish the per-request RLS context now that we know the household. From
  // here on, `db` queries in this request run as `basis_rls` scoped to this
  // household — a DB-level backstop under the app's own `where householdId`
  // checks. The connection is released by the onResponse hook in app.ts.
  // The session lookup above deliberately ran BEFORE this, on the base handle,
  // because we didn't yet know the household. Idempotent if auth runs twice.
  if (!request.rlsRelease) {
    request.rlsRelease = await enterRlsContext(user.householdId);
  }
}

export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const sessionId = request.cookies?.['session'];

  if (!sessionId) {
    return;
  }

  try {
    await authMiddleware(request, reply);
  } catch {
    // Ignore auth errors for optional auth
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw Errors.unauthorized();
    }

    if (!allowedRoles.includes(request.user.role)) {
      throw Errors.forbidden('Insufficient permissions for this action');
    }
  };
}

export function requireAdmin() {
  return requireRole('admin');
}

export function requireMember() {
  return requireRole('admin', 'member');
}

export function requireAuthenticated() {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw Errors.unauthorized();
    }
  };
}
