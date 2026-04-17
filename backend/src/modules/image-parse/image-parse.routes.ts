import { FastifyInstance } from 'fastify';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  createSession,
  processUploadedImage,
  getSession,
  updateSessionType,
  updateSessionContent,
  confirmSession,
  cancelSession,
  getAIStatus,
} from './image-parse.service.js';
import {
  updateTypeBodySchema,
  updateListContentSchema,
  updateRecipeContentSchema,
  updateCalendarContentSchema,
  confirmSessionBodySchema,
} from './image-parse.schemas.js';
import type {
  ParsedListContent,
  ParsedRecipeContent,
  ParsedCalendarContent,
  ParsedContentType,
  ExtractionMode,
} from '../../db/schema/image-parse.js';

export async function imageParseRoutes(app: FastifyInstance): Promise<void> {
  // Get AI service status
  app.get(
    '/status',
    { preHandler: [authMiddleware] },
    async () => {
      const status = await getAIStatus();
      return { success: true, data: status };
    }
  );

  // Upload image and start parsing session
  app.post(
    '/upload',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      try {
        logger.info('Image parse upload started');

        const contentType = request.headers['content-type'] || '';

        if (!contentType.includes('multipart/form-data')) {
          throw Errors.validation('Expected multipart/form-data');
        }

        // Reject obviously oversized uploads early before buffering
        const contentLength = Number(request.headers['content-length'] || 0);
        const maxBytes = 10 * 1024 * 1024; // 10MB hard limit for image parsing
        if (contentLength > maxBytes) {
          throw Errors.validation('Image size exceeds maximum of 10MB');
        }

        const data = await request.file();
        if (!data) {
          throw Errors.validation('No file uploaded');
        }

        logger.info({ mimetype: data.mimetype, filename: data.filename }, 'File received');

        // Get target type and extraction mode from fields if present
        const fields = data.fields as Record<string, { value?: string }>;
        const fieldKeys = Object.keys(fields || {});
        const extractionModeField = fields?.extractionMode;
        logger.info({ fieldKeys, extractionModeRaw: extractionModeField?.value }, 'Received form fields');
        const targetType = fields?.targetType?.value as ParsedContentType | undefined;
        const extractionMode = (fields?.extractionMode?.value || 'accurate') as ExtractionMode;

        logger.info({ targetType, extractionMode }, 'Creating session');

        // Create session
        const sessionId = await createSession(
          request.user!.householdId,
          request.user!.id,
          targetType,
          extractionMode
        );

        logger.info({ sessionId }, 'Session created, processing image');

        // Process uploaded image
        const imageBuffer = await data.toBuffer();
        await processUploadedImage(
          sessionId,
          request.user!.householdId,
          imageBuffer,
          data.mimetype,
          targetType,
          extractionMode
        );

        logger.info({ sessionId }, 'Image processing queued');

        return {
          success: true,
          data: {
            sessionId,
            status: 'processing',
          },
        };
      } catch (error) {
        const err = error as Error;
        logger.error({
          message: err.message,
          stack: err.stack,
          name: err.name
        }, 'Image parse upload failed');
        throw error;
      }
    }
  );

  // Get session status and parsed content
  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const session = await getSession(request.params.sessionId, request.user!.householdId);

      if (!session) {
        throw Errors.notFound('Session');
      }

      // Don't return the raw image data to the client
      const { originalImagePath, ...sessionData } = session;

      return {
        success: true,
        data: {
          session: {
            ...sessionData,
            hasImage: !!originalImagePath,
          },
        },
      };
    }
  );

  // Reprocess session with AI
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/reprocess',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const session = await getSession(request.params.sessionId, request.user!.householdId);

      if (!session) {
        throw Errors.notFound('Session');
      }

      if (!session.originalImagePath) {
        throw Errors.validation('No image to reprocess');
      }

      // Import dynamically to avoid circular deps
      const { queueImageParse } = await import('../../jobs/index.js');
      const { db } = await import('../../config/database.js');
      const { imageParseSessions } = await import('../../db/schema/image-parse.js');
      const { eq } = await import('drizzle-orm');

      // Update status to processing
      await db
        .update(imageParseSessions)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(imageParseSessions.id, session.id));

      // Queue for reprocessing
      await queueImageParse({
        sessionId: session.id,
        householdId: request.user!.householdId,
      });

      return {
        success: true,
        data: { status: 'processing' },
      };
    }
  );

  // Change selected content type
  app.patch<{ Params: { sessionId: string } }>(
    '/:sessionId/type',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const { type } = updateTypeBodySchema.parse(request.body);

      await updateSessionType(request.params.sessionId, request.user!.householdId, type);

      const session = await getSession(request.params.sessionId, request.user!.householdId);

      return {
        success: true,
        data: { session },
      };
    }
  );

  // Update parsed content (user edits)
  app.patch<{ Params: { sessionId: string } }>(
    '/:sessionId/content',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const session = await getSession(request.params.sessionId, request.user!.householdId);

      if (!session) {
        throw Errors.notFound('Session');
      }

      // Validate based on content type
      let edits: Partial<ParsedListContent | ParsedRecipeContent | ParsedCalendarContent>;
      switch (session.selectedType) {
        case 'list':
          edits = updateListContentSchema.parse(request.body) as Partial<ParsedListContent>;
          break;
        case 'recipe':
          edits = updateRecipeContentSchema.parse(request.body) as Partial<ParsedRecipeContent>;
          break;
        case 'calendar_event':
          edits = updateCalendarContentSchema.parse(request.body) as Partial<ParsedCalendarContent>;
          break;
        default:
          throw Errors.validation(`Cannot update content of type: ${session.selectedType}`);
      }

      await updateSessionContent(request.params.sessionId, request.user!.householdId, edits);

      const updatedSession = await getSession(request.params.sessionId, request.user!.householdId);

      return {
        success: true,
        data: { session: updatedSession },
      };
    }
  );

  // Confirm session and create entities
  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/confirm',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const options = confirmSessionBodySchema.parse(request.body || {});

      const result = await confirmSession(
        request.params.sessionId,
        request.user!.householdId,
        request.user!.id,
        options
      );

      return {
        success: true,
        data: result,
      };
    }
  );

  // Cancel session
  app.delete<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { preHandler: [authMiddleware] },
    async (request) => {
      await cancelSession(request.params.sessionId, request.user!.householdId);

      return {
        success: true,
        data: { message: 'Session cancelled' },
      };
    }
  );

  // Batch status check for bulk import
  app.post(
    '/batch-status',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { sessionIds } = request.body as { sessionIds: string[] };

      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        throw Errors.validation('sessionIds must be a non-empty array');
      }

      const sessions = await Promise.all(
        sessionIds.map(id => getSession(id, request.user!.householdId))
      );

      const validSessions = sessions.filter(Boolean);
      const completed = validSessions.filter(s => s!.status === 'review' || s!.status === 'confirmed').length;
      const failed = validSessions.filter(s => s!.status === 'failed').length;
      const processing = validSessions.filter(s => s!.status === 'processing' || s!.status === 'uploading').length;

      return {
        success: true,
        data: {
          sessions: validSessions.map(s => {
            const { originalImagePath, ...rest } = s!;
            return { ...rest, hasImage: !!originalImagePath };
          }),
          summary: {
            total: sessionIds.length,
            completed,
            processing,
            failed,
            allDone: completed + failed === sessionIds.length,
          },
        },
      };
    }
  );
}
