import { randomUUID } from 'crypto';
import argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import {
  calendarAccess,
  calendars,
  groupMembers,
  groups,
  households,
  users,
} from '../../src/db/schema/index.js';
import {
  getEffectivePermission,
  filterAccessibleCalendars,
  upsertAccessRule,
} from '../../src/modules/calendars/access.service.js';

/**
 * Tests the resolver that's the heart of intra-household access: roles,
 * groups, individual users, max-permission across rules, and the
 * permissive-default behavior when a calendar has no rules.
 */

// Per-suite fixtures — one household, several users with distinct roles, one
// group, two calendars. Cleaned up in afterAll.
interface Fixture {
  householdId: string;
  adminId: string;
  memberId: string;
  kid1Id: string;
  kid2Id: string;
  visitorId: string;
  kidsGroupId: string;
  openCalendarId: string;
  scopedCalendarId: string;
}

let fx: Fixture;

async function makeUser(householdId: string, role: 'admin' | 'member' | 'kid' | 'visitor', label: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${label}-${randomUUID().slice(0, 8)}@test.local`,
      displayName: label,
      passwordHash: await argon2.hash('test'),
      role,
      householdId,
    })
    .returning({ id: users.id });
  return row.id;
}

beforeAll(async () => {
  const [hh] = await db
    .insert(households)
    .values({ name: 'Access Test Household' })
    .returning({ id: households.id });
  const householdId = hh.id;

  const adminId = await makeUser(householdId, 'admin', 'admin');
  const memberId = await makeUser(householdId, 'member', 'member');
  const kid1Id = await makeUser(householdId, 'kid', 'kid1');
  const kid2Id = await makeUser(householdId, 'kid', 'kid2');
  const visitorId = await makeUser(householdId, 'visitor', 'visitor');

  // Create a "Kids" group with only kid1 in it (so we can distinguish the
  // role-based rule from the group-based rule).
  const [g] = await db
    .insert(groups)
    .values({ householdId, name: 'Kids Group', createdBy: adminId })
    .returning({ id: groups.id });
  const kidsGroupId = g.id;
  await db.insert(groupMembers).values({ groupId: kidsGroupId, userId: kid1Id });

  const [openCal] = await db
    .insert(calendars)
    .values({ householdId, name: 'Open Calendar' })
    .returning({ id: calendars.id });
  const [scopedCal] = await db
    .insert(calendars)
    .values({ householdId, name: 'Scoped Calendar' })
    .returning({ id: calendars.id });

  fx = {
    householdId,
    adminId,
    memberId,
    kid1Id,
    kid2Id,
    visitorId,
    kidsGroupId,
    openCalendarId: openCal.id,
    scopedCalendarId: scopedCal.id,
  };
});

afterAll(async () => {
  if (!fx) return;
  // Cascade does most of the work, but explicit cleanup keeps the DB tidy.
  await db.delete(households).where(eq(households.id, fx.householdId));
});

describe('getEffectivePermission', () => {
  it('returns edit by default when a calendar has no access rules', async () => {
    const perm = await getEffectivePermission(fx.kid1Id, fx.householdId, fx.openCalendarId);
    expect(perm).toBe('edit');
  });

  it('returns null for a calendar in a different household', async () => {
    const [otherHh] = await db
      .insert(households)
      .values({ name: 'Other' })
      .returning({ id: households.id });
    const [otherCal] = await db
      .insert(calendars)
      .values({ householdId: otherHh.id, name: 'Other Cal' })
      .returning({ id: calendars.id });
    const perm = await getEffectivePermission(fx.kid1Id, fx.householdId, otherCal.id);
    expect(perm).toBeNull();
    await db.delete(households).where(eq(households.id, otherHh.id));
  });

  it('honors a user-direct grant', async () => {
    await upsertAccessRule(fx.scopedCalendarId, 'user', fx.kid1Id, 'view');
    try {
      expect(await getEffectivePermission(fx.kid1Id, fx.householdId, fx.scopedCalendarId)).toBe('view');
      // Other users get nothing
      expect(await getEffectivePermission(fx.kid2Id, fx.householdId, fx.scopedCalendarId)).toBeNull();
    } finally {
      await db
        .delete(calendarAccess)
        .where(eq(calendarAccess.calendarId, fx.scopedCalendarId));
    }
  });

  it('honors a group-based grant for members of the group', async () => {
    await upsertAccessRule(fx.scopedCalendarId, 'group', fx.kidsGroupId, 'view');
    try {
      // kid1 is in the group → gets view
      expect(await getEffectivePermission(fx.kid1Id, fx.householdId, fx.scopedCalendarId)).toBe('view');
      // kid2 is NOT in the group → nothing
      expect(await getEffectivePermission(fx.kid2Id, fx.householdId, fx.scopedCalendarId)).toBeNull();
    } finally {
      await db
        .delete(calendarAccess)
        .where(eq(calendarAccess.calendarId, fx.scopedCalendarId));
    }
  });

  it('honors a role-based grant for all users with that role', async () => {
    await upsertAccessRule(fx.scopedCalendarId, 'role', 'kid', 'view_busy');
    try {
      // Both kids get view_busy
      expect(await getEffectivePermission(fx.kid1Id, fx.householdId, fx.scopedCalendarId)).toBe('view_busy');
      expect(await getEffectivePermission(fx.kid2Id, fx.householdId, fx.scopedCalendarId)).toBe('view_busy');
      // Admin has no matching rule
      expect(await getEffectivePermission(fx.adminId, fx.householdId, fx.scopedCalendarId)).toBeNull();
    } finally {
      await db
        .delete(calendarAccess)
        .where(eq(calendarAccess.calendarId, fx.scopedCalendarId));
    }
  });

  it('picks the MAX permission across multiple matching rules', async () => {
    // kid1: role=kid grants view_busy, group=Kids grants view, user grant = edit
    await upsertAccessRule(fx.scopedCalendarId, 'role', 'kid', 'view_busy');
    await upsertAccessRule(fx.scopedCalendarId, 'group', fx.kidsGroupId, 'view');
    await upsertAccessRule(fx.scopedCalendarId, 'user', fx.kid1Id, 'edit');
    try {
      expect(await getEffectivePermission(fx.kid1Id, fx.householdId, fx.scopedCalendarId)).toBe('edit');
      // kid2 has role=kid + nothing else → view_busy
      expect(await getEffectivePermission(fx.kid2Id, fx.householdId, fx.scopedCalendarId)).toBe('view_busy');
    } finally {
      await db
        .delete(calendarAccess)
        .where(eq(calendarAccess.calendarId, fx.scopedCalendarId));
    }
  });
});

describe('filterAccessibleCalendars', () => {
  it('matches single-user resolution across multiple calendars in one pass', async () => {
    await upsertAccessRule(fx.scopedCalendarId, 'role', 'kid', 'view');
    try {
      const result = await filterAccessibleCalendars(fx.kid1Id, fx.householdId, [
        fx.openCalendarId,
        fx.scopedCalendarId,
      ]);
      expect(result.get(fx.openCalendarId)).toBe('edit'); // open default
      expect(result.get(fx.scopedCalendarId)).toBe('view'); // via role
    } finally {
      await db
        .delete(calendarAccess)
        .where(eq(calendarAccess.calendarId, fx.scopedCalendarId));
    }
  });

  it('returns empty for calendars in another household', async () => {
    const [otherHh] = await db
      .insert(households)
      .values({ name: 'Other2' })
      .returning({ id: households.id });
    const [otherCal] = await db
      .insert(calendars)
      .values({ householdId: otherHh.id, name: 'OtherCal' })
      .returning({ id: calendars.id });
    const result = await filterAccessibleCalendars(fx.kid1Id, fx.householdId, [otherCal.id]);
    expect(result.size).toBe(0);
    await db.delete(households).where(eq(households.id, otherHh.id));
  });

  it('skips calendars not in the requested ids', async () => {
    const result = await filterAccessibleCalendars(fx.kid1Id, fx.householdId, []);
    expect(result.size).toBe(0);
    // Adminless silently — fixture has both calendars but we passed none.
    void inArray; // keep import used
  });
});
