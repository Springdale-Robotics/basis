import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { requireResourceAccess } from '../../middleware/permission.middleware.js';
import {
  permissionService,
  canAccess,
  getResourcePermissions,
  grantPermission,
  revokePermission,
  updatePermissionLevel,
  getHouseholdFeaturePermissions,
  setFeaturePermission,
  deleteFeaturePermission,
  getDefaultFeaturePermissions,
} from '../../services/permission.service.js';
import { Errors } from '../../lib/errors.js';
import {
  resourceTypeSchema,
  granteeTypeSchema,
  permissionLevelSchema,
  featureSchema,
  type ResourceType,
  type Feature,
} from '../../lib/validators.js';

const grantPermissionSchema = z.object({
  granteeType: granteeTypeSchema,
  granteeId: z.string().min(1),
  level: permissionLevelSchema,
});

const updatePermissionSchema = z.object({
  level: permissionLevelSchema,
});

export async function permissionsRoutes(app: FastifyInstance): Promise<void> {
  // Get all permissions for a resource
  app.get<{ Params: { resourceType: string; resourceId: string } }>(
    '/:resourceType/:resourceId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const resourceType = resourceTypeSchema.parse(request.params.resourceType);
      const { resourceId } = request.params;

      // Check if user has at least view access to the resource
      const context = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
        deviceId: request.user!.deviceId,
      };

      const hasAccess = await canAccess(context, resourceType, resourceId, 'view');
      if (!hasAccess) {
        throw Errors.forbidden('You cannot view permissions for this resource');
      }

      const permissions = await getResourcePermissions(resourceType, resourceId);

      return { success: true, data: { permissions } };
    }
  );

  // Grant a new permission on a resource
  app.post<{ Params: { resourceType: string; resourceId: string } }>(
    '/:resourceType/:resourceId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const resourceType = resourceTypeSchema.parse(request.params.resourceType);
      const { resourceId } = request.params;
      const input = grantPermissionSchema.parse(request.body);

      // Check if user has admin access to the resource
      const context = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
        deviceId: request.user!.deviceId,
      };

      const hasAccess = await canAccess(context, resourceType, resourceId, 'admin');
      if (!hasAccess) {
        throw Errors.forbidden('You need admin access to manage permissions');
      }

      const permissionId = await grantPermission(
        resourceType,
        resourceId,
        input.granteeType,
        input.granteeId,
        input.level,
        request.user!.id
      );

      // Re-fetch the permission with details
      const permissions = await getResourcePermissions(resourceType, resourceId);
      const created = permissions.find((p) => p.id === permissionId);

      return { success: true, data: { permission: created } };
    }
  );

  // Update a permission level
  app.patch<{ Params: { resourceType: string; resourceId: string; permissionId: string } }>(
    '/:resourceType/:resourceId/:permissionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const resourceType = resourceTypeSchema.parse(request.params.resourceType);
      const { resourceId, permissionId } = request.params;
      const input = updatePermissionSchema.parse(request.body);

      // Check if user has admin access to the resource
      const context = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
        deviceId: request.user!.deviceId,
      };

      const hasAccess = await canAccess(context, resourceType, resourceId, 'admin');
      if (!hasAccess) {
        throw Errors.forbidden('You need admin access to manage permissions');
      }

      await updatePermissionLevel(permissionId, input.level);

      // Re-fetch the permission with details
      const permissions = await getResourcePermissions(resourceType, resourceId);
      const updated = permissions.find((p) => p.id === permissionId);

      if (!updated) {
        throw Errors.notFound('Permission');
      }

      return { success: true, data: { permission: updated } };
    }
  );

  // Revoke (delete) a permission
  app.delete<{ Params: { resourceType: string; resourceId: string; permissionId: string } }>(
    '/:resourceType/:resourceId/:permissionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const resourceType = resourceTypeSchema.parse(request.params.resourceType);
      const { resourceId, permissionId } = request.params;

      // Check if user has admin access to the resource
      const context = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
        deviceId: request.user!.deviceId,
      };

      const hasAccess = await canAccess(context, resourceType, resourceId, 'admin');
      if (!hasAccess) {
        throw Errors.forbidden('You need admin access to manage permissions');
      }

      await revokePermission(permissionId);

      return { success: true, data: { message: 'Permission revoked' } };
    }
  );

  // Get current user's access level for a resource
  app.get<{ Params: { resourceType: string; resourceId: string } }>(
    '/:resourceType/:resourceId/my-access',
    { preHandler: [authMiddleware] },
    async (request) => {
      const resourceType = resourceTypeSchema.parse(request.params.resourceType);
      const { resourceId } = request.params;

      const context = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
        deviceId: request.user!.deviceId,
      };

      const accessLevel = await permissionService.getAccessLevel(
        context,
        resourceType,
        resourceId
      );

      const isOwner = await permissionService.isOwner(
        request.user!.id,
        resourceType,
        resourceId
      );

      return {
        success: true,
        data: {
          accessLevel,
          isOwner,
          canView: accessLevel !== null,
          canEdit: accessLevel !== null && ['edit', 'admin'].includes(accessLevel),
          canAdmin: accessLevel === 'admin',
        },
      };
    }
  );

  // ===== FEATURE-LEVEL PERMISSIONS =====

  const setFeaturePermissionSchema = z.object({
    granteeType: granteeTypeSchema,
    granteeId: z.string().min(1),
    level: permissionLevelSchema,
  });

  // Get all feature permissions for household + defaults
  app.get(
    '/features',
    { preHandler: [authMiddleware] },
    async (request) => {
      const permissions = await getHouseholdFeaturePermissions(request.user!.householdId);
      const defaults = getDefaultFeaturePermissions();

      return {
        success: true,
        data: {
          permissions,
          defaults,
        },
      };
    }
  );

  // Get current user's feature access levels
  app.get(
    '/features/my-access',
    { preHandler: [authMiddleware] },
    async (request) => {
      const context = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
        userRole: request.user!.role,
        deviceId: request.user!.deviceId,
      };

      const features: Feature[] = [
        'recipes', 'inventory', 'meal_plan', 'shopping_list',
        'files', 'calendars', 'lists', 'tasks', 'settings'
      ];

      const accessLevels: Record<string, {
        level: string | null;
        canView: boolean;
        canEdit: boolean;
        canAdmin: boolean;
      }> = {};

      for (const feature of features) {
        const level = await permissionService.getFeatureAccessLevel(context, feature);
        accessLevels[feature] = {
          level,
          canView: level !== null,
          canEdit: level !== null && ['edit', 'admin'].includes(level),
          canAdmin: level === 'admin',
        };
      }

      return {
        success: true,
        data: { features: accessLevels },
      };
    }
  );

  // Set/update feature permission
  app.put<{ Params: { feature: string } }>(
    '/features/:feature',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const feature = featureSchema.parse(request.params.feature);
      const input = setFeaturePermissionSchema.parse(request.body);

      const permissionId = await setFeaturePermission(
        request.user!.householdId,
        feature,
        input.granteeType,
        input.granteeId,
        input.level
      );

      return {
        success: true,
        data: {
          message: 'Feature permission updated',
          permissionId,
        },
      };
    }
  );

  // Delete feature permission (revert to role default)
  app.delete<{ Params: { feature: string; granteeType: string; granteeId: string } }>(
    '/features/:feature/:granteeType/:granteeId',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const feature = featureSchema.parse(request.params.feature);
      const granteeType = granteeTypeSchema.parse(request.params.granteeType);
      const { granteeId } = request.params;

      await deleteFeaturePermission(
        request.user!.householdId,
        feature,
        granteeType,
        granteeId
      );

      return {
        success: true,
        data: { message: 'Feature permission removed, reverted to role default' },
      };
    }
  );
}
