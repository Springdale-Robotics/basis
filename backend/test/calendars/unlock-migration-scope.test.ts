import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { calendars, households } from '../../src/db/schema/index.js';

// Runs the actual 0019 migration file's SQL text against a scratch fixture,
// not a re-implementation of its predicate. The migration already ran once
// against this dev database (verified separately by inspecting
// drizzle.__drizzle_migrations and the real calendars table), so this test
// exists to pin down, reproducibly and in CI, exactly which rows that SQL
// does and does not touch — including edge cases the real data set doesn't
// happen to contain (a disconnected Google calendar that was never
// resynced, and a calendar with no provider at all).
const migrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../drizzle/0019_unlock_google_calendars.sql'),
  'utf-8'
);

describe('0019 migration scope', () => {
  it('unlocks only a synced Google calendar, leaving every other shape locked', async () => {
    const captured: Record<string, boolean> = {};
    const ROLLBACK = new Error('scope-test-intentional-rollback');

    // Everything — fixtures and the migration's own UPDATE — runs inside a
    // transaction that ends in a deliberate throw, so nothing is ever
    // committed. An earlier version of this test ran the raw UPDATE against
    // the live connection with no scoping: it flipped is_read_only for
    // *every* synced Google calendar in the shared test database, including
    // other test files' fixtures running concurrently (vitest runs files in
    // parallel) — exactly the cross-test-bleed class this suite's own
    // outbound-worker.test.ts header comment, and basis#112, warn about.
    await expect(
      db.transaction(async (tx) => {
        const [household] = await tx
          .insert(households)
          .values({ name: `unlock-migration-scope-${randomUUID()}` })
          .returning();
        const householdId = household.id;

        // Every fixture starts read-only, mirroring 0006's pre-phase-2
        // state, so a row left untouched by 0019 is provably left alone
        // rather than coincidentally already correct.
        const [googleSynced] = await tx
          .insert(calendars)
          .values({
            householdId,
            name: 'Google, synced',
            type: 'synced',
            isSynced: true,
            isReadOnly: true,
            syncProvider: 'google',
            syncCalendarId: 'g-scope@group.calendar.google.com',
          })
          .returning();

        const [outlookSynced] = await tx
          .insert(calendars)
          .values({
            householdId,
            name: 'Outlook, synced',
            type: 'synced',
            isSynced: true,
            isReadOnly: true,
            syncProvider: 'outlook',
            syncCalendarId: 'o-scope-1',
          })
          .returning();

        // Edge case: a calendar that still carries sync_provider = 'google'
        // (e.g. a disconnect that didn't clear it) but isn't currently
        // marked synced. The migration's WHERE clause requires
        // is_synced = true, so this must stay locked even though the
        // provider column alone would match.
        const [googleDisconnected] = await tx
          .insert(calendars)
          .values({
            householdId,
            name: 'Google, disconnected',
            type: 'synced',
            isSynced: false,
            isReadOnly: true,
            syncProvider: 'google',
            syncCalendarId: 'g-scope-disconnected@group.calendar.google.com',
          })
          .returning();

        const [local] = await tx
          .insert(calendars)
          .values({
            householdId,
            name: 'Local',
            type: 'individual',
            isSynced: false,
            isReadOnly: true,
          })
          .returning();

        await tx.execute(sql.raw(migrationSql));

        const reread = async (id: string) =>
          (await tx.query.calendars.findFirst({ where: eq(calendars.id, id) }))!.isReadOnly;

        captured.googleSynced = await reread(googleSynced.id);
        captured.outlookSynced = await reread(outlookSynced.id);
        captured.googleDisconnected = await reread(googleDisconnected.id);
        captured.local = await reread(local.id);

        throw ROLLBACK;
      })
    ).rejects.toBe(ROLLBACK);

    expect(captured.googleSynced).toBe(false);
    expect(captured.outlookSynced).toBe(true);
    expect(captured.googleDisconnected).toBe(true);
    expect(captured.local).toBe(true);
  });
});
