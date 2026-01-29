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

        const data = await request.file();
        if (!data) {
          throw Errors.validation('No file uploaded');
        }

        logger.info({ mimetype: data.mimetype, filename: data.filename }, 'File received');

        // Get target type from fields if present
        const fields = data.fields as Record<string, { value?: string }>;
        const targetType = fields?.targetType?.value as ParsedContentType | undefined;

        logger.info({ targetType }, 'Creating session');

        // Create session
        const sessionId = await createSession(
          request.user!.householdId,
          request.user!.id,
          targetType
        );

        logger.info({ sessionId }, 'Session created, processing image');

        // Process uploaded image
        const imageBuffer = await data.toBuffer();
        await processUploadedImage(
          sessionId,
          request.user!.householdId,
          imageBuffer,
          data.mimetype,
          targetType
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
}
