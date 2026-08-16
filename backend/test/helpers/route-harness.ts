import { randomBytes, randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/config/database.js';
import { households, sessions, users } from '../../src/db/schema/index.js';

/**
 * Shared harness for route-level (HTTP) tests — the session-cookie counterpart
 * to the CalDAV Basic-auth harness. Spins up a real Fastify instance on an
 * ephemeral port and lets tests mint isolated households and logged-in users.
 *
 * Auth is by direct session insertion, not the login route: tests here assert
 * on routes *behind* auth (tenancy scoping, permissions), so paying an argon2
 * verify per request would only slow the suite down. The password hash stored
 * on test users is a syntactically-valid placeholder that matches no password.
 */

const FAKE_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Constant CSRF token echoed in cookie + header (double-submit). */
const CSRF_TOKEN = 'route-test-csrf-token';

export interface TestUser {
  id: string;
  householdId: string;
  sessionId: string;
  role: 'admin' | 'member' | 'kid' | 'visitor';
  /** fetch() against the test server with this user's session + CSRF attached. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export interface RouteTestContext {
  app: FastifyInstance;
  baseUrl: string;
  /** Create a fresh household; torn down (with everything cascading) in close(). */
  createHousehold: (name?: string) => Promise<string>;
  /** Create a logged-in user in a household. */
  createUser: (
    householdId: string,
    role?: 'admin' | 'member' | 'kid' | 'visitor'
  ) => Promise<TestUser>;
  close: () => Promise<void>;
}

export async function setupRouteTest(): Promise<RouteTestContext> {
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const createdHouseholdIds: string[] = [];

  async function createHousehold(name = 'Route Test Household'): Promise<string> {
    const id = randomUUID();
    await db.insert(households).values({ id, name: `${name} ${id.slice(0, 8)}` });
    createdHouseholdIds.push(id);
    return id;
  }

  async function createUser(
    householdId: string,
    role: 'admin' | 'member' | 'kid' | 'visitor' = 'admin'
  ): Promise<TestUser> {
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      householdId,
      email: `route-${userId.slice(0, 8)}@test.local`,
      passwordHash: FAKE_PASSWORD_HASH,
      displayName: `Test ${role}`,
      role,
    });

    const sessionId = randomBytes(32).toString('hex');
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    return {
      id: userId,
      householdId,
      sessionId,
      role,
      fetch: (path: string, init: RequestInit = {}) =>
        fetch(`${baseUrl}${path}`, {
          ...init,
          headers: {
            cookie: `session=${sessionId}; csrf-token=${CSRF_TOKEN}`,
            'x-csrf-token': CSRF_TOKEN,
            // FormData carries its own content-type with the multipart
            // boundary; forcing JSON here made every upload fail while parsing
            // the boundary, which read as a 500 and quietly passed any test
            // that only asserted "not 2xx".
            ...(init.body && !(init.body instanceof FormData)
              ? { 'content-type': 'application/json' }
              : {}),
            ...(init.headers || {}),
          },
        }),
    };
  }

  return {
    app,
    baseUrl,
    createHousehold,
    createUser,
    close: async () => {
      await app.close();
      if (createdHouseholdIds.length > 0) {
        await db.delete(households).where(inArray(households.id, createdHouseholdIds));
      }
    },
  };
}

/** Assert-friendly JSON body reader. */
export async function json(res: Response): Promise<any> {
  return res.json() as Promise<any>;
}
