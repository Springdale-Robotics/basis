import { randomUUID } from 'crypto';
import { eq, and, lt } from 'drizzle-orm';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
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
  type ExtractionMode,
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

/** Directory for temporary image uploads during parsing */
const UPLOAD_DIR = join(config.STORAGE_PATH, 'image-parse');

/** Ensure the upload directory exists */
async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

/** Get the file path for a session image */
export function getSessionImagePath(sessionId: string, mimeType: string): string {
  const ext = mimeType.includes('png') ? '.png'
    : mimeType.includes('gif') ? '.gif'
    : mimeType.includes('webp') ? '.webp'
    : mimeType.includes('heic') ? '.heic'
    : mimeType.includes('heif') ? '.heif'
    : '.jpg';
  return join(UPLOAD_DIR, `${sessionId}${ext}`);
}

/**
 * Create a new image parse session
 */
export async function createSession(
  householdId: string,
  userId: string,
  targetType?: ParsedContentType,
  extractionMode: ExtractionMode = 'accurate'
): Promise<string> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + config.IMAGE_PARSE_SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(imageParseSessions).values({
    id: sessionId,
    householdId,
    userId,
    status: 'uploading',
    selectedType: targetType,
    extractionMode,
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
  targetType?: ParsedContentType,
  extractionMode: ExtractionMode = 'accurate'
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

  // Save image to disk instead of storing base64 in the database
  await ensureUploadDir();
  const imagePath = getSessionImagePath(sessionId, mimeType);
  await writeFile(imagePath, imageBuffer);

  logger.info({ sessionId, imagePath, sizeBytes: imageBuffer.length }, 'Image saved to disk');

  await db
    .update(imageParseSessions)
    .set({
      originalImagePath: imagePath,
      imageMimeType: mimeType,
      selectedType: targetType,
      extractionMode,
      status: 'processing',
      updatedAt: new Date(),
    })
    .where(
      and(eq(imageParseSessions.id, sessionId), eq(imageParseSessions.householdId, householdId))
    );

  logger.info({ sessionId, extractionMode }, 'Database updated, queuing job');

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

    // Read image from disk
    const imageBuffer = await readFile(session.originalImagePath);
    const targetType = session.selectedType as ParsedContentType | null;
    const extractionMode = session.extractionMode || 'accurate';

    logger.info({
      sessionId,
      targetType,
      extractionMode,
      model: provider.getModel(),
    }, 'Starting combined VLM+LLM image parsing');

    // ==========================================================================
    // Use combined /extract/base64 endpoint for full pipeline with:
    // - Image preprocessing (deskew, contrast, resize)
    // - Multi-pass VLM extraction
    // - Verification and self-correction
    // - LLM structuring
    // ==========================================================================
    await updateProcessingStage(sessionId, 'vlm_started');

    let rawText: string;
    let detectedType: ParsedContentType;
    let confidence: number;
    let parsedContent: ParsedContent;

    try {
      // Use parseImage which calls the combined endpoint
      const result = await provider.parseImage(imageBuffer, session.imageMimeType || 'image/jpeg', '');

      rawText = result.rawText;

      logger.info({
        sessionId,
        rawTextLength: rawText.length,
        hasStructured: !!result.structured,
        processingTimeMs: result.processingTimeMs,
      }, 'Combined VLM+LLM parsing completed');

      await updateProcessingStage(sessionId, 'llm_done');

      // Use structured result if available
      if (result.structured) {
        detectedType = result.structured.type as ParsedContentType;
        confidence = result.structured.confidence;
        parsedContent = normalizeParsedContent(detectedType, result.structured.data);

        logger.info({
          sessionId,
          detectedType,
          confidence,
        }, 'Using structured output from combined endpoint');
      } else {
        // Fall back to heuristic parsing
        const detected = detectContentType(rawText);
        detectedType = detected.type;
        confidence = detected.confidence;
        parsedContent = parseFromRawText(detectedType, rawText);
        warnings.push('No structured data from AI, using heuristic parsing');

        logger.info({
          sessionId,
          detectedType,
          confidence,
        }, 'Falling back to heuristic parsing');
      }
    } catch (parseError) {
      logger.error({ sessionId, error: parseError }, 'Combined parsing failed');
      throw parseError;
    }

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

    // Mark session as confirmed and clean up image file
    await db
      .update(imageParseSessions)
      .set({
        status: 'confirmed',
        originalImagePath: null,
        updatedAt: new Date(),
      })
      .where(eq(imageParseSessions.id, sessionId));

    if (session.originalImagePath) {
      try {
        await unlink(session.originalImagePath);
      } catch {
        // File may already be deleted
      }
    }

    return { type: selectedType, createdIds };
  } catch (error) {
    logger.error({ sessionId, error }, 'Failed to create entities from parsed content');
    throw error;
  }
}

/**
 * Cancel a session and clean up the image file
 */
export async function cancelSession(sessionId: string, householdId: string): Promise<void> {
  const session = await getSession(sessionId, householdId);

  await db
    .update(imageParseSessions)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(
      and(eq(imageParseSessions.id, sessionId), eq(imageParseSessions.householdId, householdId))
    );

  // Clean up the image file
  if (session?.originalImagePath) {
    try {
      await unlink(session.originalImagePath);
    } catch {
      // File may already be deleted
    }
  }
}

/**
 * Clean up expired sessions and their image files
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const expired = await db.query.imageParseSessions.findMany({
    where: lt(imageParseSessions.expiresAt, new Date()),
  });

  for (const session of expired) {
    if (session.originalImagePath) {
      try {
        await unlink(session.originalImagePath);
      } catch {
        // File may already be deleted
      }
    }
  }

  if (expired.length > 0) {
    await db
      .delete(imageParseSessions)
      .where(lt(imageParseSessions.expiresAt, new Date()));

    logger.info({ count: expired.length }, 'Cleaned up expired image parse sessions');
  }

  return expired.length;
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

/**
 * Validate that LLM returned the expected structure for a content type.
 * Returns false if the LLM returned an array instead of an object,
 * or if required fields are missing.
 */
function isValidLlmStructure(data: unknown, expectedType: ParsedContentType): boolean {
  // Must be an object, not an array
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check for required fields based on type
  switch (expectedType) {
    case 'recipe':
      // Recipe must have ingredients array
      return 'ingredients' in obj && Array.isArray(obj.ingredients);

    case 'list':
      // List must have items array
      return 'items' in obj && Array.isArray(obj.items);

    case 'calendar_event':
      // Calendar must have events array
      return 'events' in obj && Array.isArray(obj.events);

    default:
      return true;
  }
}

/**
 * Hybrid parsing: Use heuristic parser for structure but salvage ingredients from LLM array.
 * This handles cases where the LLM returns just the ingredients as an array instead of
 * a full recipe object.
 */
function parseFromRawTextWithLlmIngredients(
  rawText: string,
  llmIngredients: unknown[]
): ParsedContent {
  // Start with heuristic parsing for title, instructions, etc.
  const heuristicResult = parseRecipeFromText(rawText);

  // Try to extract valid ingredients from the LLM array
  const validIngredients: typeof heuristicResult.ingredients = [];

  for (const item of llmIngredients) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const ing = item as Record<string, unknown>;
      const name = (ing.name as string) || (ing.ingredient as string);

      if (name && typeof name === 'string') {
        validIngredients.push({
          name: name.trim(),
          quantity: typeof ing.quantity === 'number' ? ing.quantity : undefined,
          unit: typeof ing.unit === 'string' ? ing.unit : undefined,
          notes: typeof ing.notes === 'string' ? ing.notes : undefined,
          confidence: typeof ing.confidence === 'number' ? ing.confidence : 0.8,
        });
      }
    }
  }

  // Use LLM ingredients if they look better than heuristic ones
  // (more items, or items with quantities)
  const llmHasQuantities = validIngredients.some(i => i.quantity !== undefined);
  const heuristicHasQuantities = heuristicResult.ingredients.some(i => i.quantity !== undefined);

  if (
    validIngredients.length > 0 &&
    (validIngredients.length >= heuristicResult.ingredients.length || llmHasQuantities && !heuristicHasQuantities)
  ) {
    logger.info({
      llmCount: validIngredients.length,
      heuristicCount: heuristicResult.ingredients.length,
      usingLlm: true,
    }, 'Using LLM ingredients over heuristic');
    heuristicResult.ingredients = validIngredients;
  }

  return { type: 'recipe', data: heuristicResult };
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
