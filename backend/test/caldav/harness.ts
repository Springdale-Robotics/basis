import { randomBytes, randomUUID } from 'crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/config/database.js';
import { appPasswords, calendars, households, users } from '../../src/db/schema/index.js';

/** Name every harness-created calendar gets; some tests assert on it. */
export const TEST_CALENDAR_NAME = 'Family Calendar';

export interface CalDavTestContext {
  app: FastifyInstance;
  baseUrl: string;
  householdId: string;
  userId: string;
  email: string;
  appPasswordSecret: string;
  calendarId: string;
  calendarName: string;
  close: () => Promise<void>;
}

/**
 * Spin up a real Fastify instance on an ephemeral port with a FULLY ISOLATED
 * fixture: a fresh household, admin user, default calendar, and app password,
 * all unique to this call.
 *
 * Isolation matters — these suites mutate their calendar (create/update/delete
 * events) and assert on sync-tokens and event counts. Sharing the seed
 * household made them non-hermetic: run order changed the results, so they
 * couldn't run in CI. Creating throwaway data per run removes both the shared-
 * state coupling and the `db seed` prerequisite (a migrated DB is enough).
 *
 * `close()` tears down the server and deletes the household; users/calendars/
 * events/app-passwords cascade from that. Tests should call it in afterAll.
 */
export async function setupCalDavTest(): Promise<CalDavTestContext> {
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const run = randomUUID();
  const householdId = randomUUID();
  const userId = randomUUID();
  const calendarId = randomUUID();
  const email = `caldav-${run}@test.local`;

  await db.insert(households).values({
    id: householdId,
    name: `CalDAV Test ${run}`,
    timezone: 'America/Los_Angeles',
  });

  const passwordHash = await argon2.hash('test-password');
  await db.insert(users).values({
    id: userId,
    householdId,
    email,
    passwordHash,
    displayName: 'CalDAV Test User',
    role: 'admin',
  });

  await db.insert(calendars).values({
    id: calendarId,
    householdId,
    name: TEST_CALENDAR_NAME,
    color: '#3B82F6',
    isDefault: true,
    createdBy: userId,
  });

  // Fresh app password (plaintext returned for HTTP Basic).
  const plaintext = randomBytes(18).toString('base64url');
  const secretHash = await argon2.hash(plaintext);
  await db.insert(appPasswords).values({
    userId,
    label: `caldav-test-${run}`,
    secretHash,
    scopes: ['caldav'],
  });

  return {
    app,
    baseUrl,
    householdId,
    userId,
    email,
    appPasswordSecret: plaintext,
    calendarId,
    calendarName: TEST_CALENDAR_NAME,
    close: async () => {
      await app.close();
      // Cascades to users, calendars, events, and app passwords.
      await db.delete(households).where(eq(households.id, householdId));
    },
  };
}

/**
 * Convenience: build the Authorization: Basic header for fetch().
 */
export function basicAuth(email: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${email}:${secret}`).toString('base64');
}
