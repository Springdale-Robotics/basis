import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client';

export type ResourceType =
  | 'calendar'
  | 'recipe'
  | 'task'
  | 'file'
  | 'album'
  | 'list'
  | 'page'
  | 'inventory_area'
  | 'feature';

export type Feature =
  | 'recipes'
  | 'inventory'
  | 'meal_plan'
  | 'shopping_list'
  | 'files'
  | 'calendars'
  | 'lists'
  | 'tasks'
  | 'settings';

export type UserRole = 'admin' | 'member' | 'kid' | 'visitor';

export type GranteeType =
  | 'user'
  | 'role'
  | 'group'
  | 'household'
  | 'external'
  | 'device';

export type PermissionLevel = 'none' | 'view_busy' | 'view' | 'edit' | 'admin';

export interface Permission {
  id: string;
  granteeType: GranteeType;
  granteeId: string;
  permissionLevel: PermissionLevel;
  grantee: {
    name: string;
    email?: string;
  } | null;
  createdAt: string;
}

export interface GrantPermissionInput {
  granteeType: GranteeType;
  granteeId: string;
  level: PermissionLevel;
}

export interface MyAccessInfo {
  accessLevel: PermissionLevel | null;
  isOwner: boolean;
  canView: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}

// Get all permissions for a resource
export function getResourcePermissions(
  resourceType: ResourceType,
  resourceId: string
) {
  return apiGet<{ permissions: Permission[] }>(
    `/permissions/${resourceType}/${resourceId}`
  );
}

// Grant a new permission on a resource
export function grantPermission(
  resourceType: ResourceType,
  resourceId: string,
  input: GrantPermissionInput
) {
  return apiPost<{ permission: Permission }>(
    `/permissions/${resourceType}/${resourceId}`,
    input
  );
}

// Update a permission level
export function updatePermission(
  resourceType: ResourceType,
  resourceId: string,
  permissionId: string,
  level: PermissionLevel
) {
  return apiPatch<{ permission: Permission }>(
    `/permissions/${resourceType}/${resourceId}/${permissionId}`,
    { level }
  );
}

// Revoke (delete) a permission
export function revokePermission(
  resourceType: ResourceType,
  resourceId: string,
  permissionId: string
) {
  return apiDelete<{ message: string }>(
    `/permissions/${resourceType}/${resourceId}/${permissionId}`
  );
}

// Get current user's access level for a resource
export function getMyAccess(resourceType: ResourceType, resourceId: string) {
  return apiGet<MyAccessInfo>(
    `/permissions/${resourceType}/${resourceId}/my-access`
  );
}

// ===== FEATURE-LEVEL PERMISSIONS =====

export interface FeaturePermission {
  id: string;
  feature: Feature;
  granteeType: GranteeType;
  granteeId: string;
  permissionLevel: PermissionLevel;
  grantee: {
    name: string;
    email?: string;
  } | null;
  createdAt: string;
}

export type FeatureDefaults = Record<Feature, Record<UserRole, PermissionLevel | null>>;

export interface FeatureAccessInfo {
  level: PermissionLevel | null;
  canView: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}

// Get all feature permissions for household + defaults
export function getFeaturePermissions() {
  return apiGet<{
    permissions: FeaturePermission[];
    defaults: FeatureDefaults;
  }>('/permissions/features');
}

// Get current user's feature access levels
export function getMyFeatureAccess() {
  return apiGet<{
    features: Record<Feature, FeatureAccessInfo>;
  }>('/permissions/features/my-access');
}

// Set/update feature permission
export function setFeaturePermission(
  feature: Feature,
  granteeType: GranteeType,
  granteeId: string,
  level: PermissionLevel
) {
  return apiPut<{ message: string; permissionId: string }>(
    `/permissions/features/${feature}`,
    { granteeType, granteeId, level }
  );
}

// Delete feature permission (revert to role default)
export function deleteFeaturePermission(
  feature: Feature,
  granteeType: GranteeType,
  granteeId: string
) {
  return apiDelete<{ message: string }>(
    `/permissions/features/${feature}/${granteeType}/${granteeId}`
  );
}

export const permissionsApi = {
  getForResource: getResourcePermissions,
  grant: grantPermission,
  update: updatePermission,
  revoke: revokePermission,
  getMyAccess,
  // Feature-level methods
  getFeaturePermissions,
  getMyFeatureAccess,
  setFeaturePermission,
  deleteFeaturePermission,
};
