import { z } from 'zod';
import validator from 'validator';

// Common validation schemas
export const uuidSchema = z.string().uuid();

export const emailSchema = z
  .string()
  .email()
  .transform((v) => v.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(1, 'Password is required')
  .max(128, 'Password must be at most 128 characters');

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const dateRangeSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const iCalRRuleSchema = z
  .string()
  .refine(
    (val) => {
      // Basic RRULE validation
      if (!val.startsWith('FREQ=')) return false;
      const validFreqs = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
      const freqMatch = val.match(/FREQ=(\w+)/);
      return freqMatch && validFreqs.includes(freqMatch[1]);
    },
    { message: 'Invalid iCal RRULE format' }
  )
  .optional();

// User role enum
export const userRoleSchema = z.enum(['admin', 'member', 'kid', 'visitor']);
export type UserRole = z.infer<typeof userRoleSchema>;

// Device type enum
export const deviceTypeSchema = z.enum(['mobile', 'tablet', 'tv', 'desktop']);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

// Task status enum
export const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

// Meal type enum
export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealType = z.infer<typeof mealTypeSchema>;

// File type enum
export const fileTypeSchema = z.enum(['photo', 'video', 'music', 'document']);
export type FileType = z.infer<typeof fileTypeSchema>;

// Calendar type enum
export const calendarTypeSchema = z.enum(['individual', 'group', 'synced']);
export type CalendarType = z.infer<typeof calendarTypeSchema>;

// Permission level enum
export const permissionLevelSchema = z.enum(['view', 'view_busy', 'edit', 'admin']);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

// Grantee type enum
export const granteeTypeSchema = z.enum(['user', 'role', 'group', 'household', 'external', 'device']);
export type GranteeType = z.infer<typeof granteeTypeSchema>;

// Resource type enum
export const resourceTypeSchema = z.enum([
  'calendar',
  'recipe',
  'task',
  'file',
  'album',
  'list',
  'page',
  'inventory_area',
]);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

// Shopping list source enum
export const shoppingListSourceSchema = z.enum(['manual', 'meal_plan', 'low_stock']);
export type ShoppingListSource = z.infer<typeof shoppingListSourceSchema>;

// List type enum
export const listTypeSchema = z.enum(['checklist', 'reminder', 'notes']);
export type ListType = z.infer<typeof listTypeSchema>;

// Notification type enum
export const notificationTypeSchema = z.enum([
  'low_stock',
  'expiring_soon',
  'task_due',
  'sync_error',
  'backup_complete',
  'connection_request',
  'general',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

// Sync provider enum
export const syncProviderSchema = z.enum(['google', 'outlook']).nullable();
export type SyncProvider = z.infer<typeof syncProviderSchema>;

// Helper functions
export function isValidUrl(url: string): boolean {
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true,
  });
}

export function isValidBarcode(barcode: string): boolean {
  // EAN-13, EAN-8, UPC-A, UPC-E
  return /^(\d{8}|\d{12,13})$/.test(barcode);
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 255);
}

// Zod validation helper
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    throw new Error(`Validation failed: ${JSON.stringify(errors)}`);
  }
  return result.data;
}
