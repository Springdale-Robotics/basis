import { randomBytes, randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Namespace } from 'socket.io';
import { db } from '../../src/config/database.js';
import { households, sessions, users } from '../../src/db/schema/index.js';
import { requireAdminSocket } from '../../src/websocket/require-admin-socket.js';

/**
 * The gate on /install and /llm. Both namespaces expose the host itself — a
 * PTY running privileged installers, and what is installed on the box — so
 * this is the check that keeps a logged-in non-admin out of them. It used to
 * be duplicated between the two and tested in neither.
 */

const FAKE_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

let householdId: string;
let adminUserId: string;
let adminSession: string;
let memberSession: string;
let expiredSession: string;

/** Drives the middleware `requireAdminSocket` registers, with a given cookie. */
async function handshakeWith(cookie: string | undefined): Promise<{
  error: Error | undefined;
  socket: { handshake: { headers: { cookie?: string } }; userId?: string; householdId?: string };
}> {
  let middleware: ((socket: unknown, next: (err?: Error) => void) => unknown) | undefined;
  const ns = {
    use(fn: (socket: unknown, next: (err?: Error) => void) => unknown) {
      middleware = fn;
    },
  } as unknown as Namespace;

  requireAdminSocket(ns, '/test');
  expect(middleware).toBeDefined();

  const socket = { handshake: { headers: cookie === undefined ? {} : { cookie } } };
  let error: Error | undefined;
  await middleware!(socket, (err?: Error) => {
    error = err;
  });
  return { error, socket };
}

async function createUser(role: 'admin' | 'member'): Promise<{ userId: string; sessionId: string }> {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    householdId,
    email: `ws-${userId.slice(0, 8)}@test.local`,
    passwordHash: FAKE_PASSWORD_HASH,
    displayName: `Test ${role}`,
    role,
  });
  const sessionId = randomBytes(32).toString('hex');
  await db
    .insert(sessions)
    .values({ id: sessionId, userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  return { userId, sessionId };
}

beforeAll(async () => {
  householdId = randomUUID();
  await db.insert(households).values({ id: householdId, name: `WS Auth ${householdId.slice(0, 8)}` });

  const admin = await createUser('admin');
  adminUserId = admin.userId;
  adminSession = admin.sessionId;
  memberSession = (await createUser('member')).sessionId;

  expiredSession = randomBytes(32).toString('hex');
  await db.insert(sessions).values({
    id: expiredSession,
    userId: adminUserId,
    expiresAt: new Date(Date.now() - 60 * 1000),
  });
});

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId));
});

describe('requireAdminSocket', () => {
  it('rejects a handshake with no cookie header at all', async () => {
    const { error } = await handshakeWith(undefined);
    expect(error?.message).toBe('Authentication required');
  });

  it('rejects a cookie header carrying no session', async () => {
    const { error } = await handshakeWith('csrf-token=abc; theme=dark');
    expect(error?.message).toBe('Authentication required');
  });

  it('rejects an unknown session id', async () => {
    const { error } = await handshakeWith(`session=${randomBytes(32).toString('hex')}`);
    expect(error?.message).toBe('Session expired');
  });

  it('rejects an expired session even though the user is an admin', async () => {
    // The expiry predicate is the reason this is a query rather than a lookup;
    // dropping it would let a stale cookie hold a PTY open indefinitely.
    const { error } = await handshakeWith(`session=${expiredSession}`);
    expect(error?.message).toBe('Session expired');
  });

  it('rejects a valid session belonging to a non-admin', async () => {
    const { error } = await handshakeWith(`session=${memberSession}`);
    expect(error?.message).toBe('Admin role required');
  });

  it('admits an admin and stashes the identity on the socket', async () => {
    const { error, socket } = await handshakeWith(`session=${adminSession}`);
    expect(error).toBeUndefined();
    expect(socket.userId).toBe(adminUserId);
    expect(socket.householdId).toBe(householdId);
  });

  it('finds the session among other cookies', async () => {
    const { error } = await handshakeWith(`csrf-token=abc; session=${adminSession}; theme=dark`);
    expect(error).toBeUndefined();
  });
});
