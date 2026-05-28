import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { households, users } from '../../db/schema/index.js';
import { emailSchema, passwordSchema } from '../../lib/validators.js';
import argon2 from 'argon2';
import { createSession } from '../auth/auth.service.js';
import { config } from '../../config/index.js';

const setupHouseholdSchema = z.object({
  name: z.string().min(1).max(255),
});

const setupAdminSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(1).max(255),
  householdId: z.string().uuid(),
});

// Combined setup schema for one-step installation
const fullSetupSchema = z.object({
  householdName: z.string().min(1).max(255),
  timezone: z.string().default('UTC'),
  adminEmail: emailSchema,
  adminPassword: passwordSchema,
  adminDisplayName: z.string().min(1).max(255),
});

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  // One-step setup (for installer script)
  app.post('/', async (request, reply) => {
    // Check if already set up
    const existingHouseholds = await db
      .select({ id: households.id })
      .from(households)
      .limit(1);

    if (existingHouseholds.length > 0) {
      return {
        success: false,
        error: {
          code: 'SETUP_ALREADY_DONE',
          message: 'Setup has already been completed',
        },
      };
    }

    const input = fullSetupSchema.parse(request.body);

    // Create household
    const [household] = await db
      .insert(households)
      .values({
        name: input.householdName,
        timezone: input.timezone,
        settings: {
          enabledFeatures: {
            calendar: true,
            recipes: true,
            inventory: true,
            tasks: true,
            rewards: false,
            smartHome: config.ENABLE_SMART_HOME,
            nas: true,
          },
          theme: {
            mode: 'system',
            primaryColor: '#3B82F6',
            accentColor: '#10B981',
          },
          remoteAccess: {
            mode: 'local_only',
          },
        },
      })
      .returning();

    // Create admin user
    const passwordHash = await argon2.hash(input.adminPassword);

    const [user] = await db
      .insert(users)
      .values({
        householdId: household.id,
        email: input.adminEmail.toLowerCase(),
        passwordHash,
        displayName: input.adminDisplayName,
        role: 'admin',
      })
      .returning();

    // Create session
    const session = await createSession(
      user.id,
      undefined,
      request.ip,
      request.headers['user-agent']
    );

    // Set session cookie
    reply.setCookie('session', session.token, {
      httpOnly: true,
      secure: request.protocol === 'https',
      sameSite: 'lax',
      path: '/',
      maxAge: config.SESSION_MAX_AGE_MS / 1000,
    });

    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      success: true,
      data: {
        user: userWithoutPassword,
        household,
        message: 'Setup completed successfully',
      },
    };
  });

  // Check if setup is complete
  app.get('/status', async () => {
    const existingHouseholds = await db
      .select({ id: households.id })
      .from(households)
      .limit(1);

    const existingUsers = await db
      .select({ id: users.id })
      .from(users)
      .limit(1);

    const isSetupComplete = existingHouseholds.length > 0 && existingUsers.length > 0;

    return {
      success: true,
      data: {
        isSetupComplete,
        hasHousehold: existingHouseholds.length > 0,
        hasAdmin: existingUsers.length > 0,
      },
    };
  });

  // Create household during setup
  app.post('/household', async (request, reply) => {
    // Check if any household already exists
    const existingHouseholds = await db
      .select({ id: households.id })
      .from(households)
      .limit(1);

    if (existingHouseholds.length > 0) {
      return {
        success: false,
        error: {
          code: 'SETUP_ALREADY_DONE',
          message: 'Setup has already been completed',
        },
      };
    }

    const input = setupHouseholdSchema.parse(request.body);

    const [household] = await db
      .insert(households)
      .values({
        name: input.name,
        settings: {
          enabledFeatures: {
            calendar: true,
            recipes: true,
            inventory: true,
            tasks: true,
            rewards: false,
            smartHome: config.ENABLE_SMART_HOME,
            nas: true,
          },
          theme: {
            mode: 'system',
            primaryColor: '#3B82F6',
            accentColor: '#10B981',
          },
          remoteAccess: {
            mode: 'local_only',
          },
        },
      })
      .returning();

    return {
      success: true,
      data: { household, householdId: household.id },
    };
  });

  // Create admin user during setup
  app.post('/admin', async (request, reply) => {
    const input = setupAdminSchema.parse(request.body);

    // Check if household exists
    const household = await db.query.households.findFirst({
      where: (h, { eq }) => eq(h.id, input.householdId),
    });

    if (!household) {
      return {
        success: false,
        error: {
          code: 'HOUSEHOLD_NOT_FOUND',
          message: 'Household not found',
        },
      };
    }

    // Check if any users exist for this household
    const existingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.householdId, input.householdId))
      .limit(1);

    if (existingUsers.length > 0) {
      return {
        success: false,
        error: {
          code: 'ADMIN_EXISTS',
          message: 'Admin user already exists',
        },
      };
    }

    const passwordHash = await argon2.hash(input.password);

    const [user] = await db
      .insert(users)
      .values({
        householdId: input.householdId,
        email: input.email.toLowerCase(),
        passwordHash,
        displayName: input.displayName,
        role: 'admin',
      })
      .returning();

    // Create session
    const session = await createSession(
      user.id,
      undefined,
      request.ip,
      request.headers['user-agent']
    );

    // Set session cookie
    reply.setCookie('session', session.id, {
      httpOnly: true,
      secure: request.protocol === 'https',
      sameSite: 'lax',
      path: '/',
      maxAge: config.SESSION_MAX_AGE_MS / 1000,
    });

    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      success: true,
      data: {
        user: userWithoutPassword,
        household,
      },
    };
  });

  // Configure remote access during setup
  app.post('/remote-access', async (request) => {
    const schema = z.object({
      mode: z.enum(['local', 'cloudflare', 'tailscale', 'custom']),
      config: z.record(z.unknown()).optional(),
    });

    const input = schema.parse(request.body);

    // For now, just acknowledge the configuration
    // Actual remote access setup would be handled here
    return {
      success: true,
      data: { mode: input.mode },
    };
  });

  // Complete setup
  app.post('/complete', async () => {
    // Just return success for now - setup verification can be added later
    return {
      success: true,
      data: { message: 'Setup completed successfully', loginUrl: '/login' },
    };
  });
}
