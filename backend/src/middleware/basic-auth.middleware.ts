import { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users } from '../db/schema/index.js';
import { verifyAppPassword, type AppPasswordScope } from '../modules/app-passwords/app-passwords.service.js';
import type { UserRole } from '../lib/validators.js';

/**
 * HTTP Basic auth middleware for native protocol routes (CalDAV).
 * Validates against the app_passwords table; cookie sessions are NOT accepted
 * here. Sets request.user the same shape as authMiddleware.
 *
 * Returns 401 with WWW-Authenticate so clients know to prompt for credentials —
 * this is the discovery handshake every CalDAV client expects on first contact.
 */
export function basicAuthMiddleware(scope: AppPasswordScope) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('basic ')) {
      reply.header('WWW-Authenticate', 'Basic realm="Basis"').code(401).send();
      return;
    }

    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    } catch {
      reply.header('WWW-Authenticate', 'Basic realm="Basis"').code(401).send();
      return;
    }

    const sep = decoded.indexOf(':');
    if (sep < 0) {
      reply.header('WWW-Authenticate', 'Basic realm="Basis"').code(401).send();
      return;
    }
    const email = decoded.slice(0, sep);
    const secret = decoded.slice(sep + 1);

    const verified = await verifyAppPassword(email, secret, scope);
    if (!verified) {
      reply.header('WWW-Authenticate', 'Basic realm="Basis"').code(401).send();
      return;
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, verified.userId),
    });
    if (!user) {
      reply.header('WWW-Authenticate', 'Basic realm="Basis"').code(401).send();
      return;
    }

    request.user = {
      id: user.id,
      householdId: user.householdId,
      email: user.email,
      displayName: user.displayName,
      role: user.role as UserRole,
      // App-password auth has no session/device — keep the AuthUser contract
      // by using the app-password id as a stand-in session id.
      sessionId: verified.passwordId,
    };
  };
}
