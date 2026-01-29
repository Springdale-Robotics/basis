import { z } from 'zod';

// Parsed content type enum
export const parsedContentTypeSchema = z.enum([
  'list',
  'recipe',
  'calendar_event',
  'mixed',
  'unknown',
]);

// Session status enum
export const imageParseStatusSchema = z.enum([
  'uploading',
  'processing',
  'review',
  'confirmed',
  'cancelled',
  'failed',
]);

// List item schema
export const parsedListItemSchema = z.object({
  content: z.string(),
  isChecked: z.boolean().optional(),
  dueDate: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

// List content schema
export const parsedListContentSchema = z.object({
  title: z.string().optional(),
  items: z.array(parsedListItemSchema),
  suggestedListType: z.enum(['checklist', 'reminder', 'notes']),
});

// Recipe ingredient schema
export const parsedRecipeIngredientSchema = z.object({
  name: z.string(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  notes: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

// Recipe content schema
export const parsedRecipeContentSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  instructions: z.array(z.string()),
  prepTimeMinutes: z.number().int().positive().optional(),
  cookTimeMinutes: z.number().int().positive().optional(),
  servings: z.number().int().positive().optional(),
  imageUrl: z.string().optional(),
  ingredients: z.array(parsedRecipeIngredientSchema),
});

// Calendar event schema
export const parsedCalendarEventSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  allDay: z.boolean().optional(),
  recurrenceHint: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

// Calendar content schema
export const parsedCalendarContentSchema = z.object({
  events: z.array(parsedCalendarEventSchema),
});

// API request schemas
export const uploadImageBodySchema = z.object({
  targetType: parsedContentTypeSchema.optional(),
});

export const updateTypeBodySchema = z.object({
  type: parsedContentTypeSchema,
});

export const updateListContentSchema = z.object({
  title: z.string().optional(),
  items: z.array(z.object({
    content: z.string(),
    isChecked: z.boolean().optional(),
    dueDate: z.string().optional(),
  })),
  listType: z.enum(['checklist', 'reminder', 'notes']).optional(),
});

export const updateRecipeContentSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  instructions: z.array(z.string()).optional(),
  prepTimeMinutes: z.number().int().positive().optional().nullable(),
  cookTimeMinutes: z.number().int().positive().optional().nullable(),
  servings: z.number().int().positive().optional().nullable(),
  ingredients: z.array(z.object({
    name: z.string(),
    quantity: z.number().optional().nullable(),
    unit: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })).optional(),
});

export const updateCalendarContentSchema = z.object({
  events: z.array(z.object({
    title: z.string(),
    description: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    startTime: z.string().optional().nullable(),
    endTime: z.string().optional().nullable(),
    allDay: z.boolean().optional(),
  })),
});

export const confirmSessionBodySchema = z.object({
  // For list confirmation
  listId: z.string().uuid().optional(), // Existing list to add items to
  listName: z.string().optional(), // Name for new list
  listType: z.enum(['checklist', 'reminder', 'notes']).optional(),

  // For recipe confirmation
  recipeOverrides: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    prepTimeMinutes: z.number().int().positive().optional().nullable(),
    cookTimeMinutes: z.number().int().positive().optional().nullable(),
    servings: z.number().int().positive().optional().nullable(),
  }).optional(),

  // For calendar confirmation
  calendarId: z.string().uuid().optional(), // Target calendar for events
});

// Response schemas for documentation
export const sessionResponseSchema = z.object({
  id: z.string().uuid(),
  status: imageParseStatusSchema,
  detectedType: parsedContentTypeSchema.nullable(),
  selectedType: parsedContentTypeSchema.nullable(),
  confidence: z.number().nullable(),
  parsedContent: z.unknown().nullable(),
  parseWarnings: z.array(z.string()),
  createdAt: z.string(),
  expiresAt: z.string(),
});
