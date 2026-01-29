import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import {
  imageParseSessions,
  type ParsedContent,
  type ParsedListContent,
  type ParsedRecipeContent,
  type ParsedCalendarContent,
  type ImageParseSession,
  type ParsedContentType,
  type ProcessingStage,
} from '../../db/schema/image-parse.js';
import { lists, listItems } from '../../db/schema/lists.js';
import { recipes, recipeIngredients } from '../../db/schema/recipes.js';
import { calendarEvents, calendars } from '../../db/schema/calendars.js';
import { getVisionProvider, getVisionProviderStatus } from './ai-providers/index.js';
import { detectContentType, buildExtractionPrompt } from './extractors/type-detector.js';
import { normalizeListContent, parseListFromText } from './extractors/list-extractor.js';
import { normalizeRecipeContent, parseRecipeFromText } from './extractors/recipe-extractor.js';
import { normalizeCalendarContent, parseCalendarFromText } from './extractors/calendar-extractor.js';
import { queueImageParse } from '../../jobs/index.js';

/**
 * Create a new image parse session
 */
export async function createSession(
  householdId: string,
  userId: string,
  targetType?: ParsedContentType
): Promise<string> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + config.IMAGE_PARSE_SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(imageParseSessions).values({
    id: sessionId,
    householdId,
    userId,
    status: 'uploading',
    selectedType: targetType,
    expiresAt,
  });

  return sessionId;
}

/**
 * Store uploaded image and queue for processing
 */
export async function processUploadedImage(
  sessionId: string,
  householdId: string,
  imageBuffer: Buffer,
  mimeType: string,
  targetType?: ParsedContentType
): Promise<void> {
  logger.info({ sessionId, bufferSize: imageBuffer.length, mimeType }, 'processUploadedImage started');

  // Validate file size
  const maxSizeBytes = config.IMAGE_PARSE_MAX_SIZE_MB * 1024 * 1024;
  if (imageBuffer.length > maxSizeBytes) {
    throw Errors.validation(`Image size exceeds maximum of ${config.IMAGE_PARSE_MAX_SIZE_MB}MB`);
  }

  // Validate mime type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
  if (!allowedTypes.includes(mimeType)) {
    throw Errors.validation(`Unsupported image type: ${mimeType}`);
  }

  logger.info({ sessionId }, 'Validation passed, converting to base64');

  // Store image data as base64 in database (temporary storage)
  const imageBase64 = imageBuffer.toString('base64');

  logger.info({ sessionId, base64Length: imageBase64.length }, 'Base64 conversion done, updating database');

  await db
    .update(imageParseSessions)
    .set({
      originalImagePath: imageBase64, // Store as base64 for now
      imageMimeType: mimeType,
      selectedType: targetType,
      status: 'processing',
      updatedAt: new Date(),
    })
    .where(
      and(eq(imageParseSessions.id, sessionId), eq(imageParseSessions.householdId, householdId))
    );

  logger.info({ sessionId }, 'Database updated, queuing job');

  // Queue for processing
  await queueImageParse({
    sessionId,
    householdId,
  });

  logger.info({ sessionId }, 'Job queued successfully');
}

/**
 * Update the processing stage of a session
 */
async function updateProcessingStage(sessionId: string, stage: ProcessingStage): Promise<void> {
  await db
    .update(imageParseSessions)
    .set({
      processingStage: stage,
      updatedAt: new Date(),
    })
    .where(eq(imageParseSessions.id, sessionId));
}

/**
 * Process the image using AI vision with progress tracking.
 *
 * Uses two-stage processing:
 * 1. VLM stage: Vision model reads the image and extracts raw text
 * 2. LLM stage: Language model structures the text into JSON
 *
 * Progress is reported via processingStage field in the session.
 */
export async function processImageWithAI(sessionId: string, householdId: string): Promise<void> {
  const session = await getSession(sessionId, householdId);

  if (!session || !session.originalImagePath) {
    throw Errors.notFound('Session or image');
  }

  const startTime = Date.now();
  const warnings: string[] = [];

  try {
    // Mark as queued
    await updateProcessingStage(sessionId, 'queued');

    // Get AI provider
    const provider = await getVisionProvider();

    if (!provider) {
      if (config.IMAGE_PARSE_REQUIRE_AI) {
        throw new Error('AI vision service not available');
      }

      // Fall back to returning the session in review state without AI parsing
      await db
        .update(imageParseSessions)
        .set({
          status: 'review',
          processingStage: null,
          parseWarnings: ['AI service unavailable - manual entry required'],
          processingTimeMs: String(Date.now() - startTime),
          updatedAt: new Date(),
        })
        .where(eq(imageParseSessions.id, sessionId));

      return;
    }

    // Decode image
    const imageBuffer = Buffer.from(session.originalImagePath, 'base64');
    const targetType = session.selectedType as ParsedContentType | null;

    logger.info({
      sessionId,
      targetType,
      model: provider.getModel(),
    }, 'Starting two-stage image parsing');

    // ==========================================================================
    // STAGE 1: VLM - Extract raw text from image
    // ==========================================================================
    await updateProcessingStage(sessionId, 'vlm_started');

    // Import the provider class to access vlmOnly and llmOnly methods
    const { VlmLlmProvider } = await import('./ai-providers/vlm-llm-provider.js');
    const vlmLlmProvider = provider as InstanceType<typeof VlmLlmProvider>;

    let rawText: string;
    let vlmProcessingMs: number;

    try {
      const vlmResult = await vlmLlmProvider.vlmOnly(imageBuffer);
      rawText = vlmResult.text;
      vlmProcessingMs = vlmResult.processingTimeMs;

      logger.info({
        sessionId,
        rawTextLength: rawText.length,
        vlmProcessingMs,
        vlmModel: vlmResult.model,
      }, 'VLM stage completed');
    } catch (vlmError) {
      logger.error({ sessionId, error: vlmError }, 'VLM stage failed');
      throw vlmError;
    }

    await updateProcessingStage(sessionId, 'vlm_done');

    // Detect content type from raw text (heuristic)
    const detected = detectContentType(rawText);
    let detectedType = detected.type;
    let confidence = detected.confidence;

    logger.info({
      sessionId,
      detectedType,
      confidence,
      reasoning: detected.reasoning,
    }, 'Content type detected from raw text');

    // ==========================================================================
    // STAGE 2: LLM - Structure the raw text into JSON
    // ==========================================================================
    await updateProcessingStage(sessionId, 'llm_started');

    let parsedContent: ParsedContent;
    let llmProcessingMs = 0;

    // Check if LLM is available
    const llmAvailable = await vlmLlmProvider.isLlmAvailable();

    if (llmAvailable && rawText.length > 0) {
      try {
        const llmResult = await vlmLlmProvider.llmOnly(rawText, targetType || undefined);
        llmProcessingMs = llmResult.processingTimeMs;

        // Use structured result if available
        if (llmResult.structured) {
          const structuredData = llmResult.structured as Record<string, unknown>;
          const structuredType = (structuredData.type as string) || llmResult.detectedType;

          // Update detected type if LLM provides it
          if (structuredType && structuredType !== 'unknown') {
            detectedType = structuredType as ParsedContentType;
          }

          // Update confidence if provided
          if (typeof structuredData.confidence === 'number') {
            confidence = structuredData.confidence;
          }

          parsedContent = normalizeParsedContent(detectedType, structuredData);
          logger.info({
            sessionId,
            detectedType,
            confidence,
            llmProcessingMs,
          }, 'LLM stage completed with structured output');
        } else {
          // LLM didn't return structured data, fall back to heuristic parsing
          warnings.push('LLM did not return structured data, using heuristic parsing');
          parsedContent = parseFromRawText(detectedType, rawText);
        }
      } catch (llmError) {
        logger.warn({ sessionId, error: llmError }, 'LLM stage failed, falling back to heuristic parsing');
        warnings.push('LLM structuring failed, using heuristic parsing');
        parsedContent = parseFromRawText(detectedType, rawText);
      }
    } else {
      // No LLM available, use heuristic parsing
      if (!llmAvailable) {
        warnings.push('LLM not available, using heuristic parsing');
      }
      parsedContent = parseFromRawText(detectedType, rawText);
    }

    await updateProcessingStage(sessionId, 'llm_done');

    // ==========================================================================
    // COMPLETE - Update session with results
    // ==========================================================================
    const totalProcessingMs = Date.now() - startTime;
    const finalType = targetType || detectedType;

    await db
      .update(imageParseSessions)
      .set({
        status: 'review',
        processingStage: null, // Clear stage when done
        rawText,
        detectedType,
        selectedType: finalType,
        confidence: String(confidence),
        parsedContent,
        parseWarnings: warnings.length > 0 ? warnings : [],
        processingTimeMs: String(totalProcessingMs),
        updatedAt: new Date(),
      })
      .where(eq(imageParseSessions.id, sessionId));

    logger.info(
      {
        sessionId,
        detectedType,
        selectedType: finalType,
        confidence,
        vlmProcessingMs,
        llmProcessingMs,
        totalProcessingMs,
      },
      'Image parsing completed'
    );
  } catch (error) {
    const err = error as Error;
    logger.error({
      sessionId,
      message: err.message,
      stack: err.stack,
      name: err.name,
      elapsedMs: Date.now() - startTime,
    }, 'Image parsing failed');

    await db
      .update(imageParseSessions)
      .set({
        status: 'failed',
        processingStage: null,
        parseWarnings: [error instanceof Error ? error.message : 'Unknown error'],
        processingTimeMs: String(Date.now() - startTime),
        updatedAt: new Date(),
      })
      .where(eq(imageParseSessions.id, sessionId));

    throw error;
  }
}

/**
 * Get a session by ID
 */
export async function getSession(
  sessionId: string,
  householdId: string
): Promise<ImageParseSession | null> {
  const session = await db.query.imageParseSessions.findFirst({
    where: and(
      eq(imageParseSessions.id, sessionId),
      eq(imageParseSessions.householdId, householdId)
    ),
  });

  return session || null;
}

/**
 * Update the selected content type for a session
 */
export async function updateSessionType(
  sessionId: string,
  householdId: string,
  newType: ParsedContentType
): Promise<void> {
  const session = await getSession(sessionId, householdId);

  if (!session) {
    throw Errors.notFound('Session');
  }

  if (session.status !== 'review') {
    throw Errors.validation('Can only update type in review status');
  }

  // If we have raw text and are changing type, re-parse
  let newParsedContent = session.parsedContent;

  if (session.rawText && newType !== session.selectedType) {
    newParsedContent = parseFromRawText(newType, session.rawText);
  }

  await db
    .update(imageParseSessions)
    .set({
      selectedType: newType,
      parsedContent: newParsedContent,
      updatedAt: new Date(),
    })
    .where(eq(imageParseSessions.id, sessionId));
}

/**
 * Update the parsed content (user edits)
 */
export async function updateSessionContent(
  sessionId: string,
  householdId: string,
  edits: Partial<ParsedListContent | ParsedRecipeContent | ParsedCalendarContent>
): Promise<void> {
  const session = await getSession(sessionId, householdId);

  if (!session) {
    throw Errors.notFound('Session');
  }

  if (session.status !== 'review') {
    throw Errors.validation('Can only update content in review status');
  }

  // Merge edits into existing parsed content
  const currentContent = session.parsedContent as ParsedContent;
  const selectedType = session.selectedType;

  let updatedContent: ParsedContent;

  switch (selectedType) {
    case 'list':
      updatedContent = {
        type: 'list',
        data: {
          ...(currentContent?.type === 'list' ? currentContent.data : {}),
          ...(edits as Partial<ParsedListContent>),
          items: (edits as Partial<ParsedListContent>).items?.map((item) => ({
            ...item,
            confidence: 1, // User-edited items have full confidence
          })) || (currentContent?.type === 'list' ? currentContent.data.items : []),
        } as ParsedListContent,
      };
      break;

    case 'recipe':
      updatedContent = {
        type: 'recipe',
        data: {
          ...(currentContent?.type === 'recipe' ? currentContent.data : {}),
          ...(edits as Partial<ParsedRecipeContent>),
          ingredients: (edits as Partial<ParsedRecipeContent>).ingredients?.map((ing) => ({
            ...ing,
            confidence: 1,
          })) || (currentContent?.type === 'recipe' ? currentContent.data.ingredients : []),
        } as ParsedRecipeContent,
      };
      break;

    case 'calendar_event':
      updatedContent = {
        type: 'calendar_event',
        data: {
          events: (edits as Partial<ParsedCalendarContent>).events?.map((evt) => ({
            ...evt,
            confidence: 1,
          })) || (currentContent?.type === 'calendar_event' ? currentContent.data.events : []),
        } as ParsedCalendarContent,
      };
      break;

    default:
      throw Errors.validation('Cannot update content of unknown type');
  }

  await db
    .update(imageParseSessions)
    .set({
      parsedContent: updatedContent,
      userEdits: {
        modifiedFields: Object.keys(edits),
        editedContent: updatedContent,
      },
      updatedAt: new Date(),
    })
    .where(eq(imageParseSessions.id, sessionId));
}

/**
 * Confirm session and create entities
 */
export async function confirmSession(
  sessionId: string,
  householdId: string,
  userId: string,
  options: {
    listId?: string;
    listName?: string;
    listType?: 'checklist' | 'reminder' | 'notes';
    recipeOverrides?: {
      title?: string;
      description?: string;
      prepTimeMinutes?: number | null;
      cookTimeMinutes?: number | null;
      servings?: number | null;
    };
    calendarId?: string;
  }
): Promise<{ type: string; createdIds: string[] }> {
  const session = await getSession(sessionId, householdId);

  if (!session) {
    throw Errors.notFound('Session');
  }

  if (session.status !== 'review') {
    throw Errors.validation('Can only confirm session in review status');
  }

  const parsedContent = session.parsedContent as ParsedContent;
  const selectedType = session.selectedType;

  if (!parsedContent || !selectedType) {
    throw Errors.validation('No content to confirm');
  }

  const createdIds: string[] = [];

  try {
    switch (selectedType) {
      case 'list':
        const listIds = await createListFromContent(
          parsedContent.data as ParsedListContent,
          householdId,
          userId,
          options
        );
        createdIds.push(...listIds);
        break;

      case 'recipe':
        const recipeId = await createRecipeFromContent(
          parsedContent.data as ParsedRecipeContent,
          householdId,
          userId,
          options.recipeOverrides
        );
        createdIds.push(recipeId);
        break;

      case 'calendar_event':
        const eventIds = await createEventsFromContent(
          parsedContent.data as ParsedCalendarContent,
          householdId,
          userId,
          options.calendarId
        );
        createdIds.push(...eventIds);
        break;

      default:
        throw Errors.validation(`Cannot create entities from type: ${selectedType}`);
    }

    // Mark session as confirmed
    await db
      .update(imageParseSessions)
      .set({
        status: 'confirmed',
        updatedAt: new Date(),
      })
      .where(eq(imageParseSessions.id, sessionId));

    return { type: selectedType, createdIds };
  } catch (error) {
    logger.error({ sessionId, error }, 'Failed to create entities from parsed content');
    throw error;
  }
}

/**
 * Cancel a session
 */
export async function cancelSession(sessionId: string, householdId: string): Promise<void> {
  await db
    .update(imageParseSessions)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(
      and(eq(imageParseSessions.id, sessionId), eq(imageParseSessions.householdId, householdId))
    );
}

/**
 * Get AI provider status for health endpoint
 */
export async function getAIStatus(): Promise<{
  available: boolean;
  name: string;
  model?: string;
  expectedProcessingMs?: number;
}> {
  return getVisionProviderStatus();
}

// Helper functions

function normalizeParsedContent(type: ParsedContentType, data: unknown): ParsedContent {
  switch (type) {
    case 'list':
      return { type: 'list', data: normalizeListContent(data) };
    case 'recipe':
      return { type: 'recipe', data: normalizeRecipeContent(data) };
    case 'calendar_event':
      return { type: 'calendar_event', data: normalizeCalendarContent(data) };
    default:
      return { type: 'unknown', data: { rawText: String(data) } };
  }
}

function parseFromRawText(type: ParsedContentType, rawText: string): ParsedContent {
  switch (type) {
    case 'list':
      return { type: 'list', data: parseListFromText(rawText) };
    case 'recipe':
      return { type: 'recipe', data: parseRecipeFromText(rawText) };
    case 'calendar_event':
      return { type: 'calendar_event', data: parseCalendarFromText(rawText) };
    default:
      return { type: 'unknown', data: { rawText } };
  }
}

async function createListFromContent(
  content: ParsedListContent,
  householdId: string,
  userId: string,
  options: { listId?: string; listName?: string; listType?: 'checklist' | 'reminder' | 'notes' }
): Promise<string[]> {
  let listId = options.listId;

  // Create new list if needed
  if (!listId) {
    const [newList] = await db
      .insert(lists)
      .values({
        householdId,
        name: options.listName || content.title || 'Imported List',
        type: options.listType || content.suggestedListType || 'checklist',
        createdBy: userId,
      })
      .returning();

    listId = newList.id;
  }

  // Add items to list
  const itemIds: string[] = [];
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    const [newItem] = await db
      .insert(listItems)
      .values({
        listId,
        content: item.content,
        isChecked: item.isChecked || false,
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        sortOrder: i,
        createdBy: userId,
      })
      .returning();

    itemIds.push(newItem.id);
  }

  return [listId, ...itemIds];
}

async function createRecipeFromContent(
  content: ParsedRecipeContent,
  householdId: string,
  userId: string,
  overrides?: {
    title?: string;
    description?: string;
    prepTimeMinutes?: number | null;
    cookTimeMinutes?: number | null;
    servings?: number | null;
  }
): Promise<string> {
  const [recipe] = await db
    .insert(recipes)
    .values({
      householdId,
      createdBy: userId,
      title: overrides?.title || content.title,
      description: overrides?.description || content.description,
      instructions: content.instructions.map((text, i) => ({
        step: i + 1,
        text,
      })),
      prepTimeMinutes: overrides?.prepTimeMinutes ?? content.prepTimeMinutes,
      cookTimeMinutes: overrides?.cookTimeMinutes ?? content.cookTimeMinutes,
      servings: overrides?.servings ?? content.servings,
    })
    .returning();

  // Add ingredients
  if (content.ingredients.length > 0) {
    await db.insert(recipeIngredients).values(
      content.ingredients.map((ing) => ({
        recipeId: recipe.id,
        name: ing.name,
        quantity: ing.quantity?.toString(),
        unit: ing.unit,
        notes: ing.notes,
      }))
    );
  }

  return recipe.id;
}

async function createEventsFromContent(
  content: ParsedCalendarContent,
  householdId: string,
  userId: string,
  calendarId?: string
): Promise<string[]> {
  // Get or find default calendar
  let targetCalendarId = calendarId;

  if (!targetCalendarId) {
    // Find default calendar for household
    const defaultCalendar = await db.query.calendars.findFirst({
      where: and(eq(calendars.householdId, householdId), eq(calendars.isDefault, true)),
    });

    if (!defaultCalendar) {
      throw Errors.validation('No default calendar found. Please specify a calendar ID.');
    }

    targetCalendarId = defaultCalendar.id;
  }

  const eventIds: string[] = [];

  for (const evt of content.events) {
    if (!evt.startTime) continue;

    const startTime = new Date(evt.startTime);
    let endTime: Date;

    if (evt.endTime) {
      endTime = new Date(evt.endTime);
    } else if (evt.allDay) {
      // All-day events end at the start of the next day
      endTime = new Date(startTime);
      endTime.setDate(endTime.getDate() + 1);
    } else {
      // Default to 1 hour duration
      endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);
    }

    const [newEvent] = await db
      .insert(calendarEvents)
      .values({
        calendarId: targetCalendarId,
        createdById: userId,
        title: evt.title,
        description: evt.description,
        location: evt.location,
        startTime,
        endTime,
        allDay: evt.allDay || false,
      })
      .returning();

    eventIds.push(newEvent.id);
  }

  return eventIds;
}
