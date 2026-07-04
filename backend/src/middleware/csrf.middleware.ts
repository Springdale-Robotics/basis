import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config/index.js';
import { Errors } from '../lib/errors.js';

/**
 * Double-submit-cookie CSRF protection for the browser-facing API.
 *
 * The session cookie is SameSite=Lax, which already blocks the classic
 * cross-site form POST — but that is a single silent layer. This adds the
 * standard second layer: a random token is issued in a NON-httpOnly cookie
 * (readable by our SPA) and the SPA must echo it in the X-CSRF-Token header on
 * every state-changing request. A cross-origin attacker can neither read our
 * cookie nor set a custom header on a credentialed cross-site request, so the
 * two can only match for genuine same-origin calls.
 *
 * Native clients (CalDAV, connect downloads) live outside the API scope and use
 * Basic auth / GETs, so they are unaffected.
 */

export const CSRF_COOKIE = 'csrf-token';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Issue (or reissue) the CSRF cookie and return the token value. */
export function issueCsrfToken(request: FastifyRequest, reply: FastifyReply): string {
  const token = randomBytes(32).toString('hex');
  reply.setCookie(CSRF_COOKIE, token, {
    httpOnly: false, // the SPA must read it to echo it back
    secure: request.protocol === 'https',
    sameSite: 'lax',
    path: '/',
  });
  return token;
}

function tokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * onRequest hook for the API scope. Ensures a token cookie always exists (so a
 * fresh SPA has one to read after any GET), and enforces the header match on
 * state-changing methods.
 */
export function csrfMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
): void {
  if (config.DISABLE_CSRF) {
    done();
    return;
  }

  const cookieToken = request.cookies[CSRF_COOKIE];

  if (SAFE_METHODS.has(request.method)) {
    // Seed a token on safe requests so the SPA has one before its first mutation.
    if (!cookieToken) issueCsrfToken(request, reply);
    done();
    return;
  }

  const headerToken = request.headers[CSRF_HEADER];
  const provided = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!cookieToken || !provided || !tokensMatch(cookieToken, provided)) {
    done(Errors.csrfInvalid());
    return;
  }

  done();
}
