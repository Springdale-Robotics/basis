import { randomBytes } from 'crypto';
import { FastifyInstance } from 'fastify';
import { db } from '../../config/database.js';
import { calendars, calendarEvents } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { generateIcsContent } from './ics.service.js';
import { logger } from '../../lib/logger.js';

/**
 * Generate a secure random token for public calendar URLs
 */
function generatePublicToken(): string {
  return randomBytes(32).toString('hex');
}

export async function calendarPublicRoutes(app: FastifyInstance): Promise<void> {
  // Get public ICS feed (no auth required)
  app.get<{ Params: { token: string } }>(
    '/public/:token/feed.ics',
    async (request, reply) => {
      const { token } = request.params;

      // Find calendar by public token
      const calendar = await db.query.calendars.findFirst({
        where: eq(calendars.publicToken, token),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      // Get all events for this calendar
      const events = await db.query.calendarEvents.findMany({
        where: eq(calendarEvents.calendarId, calendar.id),
        orderBy: (e, { asc }) => [asc(e.startTime)],
      });

      // Generate ICS content
      const icsContent = generateIcsContent(events, calendar.name);

      // Set appropriate headers for ICS subscription
      reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `inline; filename="${calendar.name.replace(/[^a-zA-Z0-9]/g, '_')}.ics"`)
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .header('X-WR-CALNAME', calendar.name)
        .send(icsContent);
    }
  );

  // Generate public link for a calendar
  app.post<{ Params: { id: string } }>(
    '/:id/public-link',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { id: calendarId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      // Generate new token (this also handles regeneration)
      const publicToken = generatePublicToken();

      await db
        .update(calendars)
        .set({
          publicToken,
          publicTokenCreatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));

      // Build the public URL
      const baseUrl = request.headers['x-forwarded-host']
        ? `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host']}`
        : `${request.protocol}://${request.hostname}`;

      const feedUrl = `${baseUrl}/api/v1/calendars/public/${publicToken}/feed.ics`;
      const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');

      logger.info(
        { calendarId, householdId: request.user!.householdId },
        'Generated public calendar link'
      );

      return {
        success: true,
        data: {
          publicToken,
          feedUrl,
          webcalUrl,
          createdAt: new Date().toISOString(),
        },
      };
    }
  );

  // Get current public link status
  app.get<{ Params: { id: string } }>(
    '/:id/public-link',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { id: calendarId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      if (!calendar.publicToken) {
        return {
          success: true,
          data: {
            enabled: false,
          },
        };
      }

      // Build the public URL
      const baseUrl = request.headers['x-forwarded-host']
        ? `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host']}`
        : `${request.protocol}://${request.hostname}`;

      const feedUrl = `${baseUrl}/api/v1/calendars/public/${calendar.publicToken}/feed.ics`;
      const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');

      return {
        success: true,
        data: {
          enabled: true,
          publicToken: calendar.publicToken,
          feedUrl,
          webcalUrl,
          createdAt: calendar.publicTokenCreatedAt?.toISOString(),
        },
      };
    }
  );

  // Revoke public link
  app.delete<{ Params: { id: string } }>(
    '/:id/public-link',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { id: calendarId } = request.params;

      // Verify calendar exists and belongs to household
      const calendar = await db.query.calendars.findFirst({
        where: and(
          eq(calendars.id, calendarId),
          eq(calendars.householdId, request.user!.householdId)
        ),
      });

      if (!calendar) {
        throw Errors.notFound('Calendar');
      }

      if (!calendar.publicToken) {
        throw Errors.validation('No public link to revoke');
      }

      await db
        .update(calendars)
        .set({
          publicToken: null,
          publicTokenCreatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));

      logger.info(
        { calendarId, householdId: request.user!.householdId },
        'Revoked public calendar link'
      );

      return {
        success: true,
        data: { message: 'Public link revoked' },
      };
    }
  );
}
