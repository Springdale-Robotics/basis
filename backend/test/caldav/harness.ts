import { randomBytes } from 'crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/config/database.js';
import { appPasswords, calendars, users } from '../../src/db/schema/index.js';

export interface CalDavTestContext {
  app: FastifyInstance;
  baseUrl: string;
  userId: string;
  email: string;
  appPasswordSecret: string;
  calendarId: string;
  close: () => Promise<void>;
}

/**
 * Spin up a real Fastify instance on an ephemeral port and seed:
 *  - a known user (uses the existing seed admin if present)
 *  - a freshly generated app password (plaintext returned for HTTP Basic)
 *  - the user's default calendar id
 *
 * Each integration test gets a self-contained context. Tests should
 * `await ctx.close()` in their afterAll.
 */
export async function setupCalDavTest(): Promise<CalDavTestContext> {
  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Use the seed admin if present, otherwise create one for this test run.
  let user = await db.query.users.findFirst({
    where: eq(users.email, 'admin@demo.local'),
  });
  if (!user) {
    throw new Error(
      'Seed admin user (admin@demo.local) missing. Run `./dev.sh db seed` first.'
    );
  }

  // Ensure they have a default calendar
  let calendar = await db.query.calendars.findFirst({
    where: eq(calendars.householdId, user.householdId),
  });
  if (!calendar) {
    throw new Error('Seed household has no calendar — run `./dev.sh db seed`.');
  }

  // Generate a fresh app password for this run
  const plaintext = randomBytes(18).toString('base64url');
  const secretHash = await argon2.hash(plaintext);
  await db.insert(appPasswords).values({
    userId: user.id,
    label: `caldav-test-${Date.now()}`,
    secretHash,
    scopes: ['caldav'],
  });

  return {
    app,
    baseUrl,
    userId: user.id,
    email: user.email,
    appPasswordSecret: plaintext,
    calendarId: calendar.id,
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Convenience: build the Authorization: Basic header for fetch().
 */
export function basicAuth(email: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${email}:${secret}`).toString('base64');
}
