import { db } from '../config/database.js';
import { permissions, groupMembers, users, groups, featurePermissions, files, folders } from '../db/schema/index.js';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import type { PermissionLevel, ResourceType, UserRole, GranteeType, Feature } from '../lib/validators.js';

export interface PermissionContext {
  userId: string;
  householdId: string;
  userRole: UserRole;
  deviceId?: string;
}

interface PermissionCheck {
  resourceType: ResourceType;
  resourceId: string;
  level: PermissionLevel;
}

const permissionHierarchy: Record<PermissionLevel, number> = {
  none: 0,
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

// Default permissions for new resources by role
const defaultResourcePermissions: Record<ResourceType, Record<UserRole, PermissionLevel | null>> = {
  recipe: { admin: 'admin', member: 'edit', kid: 'view', visitor: 'view' },
  task: { admin: 'admin', member: 'edit', kid: 'view', visitor: null },
  file: { admin: 'admin', member: 'view', kid: 'view', visitor: 'view' },
  album: { admin: 'admin', member: 'view', kid: 'view', visitor: 'view' },
  list: { admin: 'admin', member: 'edit', kid: 'view', visitor: null },
  calendar: { admin: 'admin', member: 'view', kid: 'view', visitor: null },
  page: { admin: 'admin', member: null, kid: null, visitor: null },
  inventory_area: { admin: 'admin', member: 'edit', kid: null, visitor: null },
  feature: { admin: 'admin', member: 'view', kid: null, visitor: null },
};

// Default feature-level permissions by role
const defaultFeaturePermissions: Record<Feature, Record<UserRole, PermissionLevel | null>> = {
  recipes: { admin: 'admin', member: 'edit', kid: 'view', visitor: 'view' },
  inventory: { admin: 'admin', member: 'edit', kid: null, visitor: null },
  meal_plan: { admin: 'admin', member: 'edit', kid: 'view', visitor: null },
  shopping_list: { admin: 'admin', member: 'edit', kid: 'edit', visitor: null },
  files: { admin: 'admin', member: 'admin', kid: 'view', visitor: null },
  calendars: { admin: 'admin', member: 'admin', kid: 'view', visitor: 'view' },
  lists: { admin: 'admin', member: 'admin', kid: 'view', visitor: null },
  tasks: { admin: 'admin', member: 'edit', kid: 'view', visitor: null },
  settings: { admin: 'admin', member: 'view', kid: null, visitor: null },
};

// Cache for user groups - cleared per-request
const groupCache = new Map<string, string[]>();

export function clearPermissionCache(): void {
  groupCache.clear();
}

// ===== RESTRICTION HELPERS =====

export interface RestrictionInfo {
  isRestricted: boolean;
  restrictedDirectly: boolean;
  restrictedBy: { type: 'file' | 'folder'; id: string; name: string } | null;
}

/**
 * Check if a file/folder is restricted (including parent folder inheritance).
 * Returns full restriction info including which ancestor imposed the restriction.
 */
export async function getRestrictionInfo(
  resourceType: 'file' | 'folder',
  resourceId: string
): Promise<RestrictionInfo> {
  if (resourceType === 'file') {
    // Get the file
    const file = await db.query.files.findFirst({
      where: eq(files.id, resourceId),
      columns: { id: true, filename: true, isRestricted: true, folderId: true },
    });

    if (!file) {
      return { isRestricted: false, restrictedDirectly: false, restrictedBy: null };
    }

    // Check if file is directly restricted
    if (file.isRestricted) {
      return {
        isRestricted: true,
        restrictedDirectly: true,
        restrictedBy: { type: 'file', id: file.id, name: file.filename },
      };
    }

    // Check parent folder chain
    if (file.folderId) {
      const folderRestriction = await getRestrictionInfo('folder', file.folderId);
      if (folderRestriction.isRestricted) {
        return {
          isRestricted: true,
          restrictedDirectly: false,
          restrictedBy: folderRestriction.restrictedBy,
        };
      }
    }

    return { isRestricted: false, restrictedDirectly: false, restrictedBy: null };
  } else {
    // Get the folder
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, resourceId),
      columns: { id: true, name: true, isRestricted: true, parentId: true },
    });

    if (!folder) {
      return { isRestricted: false, restrictedDirectly: false, restrictedBy: null };
    }

    // Check if folder is directly restricted
    if (folder.isRestricted) {
      return {
        isRestricted: true,
        restrictedDirectly: true,
        restrictedBy: { type: 'folder', id: folder.id, name: folder.name },
      };
    }

    // Check parent folder chain
    if (folder.parentId) {
      const parentRestriction = await getRestrictionInfo('folder', folder.parentId);
      if (parentRestriction.isRestricted) {
        return {
          isRestricted: true,
          restrictedDirectly: false,
          restrictedBy: parentRestriction.restrictedBy,
        };
      }
    }

    return { isRestricted: false, restrictedDirectly: false, restrictedBy: null };
  }
}

/**
 * Check if a resource is restricted (simple boolean check).
 */
export async function isRestricted(
  resourceType: 'file' | 'folder',
  resourceId: string
): Promise<boolean> {
  const info = await getRestrictionInfo(resourceType, resourceId);
  return info.isRestricted;
}

/**
 * Set or clear restriction on a file/folder.
 */
export async function setRestriction(
  resourceType: 'file' | 'folder',
  resourceId: string,
  restricted: boolean
): Promise<void> {
  if (resourceType === 'file') {
    await db
      .update(files)
      .set({ isRestricted: restricted, updatedAt: new Date() })
      .where(eq(files.id, resourceId));
  } else {
    await db
      .update(folders)
      .set({ isRestricted: restricted, updatedAt: new Date() })
      .where(eq(folders.id, resourceId));
  }
}

async function getUserGroupIds(userId: string): Promise<string[]> {
  if (groupCache.has(userId)) {
    return groupCache.get(userId)!;
  }

  const userGroups = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));

  const groupIds = userGroups.map((g) => g.groupId);
  groupCache.set(userId, groupIds);
  return groupIds;
}

/**
 * Check if a user has the required permission level for a resource.
 * Returns true if access is granted, false otherwise.
 */
export async function canAccess(
  context: PermissionContext,
  resourceType: ResourceType,
  resourceId: string,
  requiredLevel: PermissionLevel
): Promise<boolean> {
  // Admins always have full access
  if (context.userRole === 'admin') {
    return true;
  }

  const accessLevel = await getAccessLevel(context, resourceType, resourceId);
  if (accessLevel === null) {
    return false;
  }

  return hasPermissionLevel(accessLevel, requiredLevel);
}

/**
 * Get the highest permission level a user has for a resource.
 * Returns null if no access.
 */
export async function getAccessLevel(
  context: PermissionContext,
  resourceType: ResourceType,
  resourceId: string
): Promise<PermissionLevel | null> {
  // Admins always have admin access
  if (context.userRole === 'admin') {
    return 'admin';
  }

  // Build grantee conditions
  const groupIds = await getUserGroupIds(context.userId);

  const granteeConditions = [
    // Direct user permission
    and(
      eq(permissions.granteeType, 'user' as GranteeType),
      eq(permissions.granteeId, context.userId)
    ),
    // Role-based permission
    and(
      eq(permissions.granteeType, 'role' as GranteeType),
      eq(permissions.granteeId, context.userRole)
    ),
    // Household-level permission
    and(
      eq(permissions.granteeType, 'household' as GranteeType),
      eq(permissions.granteeId, context.householdId)
    ),
  ];

  // Group permissions
  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(permissions.granteeType, 'group' as GranteeType),
        inArray(permissions.granteeId, groupIds)
      )
    );
  }

  // Device permissions
  if (context.deviceId) {
    granteeConditions.push(
      and(
        eq(permissions.granteeType, 'device' as GranteeType),
        eq(permissions.granteeId, context.deviceId)
      )
    );
  }

  const explicitPermissions = await db
    .select({ level: permissions.permissionLevel })
    .from(permissions)
    .where(
      and(
        eq(permissions.resourceType, resourceType),
        eq(permissions.resourceId, resourceId),
        or(...granteeConditions)
      )
    );

  if (explicitPermissions.length === 0) {
    // For files/folders, check if restricted before falling back to defaults
    if (resourceType === 'file' || resourceType === 'album') {
      // Determine if this is a file or folder by checking which table has this ID
      const fileExists = await db.query.files.findFirst({
        where: eq(files.id, resourceId),
        columns: { id: true },
      });

      const restrictionType: 'file' | 'folder' = fileExists ? 'file' : 'folder';
      const resourceIsRestricted = await isRestricted(restrictionType, resourceId);

      if (resourceIsRestricted) {
        // Restricted items with no explicit permission = no access
        return null;
      }
    }
    // Fall back to default role permission for this resource type
    return defaultResourcePermissions[resourceType]?.[context.userRole] ?? null;
  }

  // Find highest permission level
  let highestLevel: PermissionLevel | null = null;
  for (const perm of explicitPermissions) {
    if (
      highestLevel === null ||
      permissionHierarchy[perm.level] > permissionHierarchy[highestLevel]
    ) {
      highestLevel = perm.level;
    }
  }

  // 'none' means explicit no-access override
  if (highestLevel === 'none') {
    return null;
  }

  return highestLevel;
}

/**
 * Check if a user is the owner (creator) of a resource.
 * Owners always have admin-level access regardless of explicit permissions.
 */
export async function isOwner(
  userId: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<boolean> {
  // Query the appropriate table based on resource type
  const tableMap: Record<string, string> = {
    recipe: 'recipes',
    task: 'tasks',
    file: 'files',
    album: 'albums',
    list: 'lists',
    calendar: 'calendars',
    inventory_area: 'inventory_areas',
  };

  const tableName = tableMap[resourceType];
  if (!tableName) {
    return false;
  }

  const result = await db.execute(
    sql`SELECT created_by FROM ${sql.identifier(tableName)} WHERE id = ${resourceId} LIMIT 1`
  );

  const rows = result.rows as Array<{ created_by: string }>;
  return rows.length > 0 && rows[0].created_by === userId;
}

/**
 * Batch check access for multiple resources.
 * Returns a map of resourceId -> boolean.
 */
export async function batchCanAccess(
  context: PermissionContext,
  checks: PermissionCheck[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  // Admin has access to everything
  if (context.userRole === 'admin') {
    for (const check of checks) {
      results.set(check.resourceId, true);
    }
    return results;
  }

  // Group by resource type for efficient queries
  const byType = new Map<ResourceType, PermissionCheck[]>();
  for (const check of checks) {
    if (!byType.has(check.resourceType)) {
      byType.set(check.resourceType, []);
    }
    byType.get(check.resourceType)!.push(check);
  }

  const groupIds = await getUserGroupIds(context.userId);

  for (const [resourceType, typeChecks] of byType.entries()) {
    const resourceIds = typeChecks.map((c) => c.resourceId);

    // Build grantee conditions
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

    // Query all permissions for these resources
    const allPermissions = await db
      .select({
        resourceId: permissions.resourceId,
        level: permissions.permissionLevel,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.resourceType, resourceType),
          inArray(permissions.resourceId, resourceIds),
          or(...granteeConditions)
        )
      );

    // Group permissions by resource ID and find highest level
    const permsByResource = new Map<string, PermissionLevel>();
    for (const perm of allPermissions) {
      const current = permsByResource.get(perm.resourceId);
      if (
        !current ||
        permissionHierarchy[perm.level] > permissionHierarchy[current]
      ) {
        permsByResource.set(perm.resourceId, perm.level);
      }
    }

    // Check each resource against required level
    for (const check of typeChecks) {
      let accessLevel: PermissionLevel | null | undefined = permsByResource.get(check.resourceId);

      // 'none' means explicit no-access override
      if (accessLevel === 'none') {
        results.set(check.resourceId, false);
        continue;
      }

      // Fall back to role default if no explicit permission
      if (!accessLevel) {
        // For files/albums, check if restricted before falling back to defaults
        if (resourceType === 'file' || resourceType === 'album') {
          // Determine if this is a file or folder by checking which table has this ID
          const fileExists = await db.query.files.findFirst({
            where: eq(files.id, check.resourceId),
            columns: { id: true },
          });

          const restrictionType: 'file' | 'folder' = fileExists ? 'file' : 'folder';
          const resourceIsRestricted = await isRestricted(restrictionType, check.resourceId);

          if (resourceIsRestricted) {
            // Restricted items with no explicit permission = no access
            results.set(check.resourceId, false);
            continue;
          }
        }
        accessLevel = defaultResourcePermissions[resourceType]?.[context.userRole] ?? null;
      }

      const hasAccess =
        accessLevel !== null && hasPermissionLevel(accessLevel, check.level);
      results.set(check.resourceId, hasAccess);
    }
  }

  return results;
}

/**
 * Filter a list of resource IDs to only those the user can access.
 */
export async function filterAccessible(
  context: PermissionContext,
  resourceType: ResourceType,
  resourceIds: string[],
  requiredLevel: PermissionLevel
): Promise<string[]> {
  if (resourceIds.length === 0) {
    return [];
  }

  const checks = resourceIds.map((resourceId) => ({
    resourceType,
    resourceId,
    level: requiredLevel,
  }));

  const results = await batchCanAccess(context, checks);
  return resourceIds.filter((id) => results.get(id) === true);
}

/**
 * Set default permissions for a newly created resource.
 * Grants admin to creator and household-level defaults.
 */
export async function setResourceDefaults(
  resourceType: ResourceType,
  resourceId: string,
  ownerId: string,
  householdId: string
): Promise<void> {
  const permissionsToInsert = [
    // Owner gets admin
    {
      resourceType,
      resourceId,
      granteeType: 'user' as GranteeType,
      granteeId: ownerId,
      permissionLevel: 'admin' as PermissionLevel,
      createdBy: ownerId,
    },
    // Household gets default based on resource type
    {
      resourceType,
      resourceId,
      granteeType: 'household' as GranteeType,
      granteeId: householdId,
      permissionLevel: (defaultResourcePermissions[resourceType]?.member ?? 'view') as PermissionLevel,
      createdBy: ownerId,
    },
  ];

  await db.insert(permissions).values(permissionsToInsert);
}

/**
 * Grant a permission to a grantee on a resource.
 */
export async function grantPermission(
  resourceType: ResourceType,
  resourceId: string,
  granteeType: GranteeType,
  granteeId: string,
  level: PermissionLevel,
  createdBy: string
): Promise<string> {
  // Check if permission already exists
  const existing = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.resourceType, resourceType),
        eq(permissions.resourceId, resourceId),
        eq(permissions.granteeType, granteeType),
        eq(permissions.granteeId, granteeId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing permission
    await db
      .update(permissions)
      .set({ permissionLevel: level })
      .where(eq(permissions.id, existing[0].id));
    return existing[0].id;
  }

  // Create new permission
  const [created] = await db
    .insert(permissions)
    .values({
      resourceType,
      resourceId,
      granteeType,
      granteeId,
      permissionLevel: level,
      createdBy,
    })
    .returning({ id: permissions.id });

  return created.id;
}

/**
 * Revoke a permission by ID.
 */
export async function revokePermission(permissionId: string): Promise<void> {
  await db.delete(permissions).where(eq(permissions.id, permissionId));
}

/**
 * Get all permissions for a resource with grantee details.
 */
export async function getResourcePermissions(
  resourceType: ResourceType,
  resourceId: string
): Promise<
  Array<{
    id: string;
    granteeType: GranteeType;
    granteeId: string;
    permissionLevel: PermissionLevel;
    grantee: { name: string; email?: string } | null;
    createdAt: Date;
  }>
> {
  const perms = await db
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.resourceType, resourceType),
        eq(permissions.resourceId, resourceId)
      )
    );

  // Enrich with grantee details
  const enriched = await Promise.all(
    perms.map(async (perm) => {
      let grantee: { name: string; email?: string } | null = null;

      if (perm.granteeType === 'user') {
        const user = await db
          .select({ displayName: users.displayName, email: users.email })
          .from(users)
          .where(eq(users.id, perm.granteeId))
          .limit(1);
        if (user.length > 0) {
          grantee = { name: user[0].displayName, email: user[0].email };
        }
      } else if (perm.granteeType === 'group') {
        const group = await db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, perm.granteeId))
          .limit(1);
        if (group.length > 0) {
          grantee = { name: group[0].name };
        }
      } else if (perm.granteeType === 'role') {
        grantee = { name: perm.granteeId };
      } else if (perm.granteeType === 'household') {
        grantee = { name: 'Everyone in household' };
      }

      return {
        id: perm.id,
        granteeType: perm.granteeType as GranteeType,
        granteeId: perm.granteeId,
        permissionLevel: perm.permissionLevel as PermissionLevel,
        grantee,
        createdAt: perm.createdAt,
      };
    })
  );

  return enriched;
}

/**
 * Update a permission's level.
 */
export async function updatePermissionLevel(
  permissionId: string,
  level: PermissionLevel
): Promise<void> {
  await db
    .update(permissions)
    .set({ permissionLevel: level })
    .where(eq(permissions.id, permissionId));
}

// ===== FEATURE-LEVEL PERMISSIONS =====

/**
 * Check if a user has the required permission level for a feature.
 * Resolution order: user -> group -> role default
 */
export async function canAccessFeature(
  context: PermissionContext,
  feature: Feature,
  requiredLevel: PermissionLevel
): Promise<boolean> {
  // Admins always have full access
  if (context.userRole === 'admin') {
    return true;
  }

  const accessLevel = await getFeatureAccessLevel(context, feature);
  if (accessLevel === null) {
    return false;
  }

  return hasPermissionLevel(accessLevel, requiredLevel);
}

/**
 * Get the highest permission level a user has for a feature.
 * Resolution order: user -> group -> role default
 */
export async function getFeatureAccessLevel(
  context: PermissionContext,
  feature: Feature
): Promise<PermissionLevel | null> {
  // Admins always have admin access
  if (context.userRole === 'admin') {
    return 'admin';
  }

  // Build grantee conditions
  const groupIds = await getUserGroupIds(context.userId);

  const granteeConditions = [
    // Direct user permission (highest priority)
    and(
      eq(featurePermissions.granteeType, 'user' as GranteeType),
      eq(featurePermissions.granteeId, context.userId)
    ),
    // Role-based permission
    and(
      eq(featurePermissions.granteeType, 'role' as GranteeType),
      eq(featurePermissions.granteeId, context.userRole)
    ),
  ];

  // Group permissions
  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(featurePermissions.granteeType, 'group' as GranteeType),
        inArray(featurePermissions.granteeId, groupIds)
      )
    );
  }

  const explicitPermissions = await db
    .select({
      level: featurePermissions.permissionLevel,
      granteeType: featurePermissions.granteeType,
    })
    .from(featurePermissions)
    .where(
      and(
        eq(featurePermissions.householdId, context.householdId),
        eq(featurePermissions.feature, feature),
        or(...granteeConditions)
      )
    );

  if (explicitPermissions.length === 0) {
    // Fall back to default role permission for this feature
    return defaultFeaturePermissions[feature]?.[context.userRole] ?? null;
  }

  // Priority: user > group > role
  // Find user-specific permission first
  const userPerm = explicitPermissions.find(p => p.granteeType === 'user');
  if (userPerm) {
    // 'none' means explicit no-access override
    if (userPerm.level === 'none') {
      return null;
    }
    return userPerm.level as PermissionLevel;
  }

  // Then check group permissions (take highest)
  const groupPerms = explicitPermissions.filter(p => p.granteeType === 'group');
  if (groupPerms.length > 0) {
    let highestLevel: PermissionLevel | null = null;
    for (const perm of groupPerms) {
      if (
        highestLevel === null ||
        permissionHierarchy[perm.level as PermissionLevel] > permissionHierarchy[highestLevel]
      ) {
        highestLevel = perm.level as PermissionLevel;
      }
    }
    // 'none' means explicit no-access override
    if (highestLevel === 'none') {
      return null;
    }
    return highestLevel;
  }

  // Finally check role permission
  const rolePerm = explicitPermissions.find(p => p.granteeType === 'role');
  if (rolePerm) {
    // 'none' means explicit no-access override
    if (rolePerm.level === 'none') {
      return null;
    }
    return rolePerm.level as PermissionLevel;
  }

  // Fall back to default only when NO explicit permission exists
  return defaultFeaturePermissions[feature]?.[context.userRole] ?? null;
}

/**
 * Set a feature permission for a grantee.
 */
export async function setFeaturePermission(
  householdId: string,
  feature: Feature,
  granteeType: GranteeType,
  granteeId: string,
  level: PermissionLevel
): Promise<string> {
  // Check if permission already exists
  const existing = await db
    .select({ id: featurePermissions.id })
    .from(featurePermissions)
    .where(
      and(
        eq(featurePermissions.householdId, householdId),
        eq(featurePermissions.feature, feature),
        eq(featurePermissions.granteeType, granteeType),
        eq(featurePermissions.granteeId, granteeId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing permission
    await db
      .update(featurePermissions)
      .set({ permissionLevel: level, updatedAt: new Date() })
      .where(eq(featurePermissions.id, existing[0].id));
    return existing[0].id;
  }

  // Create new permission
  const [created] = await db
    .insert(featurePermissions)
    .values({
      householdId,
      feature,
      granteeType,
      granteeId,
      permissionLevel: level,
    })
    .returning({ id: featurePermissions.id });

  return created.id;
}

/**
 * Get all feature permissions for a household.
 */
export async function getHouseholdFeaturePermissions(
  householdId: string
): Promise<
  Array<{
    id: string;
    feature: Feature;
    granteeType: GranteeType;
    granteeId: string;
    permissionLevel: PermissionLevel;
    grantee: { name: string; email?: string } | null;
    createdAt: Date;
  }>
> {
  const perms = await db
    .select()
    .from(featurePermissions)
    .where(eq(featurePermissions.householdId, householdId));

  // Enrich with grantee details
  const enriched = await Promise.all(
    perms.map(async (perm) => {
      let grantee: { name: string; email?: string } | null = null;

      if (perm.granteeType === 'user') {
        const user = await db
          .select({ displayName: users.displayName, email: users.email })
          .from(users)
          .where(eq(users.id, perm.granteeId))
          .limit(1);
        if (user.length > 0) {
          grantee = { name: user[0].displayName, email: user[0].email };
        }
      } else if (perm.granteeType === 'group') {
        const group = await db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, perm.granteeId))
          .limit(1);
        if (group.length > 0) {
          grantee = { name: group[0].name };
        }
      } else if (perm.granteeType === 'role') {
        grantee = { name: perm.granteeId };
      }

      return {
        id: perm.id,
        feature: perm.feature as Feature,
        granteeType: perm.granteeType as GranteeType,
        granteeId: perm.granteeId,
        permissionLevel: perm.permissionLevel as PermissionLevel,
        grantee,
        createdAt: perm.createdAt,
      };
    })
  );

  return enriched;
}

/**
 * Delete a feature permission (reverts to role default).
 */
export async function deleteFeaturePermission(
  householdId: string,
  feature: Feature,
  granteeType: GranteeType,
  granteeId: string
): Promise<void> {
  await db
    .delete(featurePermissions)
    .where(
      and(
        eq(featurePermissions.householdId, householdId),
        eq(featurePermissions.feature, feature),
        eq(featurePermissions.granteeType, granteeType),
        eq(featurePermissions.granteeId, granteeId)
      )
    );
}

/**
 * Get default feature permissions for a role.
 */
export function getDefaultFeaturePermissions(): Record<Feature, Record<UserRole, PermissionLevel | null>> {
  return defaultFeaturePermissions;
}

// Export the permission service as a namespace
export const permissionService = {
  canAccess,
  getAccessLevel,
  isOwner,
  batchCanAccess,
  filterAccessible,
  setResourceDefaults,
  grantPermission,
  revokePermission,
  getResourcePermissions,
  updatePermissionLevel,
  clearCache: clearPermissionCache,
  // Feature-level permissions
  canAccessFeature,
  getFeatureAccessLevel,
  setFeaturePermission,
  getHouseholdFeaturePermissions,
  deleteFeaturePermission,
  getDefaultFeaturePermissions,
  // Restriction functions
  getRestrictionInfo,
  isRestricted,
  setRestriction,
};
