import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { calendars } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { encrypt, decrypt, generateOAuthState } from '../../lib/crypto.js';
import { config } from '../../config/index.js';
import { redis } from '../../config/redis.js';
import {
  createOAuth2Client,
  getAuthUrl,
  getTokensFromCode,
  listGoogleCalendars,
  syncCalendarFromGoogle,
} from './google-sync.service.js';
import {
  createMsalClient,
  getAuthUrl as getMsAuthUrl,
  getTokensFromCode as getMsTokensFromCode,
  listOutlookCalendars,
  syncCalendarFromOutlook,
} from './outlook-sync.service.js';

const OAUTH_STATE_TTL = 600; // 10 minutes

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // Check if Google Calendar sync is configured
  app.get(
    '/sync/google/status',
    { preHandler: [authMiddleware] },
    async () => {
      const isConfigured = !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
      return {
        success: true,
        data: { configured: isConfigured },
      };
    }
  );

  // Start Google OAuth flow
  app.post(
    '/sync/google/connect',
    { preHandler: [authMiddleware, requireMember()] },
    async (request, reply) => {
      if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
        throw Errors.badRequest('Google Calendar sync is not configured');
      }

      // Generate OAuth state with user info
      const state = generateOAuthState();
      const stateData = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
      };

      // Store state in Redis
      await redis.setex(
        `oauth:google:${state}`,
        OAUTH_STATE_TTL,
        JSON.stringify(stateData)
      );

      // Get the redirect URI from the request
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      const redirectUri = `${protocol}://${host}/api/v1/calendars/sync/google/callback`;

      const oauth2Client = createOAuth2Client(redirectUri);
      const authUrl = getAuthUrl(oauth2Client, state);

      return {
        success: true,
        data: { authUrl },
      };
    }
  );

  // Google OAuth callback
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/sync/google/callback',
    async (request, reply) => {
      const { code, state, error } = request.query;

      // Handle OAuth errors
      if (error) {
        return reply.redirect(`/settings/calendars?error=${encodeURIComponent(error)}`);
      }

      if (!code || !state) {
        return reply.redirect('/settings/calendars?error=missing_params');
      }

      // Verify state
      const stateDataStr = await redis.get(`oauth:google:${state}`);
      if (!stateDataStr) {
        return reply.redirect('/settings/calendars?error=invalid_state');
      }

      await redis.del(`oauth:google:${state}`);

      const stateData = JSON.parse(stateDataStr) as {
        userId: string;
        householdId: string;
      };

      // Get the redirect URI
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      const redirectUri = `${protocol}://${host}/api/v1/calendars/sync/google/callback`;

      try {
        const oauth2Client = createOAuth2Client(redirectUri);
        const tokens = await getTokensFromCode(oauth2Client, code);

        // Store tokens temporarily in Redis for calendar selection
        const tempTokenKey = `oauth:google:tokens:${stateData.userId}`;
        await redis.setex(
          tempTokenKey,
          OAUTH_STATE_TTL,
          JSON.stringify(tokens)
        );

        return reply.redirect('/settings/calendars/google/select');
      } catch (err) {
        return reply.redirect('/settings/calendars?error=token_exchange_failed');
      }
    }
  );

  // List Google calendars for selection
  app.get(
    '/sync/google/calendars',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Get temporary tokens from Redis
      const tempTokenKey = `oauth:google:tokens:${request.user!.id}`;
      const tokensStr = await redis.get(tempTokenKey);

      if (!tokensStr) {
        throw Errors.badRequest('No pending Google connection. Please start the OAuth flow again.');
      }

      const tokens = JSON.parse(tokensStr) as {
        access_token: string;
        refresh_token: string;
        expiry_date: number;
      };

      const googleCalendars = await listGoogleCalendars(tokens.access_token);

      return {
        success: true,
        data: { calendars: googleCalendars },
      };
    }
  );

  // Complete Google Calendar connection (select and sync calendar)
  app.post(
    '/sync/google/complete',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { googleCalendarId, name, color } = z
        .object({
          googleCalendarId: z.string().min(1),
          name: z.string().min(1).max(255),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        })
        .parse(request.body);

      // Get temporary tokens from Redis
      const tempTokenKey = `oauth:google:tokens:${request.user!.id}`;
      const tokensStr = await redis.get(tempTokenKey);

      if (!tokensStr) {
        throw Errors.badRequest('No pending Google connection. Please start the OAuth flow again.');
      }

      const tokens = JSON.parse(tokensStr) as {
        access_token: string;
        refresh_token: string;
        expiry_date: number;
      };

      // Delete temporary tokens
      await redis.del(tempTokenKey);

      // Encrypt credentials for storage
      const encryptedCredentials = encrypt(JSON.stringify(tokens));

      // Create synced calendar
      const [calendar] = await db
        .insert(calendars)
        .values({
          householdId: request.user!.householdId,
          ownerId: request.user!.id,
          name,
          color: color || '#4285F4', // Google blue
          type: 'synced',
          isSynced: true,
          isReadOnly: false, // Allow two-way sync
          syncProvider: 'google',
          syncCredentials: encryptedCredentials,
          syncCalendarId: googleCalendarId,
        })
        .returning();

      // Trigger initial sync
      try {
        const syncResult = await syncCalendarFromGoogle(
          calendar.id,
          request.user!.householdId
        );

        return {
          success: true,
          data: {
            calendar,
            syncResult,
          },
        };
      } catch (syncError) {
        // Calendar was created but sync failed
        return {
          success: true,
          data: {
            calendar,
            syncError: 'Initial sync failed. You can try syncing manually.',
          },
        };
      }
    }
  );

  // Manually trigger sync for a calendar
  app.post<{ Params: { id: string } }>(
    '/:id/sync',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.id),
          eq(calendars.householdId, request.user!.householdId),
          eq(calendars.isSynced, true)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      if (!calendar.syncProvider) {
        throw Errors.badRequest('Calendar is not configured for sync');
      }

      let syncResult;
      if (calendar.syncProvider === 'google') {
        syncResult = await syncCalendarFromGoogle(
          calendar.id,
          request.user!.householdId
        );
      } else if (calendar.syncProvider === 'outlook') {
        syncResult = await syncCalendarFromOutlook(
          calendar.id,
          request.user!.householdId
        );
      } else {
        throw Errors.badRequest('Unsupported sync provider');
      }

      return {
        success: true,
        data: { syncResult },
      };
    }
  );

  // Disconnect synced calendar
  app.post<{ Params: { id: string } }>(
    '/:id/disconnect',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const [updated] = await db
        .update(calendars)
        .set({
          isSynced: false,
          syncProvider: null,
          syncCredentials: null,
          syncCalendarId: null,
          lastSyncAt: null,
          syncError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(calendars.id, request.params.id),
            eq(calendars.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) {
        throw Errors.notFound('Calendar');
      }

      return {
        success: true,
        data: { calendar: updated },
      };
    }
  );

  // Get sync status for a calendar
  app.get<{ Params: { id: string } }>(
    '/:id/sync/status',
    { preHandler: [authMiddleware] },
    async (request) => {
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, request.params.id),
          eq(calendars.householdId, request.user!.householdId)
        ),
        columns: {
          id: true,
          isSynced: true,
          syncProvider: true,
          lastSyncAt: true,
          syncError: true,
        },
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      return {
        success: true,
        data: {
          synced: calendar.isSynced,
          provider: calendar.syncProvider,
          lastSyncAt: calendar.lastSyncAt,
          error: calendar.syncError,
        },
      };
    }
  );

  // ========== Microsoft Outlook Calendar Sync ==========

  // Check if Outlook Calendar sync is configured
  app.get(
    '/sync/outlook/status',
    { preHandler: [authMiddleware] },
    async () => {
      const isConfigured = !!(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET);
      return {
        success: true,
        data: { configured: isConfigured },
      };
    }
  );

  // Start Microsoft OAuth flow
  app.post(
    '/sync/outlook/connect',
    { preHandler: [authMiddleware, requireMember()] },
    async (request, reply) => {
      const msalClient = createMsalClient();
      if (!msalClient) {
        throw Errors.badRequest('Outlook Calendar sync is not configured');
      }

      // Generate OAuth state with user info
      const state = generateOAuthState();
      const stateData = {
        userId: request.user!.id,
        householdId: request.user!.householdId,
      };

      // Store state in Redis
      await redis.setex(
        `oauth:outlook:${state}`,
        OAUTH_STATE_TTL,
        JSON.stringify(stateData)
      );

      // Get the redirect URI from the request
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      const redirectUri = `${protocol}://${host}/api/v1/calendars/sync/outlook/callback`;

      const authUrl = await getMsAuthUrl(msalClient, redirectUri, state);

      return {
        success: true,
        data: { authUrl },
      };
    }
  );

  // Microsoft OAuth callback
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/sync/outlook/callback',
    async (request, reply) => {
      const { code, state, error, error_description } = request.query;

      // Handle OAuth errors
      if (error) {
        return reply.redirect(`/settings/calendars?error=${encodeURIComponent(error_description || error)}`);
      }

      if (!code || !state) {
        return reply.redirect('/settings/calendars?error=missing_params');
      }

      // Verify state
      const stateDataStr = await redis.get(`oauth:outlook:${state}`);
      if (!stateDataStr) {
        return reply.redirect('/settings/calendars?error=invalid_state');
      }

      await redis.del(`oauth:outlook:${state}`);

      const stateData = JSON.parse(stateDataStr) as {
        userId: string;
        householdId: string;
      };

      // Get the redirect URI
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      const redirectUri = `${protocol}://${host}/api/v1/calendars/sync/outlook/callback`;

      try {
        const msalClient = createMsalClient();
        if (!msalClient) {
          throw new Error('MSAL client not configured');
        }

        const tokens = await getMsTokensFromCode(msalClient, code, redirectUri);

        // Store tokens temporarily in Redis for calendar selection
        const tempTokenKey = `oauth:outlook:tokens:${stateData.userId}`;
        await redis.setex(
          tempTokenKey,
          OAUTH_STATE_TTL,
          JSON.stringify(tokens)
        );

        return reply.redirect('/settings/calendars/outlook/select');
      } catch (err) {
        return reply.redirect('/settings/calendars?error=token_exchange_failed');
      }
    }
  );

  // List Outlook calendars for selection
  app.get(
    '/sync/outlook/calendars',
    { preHandler: [authMiddleware] },
    async (request) => {
      // Get temporary tokens from Redis
      const tempTokenKey = `oauth:outlook:tokens:${request.user!.id}`;
      const tokensStr = await redis.get(tempTokenKey);

      if (!tokensStr) {
        throw Errors.badRequest('No pending Outlook connection. Please start the OAuth flow again.');
      }

      const tokens = JSON.parse(tokensStr) as {
        access_token: string;
        refresh_token: string;
        expiry_date: number;
      };

      const outlookCalendars = await listOutlookCalendars(tokens.access_token);

      return {
        success: true,
        data: { calendars: outlookCalendars },
      };
    }
  );

  // Complete Outlook Calendar connection (select and sync calendar)
  app.post(
    '/sync/outlook/complete',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { outlookCalendarId, name, color } = z
        .object({
          outlookCalendarId: z.string().min(1),
          name: z.string().min(1).max(255),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        })
        .parse(request.body);

      // Get temporary tokens from Redis
      const tempTokenKey = `oauth:outlook:tokens:${request.user!.id}`;
      const tokensStr = await redis.get(tempTokenKey);

      if (!tokensStr) {
        throw Errors.badRequest('No pending Outlook connection. Please start the OAuth flow again.');
      }

      const tokens = JSON.parse(tokensStr) as {
        access_token: string;
        refresh_token: string;
        expiry_date: number;
      };

      // Delete temporary tokens
      await redis.del(tempTokenKey);

      // Encrypt credentials for storage
      const encryptedCredentials = encrypt(JSON.stringify(tokens));

      // Create synced calendar
      const [calendar] = await db
        .insert(calendars)
        .values({
          householdId: request.user!.householdId,
          ownerId: request.user!.id,
          name,
          color: color || '#0078D4', // Microsoft blue
          type: 'synced',
          isSynced: true,
          isReadOnly: false,
          syncProvider: 'outlook',
          syncCredentials: encryptedCredentials,
          syncCalendarId: outlookCalendarId,
        })
        .returning();

      // Trigger initial sync
      try {
        const syncResult = await syncCalendarFromOutlook(
          calendar.id,
          request.user!.householdId
        );

        return {
          success: true,
          data: {
            calendar,
            syncResult,
          },
        };
      } catch (syncError) {
        // Calendar was created but sync failed
        return {
          success: true,
          data: {
            calendar,
            syncError: 'Initial sync failed. You can try syncing manually.',
          },
        };
      }
    }
  );
}
