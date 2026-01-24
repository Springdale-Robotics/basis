import { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { canAccess, clearPermissionCache, canAccessFeature } from '../services/permission.service.js';
import type { PermissionLevel, ResourceType, Feature } from '../lib/validators.js';
import { Errors } from '../lib/errors.js';

type ResourceIdGetter = (request: FastifyRequest) => string | Promise<string>;

/**
 * Creates middleware that checks if the user has the required permission level
 * for a specific resource.
 */
export function requireResourceAccess(
  resourceType: ResourceType,
  level: PermissionLevel,
  getResourceId: ResourceIdGetter
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw Errors.unauthorized();
    }

    const resourceId = await getResourceId(request);
    if (!resourceId) {
      throw Errors.notFound(resourceType);
    }

    // Clear cache at the start of each request cycle
    clearPermissionCache();

    const context = {
      userId: request.user.id,
      householdId: request.user.householdId,
      userRole: request.user.role,
      deviceId: request.user.deviceId,
    };

    const hasAccess = await canAccess(context, resourceType, resourceId, level);

    if (!hasAccess) {
      throw Errors.forbidden(`You don't have ${level} access to this ${resourceType}`);
    }
  };
}

// Type helper for route params
interface ParamsWithId {
  id: string;
}

/**
 * Recipe permission middleware.
 */
export function requireRecipeAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'recipe',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * Task permission middleware.
 */
export function requireTaskAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'task',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * File permission middleware.
 */
export function requireFileAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'file',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * List permission middleware.
 */
export function requireListAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'list',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * Calendar permission middleware.
 */
export function requireCalendarAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'calendar',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * Album permission middleware.
 */
export function requireAlbumAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'album',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * Inventory area permission middleware.
 */
export function requireInventoryAreaAccess(level: PermissionLevel): preHandlerHookHandler {
  return requireResourceAccess(
    'inventory_area',
    level,
    (request) => (request.params as ParamsWithId).id
  );
}

/**
 * Generic middleware that allows access if user owns the resource OR has the required permission.
 * Useful for allowing users to edit their own created items.
 */
export function requireOwnerOrAccess(
  resourceType: ResourceType,
  level: PermissionLevel,
  getResourceId: ResourceIdGetter
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw Errors.unauthorized();
    }

    const resourceId = await getResourceId(request);
    if (!resourceId) {
      throw Errors.notFound(resourceType);
    }

    clearPermissionCache();

    const context = {
      userId: request.user.id,
      householdId: request.user.householdId,
      userRole: request.user.role,
      deviceId: request.user.deviceId,
    };

    // Check if user has explicit permission
    const hasAccess = await canAccess(context, resourceType, resourceId, level);
    if (hasAccess) {
      return;
    }

    // If no explicit permission, deny access
    throw Errors.forbidden(`You don't have ${level} access to this ${resourceType}`);
  };
}

// ===== FEATURE-LEVEL MIDDLEWARE =====

/**
 * Creates middleware that checks if the user has the required permission level
 * for a feature (module-level access).
 */
export function requireFeatureAccess(
  feature: Feature,
  level: PermissionLevel
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw Errors.unauthorized();
    }

    // Clear cache at the start of each request cycle
    clearPermissionCache();

    const context = {
      userId: request.user.id,
      householdId: request.user.householdId,
      userRole: request.user.role,
      deviceId: request.user.deviceId,
    };

    const hasAccess = await canAccessFeature(context, feature, level);

    if (!hasAccess) {
      throw Errors.forbidden(`You don't have ${level} access to ${feature}`);
    }
  };
}

// Convenience helpers for feature-level access
export const requireRecipesAccess = (level: PermissionLevel) =>
  requireFeatureAccess('recipes', level);

export const requireInventoryAccess = (level: PermissionLevel) =>
  requireFeatureAccess('inventory', level);

export const requireMealPlanAccess = (level: PermissionLevel) =>
  requireFeatureAccess('meal_plan', level);

export const requireShoppingListAccess = (level: PermissionLevel) =>
  requireFeatureAccess('shopping_list', level);

export const requireFilesAccess = (level: PermissionLevel) =>
  requireFeatureAccess('files', level);

export const requireCalendarsAccess = (level: PermissionLevel) =>
  requireFeatureAccess('calendars', level);

export const requireListsAccess = (level: PermissionLevel) =>
  requireFeatureAccess('lists', level);

export const requireTasksAccess = (level: PermissionLevel) =>
  requireFeatureAccess('tasks', level);

export const requireSettingsAccess = (level: PermissionLevel) =>
  requireFeatureAccess('settings', level);
