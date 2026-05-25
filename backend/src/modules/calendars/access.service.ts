import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  calendarAccess,
  calendars,
  groupMembers,
  users,
  type CalendarPermissionLevel,
} from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';

export type AccessPrincipalType = 'user' | 'group' | 'role';
export type UserRoleName = 'admin' | 'member' | 'kid' | 'visitor';

const LEVEL_RANK: Record<CalendarPermissionLevel, number> = {
  view_busy: 1,
  view: 2,
  edit: 3,
};

function maxLevel(
  a: CalendarPermissionLevel | null,
  b: CalendarPermissionLevel | null
): CalendarPermissionLevel | null {
  if (!a) return b;
  if (!b) return a;
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Compute a user's effective permission on a calendar within their household.
 *
 * Rules:
 *  - Calendar not in the user's household → `null` (no access).
 *  - No `calendar_access` rows for this calendar → "all household members, edit"
 *    (backward compatible with the pre-existing model where any household
 *    member could read/write any household calendar).
 *  - Rows exist → user gets the max of: direct user grants + group grants
 *    where they're a member. No matching grant → `null`.
 */
export async function getEffectivePermission(
  userId: string,
  householdId: string,
  calendarId: string
): Promise<CalendarPermissionLevel | null> {
  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, calendarId), eq(calendars.householdId, householdId)),
    columns: { id: true },
  });
  if (!calendar) return null;

  const rules = await db.query.calendarAccess.findMany({
    where: eq(calendarAccess.calendarId, calendarId),
  });

  // No explicit rules → permissive default (matches existing behavior)
  if (rules.length === 0) return 'edit';

  // Pre-fetch the user's group memberships and role so we can match rules of
  // any principalType in a single pass.
  const [user, memberships] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { role: true },
    }),
    db.query.groupMembers.findMany({
      where: eq(groupMembers.userId, userId),
      columns: { groupId: true },
    }),
  ]);
  const userGroupIds = new Set(memberships.map((m) => m.groupId));
  const userRole = user?.role as UserRoleName | undefined;

  let level: CalendarPermissionLevel | null = null;
  for (const r of rules) {
    if (r.principalType === 'user' && r.principalId === userId) {
      level = maxLevel(level, r.permissionLevel);
    } else if (r.principalType === 'group' && userGroupIds.has(r.principalId)) {
      level = maxLevel(level, r.permissionLevel);
    } else if (r.principalType === 'role' && userRole && r.principalId === userRole) {
      level = maxLevel(level, r.permissionLevel);
    }
  }
  return level;
}

export interface CalendarAccessRule {
  id: string;
  principalType: AccessPrincipalType;
  principalId: string;
  permissionLevel: CalendarPermissionLevel;
  createdAt: Date;
}

export async function listAccessRules(calendarId: string): Promise<CalendarAccessRule[]> {
  const rows = await db.query.calendarAccess.findMany({
    where: eq(calendarAccess.calendarId, calendarId),
  });
  return rows.map((r) => ({
    id: r.id,
    principalType: r.principalType,
    principalId: r.principalId,
    permissionLevel: r.permissionLevel,
    createdAt: r.createdAt,
  }));
}

export async function upsertAccessRule(
  calendarId: string,
  principalType: AccessPrincipalType,
  principalId: string,
  permissionLevel: CalendarPermissionLevel
): Promise<CalendarAccessRule> {
  // Drizzle's onConflictDoUpdate against a partial unique index — use raw SQL
  // pattern via two-step write since the calendar_access unique index covers
  // (calendar_id, principal_type, principal_id).
  const existing = await db.query.calendarAccess.findFirst({
    where: and(
      eq(calendarAccess.calendarId, calendarId),
      eq(calendarAccess.principalType, principalType),
      eq(calendarAccess.principalId, principalId)
    ),
  });

  let row;
  if (existing) {
    [row] = await db
      .update(calendarAccess)
      .set({ permissionLevel })
      .where(eq(calendarAccess.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(calendarAccess)
      .values({ calendarId, principalType, principalId, permissionLevel })
      .returning();
  }

  logger.info(
    { calendarId, principalType, principalId, permissionLevel },
    'Upserted calendar access rule'
  );
  return {
    id: row.id,
    principalType: row.principalType,
    principalId: row.principalId,
    permissionLevel: row.permissionLevel,
    createdAt: row.createdAt,
  };
}

export async function deleteAccessRule(
  calendarId: string,
  ruleId: string
): Promise<boolean> {
  const [row] = await db
    .delete(calendarAccess)
    .where(and(eq(calendarAccess.id, ruleId), eq(calendarAccess.calendarId, calendarId)))
    .returning({ id: calendarAccess.id });
  return !!row;
}

/**
 * For a set of calendars, return the subset the user can see and at what level.
 * Used by the CalDAV calendar-home PROPFIND and the calendar list endpoint.
 * Performs at most one query per group-membership lookup regardless of N.
 */
export async function filterAccessibleCalendars(
  userId: string,
  householdId: string,
  calendarIds: string[]
): Promise<Map<string, CalendarPermissionLevel>> {
  const accessible = new Map<string, CalendarPermissionLevel>();
  if (calendarIds.length === 0) return accessible;

  const owned = await db.query.calendars.findMany({
    where: and(eq(calendars.householdId, householdId), inArray(calendars.id, calendarIds)),
    columns: { id: true },
  });
  const ownedIds = new Set(owned.map((c) => c.id));

  const rules = await db.query.calendarAccess.findMany({
    where: inArray(calendarAccess.calendarId, [...ownedIds]),
  });

  const rulesByCalendar = new Map<string, typeof rules>();
  for (const r of rules) {
    const arr = rulesByCalendar.get(r.calendarId) ?? [];
    arr.push(r);
    rulesByCalendar.set(r.calendarId, arr);
  }

  const [user, memberships] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { role: true },
    }),
    db.query.groupMembers.findMany({
      where: eq(groupMembers.userId, userId),
      columns: { groupId: true },
    }),
  ]);
  const userGroupIds = new Set(memberships.map((m) => m.groupId));
  const userRole = user?.role as UserRoleName | undefined;

  for (const id of ownedIds) {
    const cRules = rulesByCalendar.get(id);
    if (!cRules || cRules.length === 0) {
      accessible.set(id, 'edit'); // permissive default
      continue;
    }
    let level: CalendarPermissionLevel | null = null;
    for (const r of cRules) {
      if (r.principalType === 'user' && r.principalId === userId) {
        level = maxLevel(level, r.permissionLevel);
      } else if (r.principalType === 'group' && userGroupIds.has(r.principalId)) {
        level = maxLevel(level, r.permissionLevel);
      } else if (r.principalType === 'role' && userRole && r.principalId === userRole) {
        level = maxLevel(level, r.permissionLevel);
      }
    }
    if (level) accessible.set(id, level);
  }
  return accessible;
}
