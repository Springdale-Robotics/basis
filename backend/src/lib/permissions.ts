import { db } from '../config/database.js';
import { permissions, groupMembers } from '../db/schema/index.js';
import { eq, and, or, inArray } from 'drizzle-orm';
import type { PermissionLevel, ResourceType, UserRole, GranteeType } from './validators.js';

interface PermissionContext {
  userId: string;
  householdId: string;
  userRole: UserRole;
  deviceId?: string;
}

interface PermissionCheck {
  resourceType: ResourceType;
  resourceId: string;
  requiredLevel: PermissionLevel;
}

const permissionHierarchy: Record<PermissionLevel, number> = {
  view_busy: 1,
  view: 2,
  edit: 3,
  admin: 4,
};

function hasPermissionLevel(
  grantedLevel: PermissionLevel,
  requiredLevel: PermissionLevel
): boolean {
  return permissionHierarchy[grantedLevel] >= permissionHierarchy[requiredLevel];
}

// Default role permissions for pages
const rolePageDefaults: Record<UserRole, Record<string, PermissionLevel | null>> = {
  admin: {
    calendar: 'admin',
    recipes: 'admin',
    inventory: 'admin',
    shopping_list: 'admin',
    tasks: 'admin',
    rewards: 'admin',
    files: 'admin',
    smart_home: 'admin',
    settings: 'admin',
    admin: 'admin',
  },
  member: {
    calendar: 'edit',
    recipes: 'edit',
    inventory: 'edit',
    shopping_list: 'edit',
    tasks: 'edit',
    rewards: 'view',
    files: 'edit',
    smart_home: 'edit',
    settings: 'view',
    admin: null,
  },
  kid: {
    calendar: 'view',
    recipes: 'view',
    inventory: null,
    shopping_list: 'edit',
    tasks: 'edit',
    rewards: 'view',
    files: 'view',
    smart_home: 'view',
    settings: null,
    admin: null,
  },
  visitor: {
    calendar: 'view',
    recipes: 'view',
    inventory: null,
    shopping_list: null,
    tasks: null,
    rewards: null,
    files: 'view',
    smart_home: null,
    settings: null,
    admin: null,
  },
};

export async function checkPermission(
  context: PermissionContext,
  check: PermissionCheck
): Promise<boolean> {
  // Admins have full access
  if (context.userRole === 'admin') {
    return true;
  }

  // Check explicit permissions
  const userGroups = await getUserGroups(context.userId);
  const groupIds = userGroups.map((g) => g.groupId);

  const granteeConditions = [
    and(
      eq(permissions.granteeType, 'user' as GranteeType),
      eq(permissions.granteeId, context.userId)
    ),
    and(
      eq(permissions.granteeType, 'role' as GranteeType),
      eq(permissions.granteeId, context.userRole)
    ),
    and(
      eq(permissions.granteeType, 'household' as GranteeType),
      eq(permissions.granteeId, context.householdId)
    ),
  ];

  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(permissions.granteeType, 'group' as GranteeType),
        inArray(permissions.granteeId, groupIds)
      )
    );
  }

  if (context.deviceId) {
    granteeConditions.push(
      and(
        eq(permissions.granteeType, 'device' as GranteeType),
        eq(permissions.granteeId, context.deviceId)
      )
    );
  }

  const explicitPermissions = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.resourceType, check.resourceType),
        eq(permissions.resourceId, check.resourceId),
        or(...granteeConditions)
      )
    );

  // Find the highest permission level granted
  for (const perm of explicitPermissions) {
    if (hasPermissionLevel(perm.permissionLevel, check.requiredLevel)) {
      return true;
    }
  }

  return false;
}

export async function checkPageAccess(
  context: PermissionContext,
  pageSlug: string
): Promise<{ canAccess: boolean; level: PermissionLevel | null }> {
  // Get default permission for role
  const defaultLevel = rolePageDefaults[context.userRole]?.[pageSlug] ?? null;

  if (context.userRole === 'admin') {
    return { canAccess: true, level: 'admin' };
  }

  // Check for explicit page permission override
  const userGroups = await getUserGroups(context.userId);
  const groupIds = userGroups.map((g) => g.groupId);

  const granteeConditions = [
    and(
      eq(permissions.granteeType, 'user' as GranteeType),
      eq(permissions.granteeId, context.userId)
    ),
  ];

  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(permissions.granteeType, 'group' as GranteeType),
        inArray(permissions.granteeId, groupIds)
      )
    );
  }

  if (context.deviceId) {
    granteeConditions.push(
      and(
        eq(permissions.granteeType, 'device' as GranteeType),
        eq(permissions.granteeId, context.deviceId)
      )
    );
  }

  const pagePermissions = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.resourceType, 'page'),
        eq(permissions.resourceId, pageSlug),
        or(...granteeConditions)
      )
    );

  // Find the highest permission level
  let highestLevel: PermissionLevel | null = defaultLevel;
  for (const perm of pagePermissions) {
    if (
      highestLevel === null ||
      permissionHierarchy[perm.permissionLevel] > permissionHierarchy[highestLevel]
    ) {
      highestLevel = perm.permissionLevel;
    }
  }

  return {
    canAccess: highestLevel !== null,
    level: highestLevel,
  };
}

async function getUserGroups(
  userId: string
): Promise<Array<{ groupId: string }>> {
  return db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
}

export async function grantPermission(
  resourceType: ResourceType,
  resourceId: string,
  granteeType: GranteeType,
  granteeId: string,
  level: PermissionLevel,
  createdBy: string
): Promise<void> {
  await db.insert(permissions).values({
    resourceType,
    resourceId,
    granteeType,
    granteeId,
    permissionLevel: level,
    createdBy,
  });
}

export async function revokePermission(
  resourceType: ResourceType,
  resourceId: string,
  granteeType: GranteeType,
  granteeId: string
): Promise<void> {
  await db
    .delete(permissions)
    .where(
      and(
        eq(permissions.resourceType, resourceType),
        eq(permissions.resourceId, resourceId),
        eq(permissions.granteeType, granteeType),
        eq(permissions.granteeId, granteeId)
      )
    );
}

export async function getResourcePermissions(
  resourceType: ResourceType,
  resourceId: string
): Promise<Array<{
  granteeType: GranteeType;
  granteeId: string;
  permissionLevel: PermissionLevel;
}>> {
  return db
    .select({
      granteeType: permissions.granteeType,
      granteeId: permissions.granteeId,
      permissionLevel: permissions.permissionLevel,
    })
    .from(permissions)
    .where(
      and(
        eq(permissions.resourceType, resourceType),
        eq(permissions.resourceId, resourceId)
      )
    );
}
