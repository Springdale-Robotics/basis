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

  // SSE proxy for counsel mode discussion stream
  // IMPORTANT: This route must be registered BEFORE /:sessionId to ensure proper matching
  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId/counsel/stream',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const session = await getSession(request.params.sessionId, request.user!.householdId);

      if (!session) {
        throw Errors.notFound('Session');
      }

      if (!session.originalImagePath) {
        throw Errors.validation('No image to process');
      }

      // Import config for VLM service URL
      const { config } = await import('../../config/index.js');

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        // Make request to Python VLM-LLM service counsel endpoint
        const vlmServiceUrl = config.VLM_LLM_SERVICE_URL || 'http://vlm-llm:8000';

        // Read the image file and convert to base64
        const fs = await import('fs/promises');
        const path = await import('path');
        const imagePath = path.join(process.cwd(), 'uploads', path.basename(session.originalImagePath));
        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');

        logger.info({ sessionId: request.params.sessionId, imagePath }, 'Starting counsel mode with image');

        const response = await fetch(`${vlmServiceUrl}/extract/counsel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_data: imageBase64,
            num_vlm_passes: 3, // Reduced from 5 for faster processing
          }),
        });

        if (!response.ok) {
          throw new Error(`VLM service error: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('No response body from VLM service');
        }

        // Stream the SSE response through to client
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const interpretations: unknown[] = [];
        const disagreements: unknown[] = [];
        const discussion: unknown[] = [];
        const votes: unknown[] = [];

        logger.info({ sessionId: request.params.sessionId }, 'Starting counsel stream proxy');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          logger.debug({ chunkLength: chunk.length }, 'Received counsel chunk');

          // Parse and collect counsel data for storage
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              logger.debug({ eventType: line.slice(7) }, 'SSE event type');
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                // Collect data based on event type from previous line
                // (simplified - in production would track event type properly)
                if (data.persona_id && data.persona_name && data.ingredient_count !== undefined) {
                  interpretations.push(data);
                } else if (data.topic && data.positions) {
                  disagreements.push(data);
                } else if (data.speaker_id && data.message) {
                  discussion.push(data);
                } else if (data.tally && data.winner) {
                  votes.push(data);
                }
              } catch {
                // Not JSON, ignore
              }
            }
          }

          // Write chunk and flush immediately for SSE
          reply.raw.write(chunk);
          if (typeof (reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush === 'function') {
            (reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush!();
          }
        }

        logger.info({
          sessionId: request.params.sessionId,
          interpretationsCount: interpretations.length,
          discussionCount: discussion.length,
          votesCount: votes.length,
        }, 'Counsel stream completed');

        // Store counsel discussion data in session
        const { db } = await import('../../config/database.js');
        const { imageParseSessions } = await import('../../db/schema/image-parse.js');
        const { eq } = await import('drizzle-orm');

        await db
          .update(imageParseSessions)
          .set({
            counselDiscussion: {
              interpretations: interpretations as never[],
              disagreements: disagreements as never[],
              discussion: discussion as never[],
              votes: votes as never[],
            },
            updatedAt: new Date(),
          })
          .where(eq(imageParseSessions.id, session.id));

        reply.raw.end();
      } catch (error) {
        logger.error({ error, sessionId: request.params.sessionId }, 'Counsel stream failed');
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Stream failed' })}\n\n`);
        reply.raw.end();
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
