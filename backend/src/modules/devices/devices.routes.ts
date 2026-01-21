import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { devices, deviceSettings, deviceRules } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireAdmin, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { deviceTypeSchema } from '../../lib/validators.js';

const createDeviceSchema = z.object({
  name: z.string().min(1).max(255),
  type: deviceTypeSchema,
  isFixed: z.boolean().default(false),
  allowedPages: z.array(z.string()).optional(),
  defaultUserId: z.string().uuid().optional(),
});

const updateDeviceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: deviceTypeSchema.optional(),
  isFixed: z.boolean().optional(),
  allowedPages: z.array(z.string()).optional(),
  defaultUserId: z.string().uuid().nullable().optional(),
});

const createRuleSchema = z.object({
  ruleType: z.enum(['time_based', 'user_based', 'always']),
  condition: z.record(z.unknown()).optional(),
  allowedPages: z.array(z.string()).optional(),
  deniedPages: z.array(z.string()).optional(),
  defaultUserId: z.string().uuid().optional(),
  priority: z.number().int().optional(),
});

export async function devicesRoutes(app: FastifyInstance): Promise<void> {
  // List devices
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const deviceList = await db.query.devices.findMany({
        where: eq(devices.householdId, request.user!.householdId),
        orderBy: (d, { desc }) => [desc(d.lastSeen)],
      });

      return { success: true, data: { devices: deviceList } };
    }
  );

  // Register new device
  app.post(
    '/',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createDeviceSchema.parse(request.body);

      const [device] = await db
        .insert(devices)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          type: input.type,
          isFixed: input.isFixed,
          allowedPages: input.allowedPages || [],
          defaultUserId: input.defaultUserId,
        })
        .returning();

      // Create default device settings
      await db.insert(deviceSettings).values({
        deviceId: device.id,
        screensaverEnabled: false,
        showCalendarOnScreensaver: true,
        hiddenPages: [],
      });

      return { success: true, data: { device } };
    }
  );

  // Get device by ID
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const device = await db.query.devices.findFirst({
        where: and(
          eq(devices.id, request.params.id),
          eq(devices.householdId, request.user!.householdId)
        ),
      });

      if (!device) {
        throw Errors.notFound('Device');
      }

      const settings = await db.query.deviceSettings.findFirst({
        where: eq(deviceSettings.deviceId, device.id),
      });

      return { success: true, data: { device, settings } };
    }
  );

  // Update device
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = updateDeviceSchema.parse(request.body);

      const [updated] = await db
        .update(devices)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(devices.id, request.params.id),
            eq(devices.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Device');
      }

      return { success: true, data: { device: updated } };
    }
  );

  // Delete device
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db
        .delete(devices)
        .where(
          and(
            eq(devices.id, request.params.id),
            eq(devices.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Device deleted' } };
    }
  );

  // Get device rules
  app.get<{ Params: { id: string } }>(
    '/:id/rules',
    { preHandler: [authMiddleware] },
    async (request) => {
      const rules = await db.query.deviceRules.findMany({
        where: eq(deviceRules.deviceId, request.params.id),
        orderBy: (r, { asc }) => [asc(r.priority)],
      });

      return { success: true, data: { rules } };
    }
  );

  // Create device rule
  app.post<{ Params: { id: string } }>(
    '/:id/rules',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      const input = createRuleSchema.parse(request.body);

      // Verify device exists and belongs to household
      const device = await db.query.devices.findFirst({
        where: and(
          eq(devices.id, request.params.id),
          eq(devices.householdId, request.user!.householdId)
        ),
      });

      if (!device) {
        throw Errors.notFound('Device');
      }

      const [rule] = await db
        .insert(deviceRules)
        .values({
          deviceId: request.params.id,
          ruleType: input.ruleType,
          condition: input.condition,
          allowedPages: input.allowedPages || [],
          deniedPages: input.deniedPages || [],
          defaultUserId: input.defaultUserId,
        })
        .returning();

      return { success: true, data: { rule } };
    }
  );

  // Delete device rule
  app.delete<{ Params: { id: string; ruleId: string } }>(
    '/:id/rules/:ruleId',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await db.delete(deviceRules).where(eq(deviceRules.id, request.params.ruleId));

      return { success: true, data: { message: 'Rule deleted' } };
    }
  );

  // Update last seen (called by device)
  app.post<{ Params: { id: string } }>(
    '/:id/heartbeat',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .update(devices)
        .set({ lastSeen: new Date() })
        .where(
          and(
            eq(devices.id, request.params.id),
            eq(devices.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Heartbeat recorded' } };
    }
  );
}
