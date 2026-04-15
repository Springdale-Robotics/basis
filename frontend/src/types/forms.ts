import { z } from 'zod';

// Auth forms
export const loginFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginFormData = z.infer<typeof loginFormSchema>;

export const registerFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  confirmPassword: z.string(),
  displayName: z.string().min(1, 'Display name is required').max(255),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});
export type RegisterFormData = z.infer<typeof registerFormSchema>;

export const forgotPasswordFormSchema = z.object({
  email: z.string().email('Invalid email address'),
});
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordFormSchema>;

export const resetPasswordFormSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});
export type ResetPasswordFormData = z.infer<typeof resetPasswordFormSchema>;

// Setup forms
export const setupHouseholdFormSchema = z.object({
  name: z.string().min(1, 'Household name is required').max(255),
  timezone: z.string().min(1, 'Timezone is required'),
});
export type SetupHouseholdFormData = z.infer<typeof setupHouseholdFormSchema>;

export const setupAdminFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  confirmPassword: z.string(),
  displayName: z.string().min(1, 'Display name is required').max(255),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});
export type SetupAdminFormData = z.infer<typeof setupAdminFormSchema>;

// Calendar forms
export const eventFormSchema = z.object({
  calendarId: z.string().min(1, 'Please select a calendar'),
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  location: z.string().optional(),
  startTime: z.string(),
  endTime: z.string(),
  allDay: z.boolean(),
  recurrence: z.string().optional(),
});
export const eventSchema = eventFormSchema;
export type EventFormData = z.infer<typeof eventFormSchema>;

// Recipe forms
export const recipeFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  servings: z.number().min(1, 'Servings must be at least 1'),
  prepTime: z.number().min(0).optional(),
  cookTime: z.number().min(0).optional(),
  prepTimeMinutes: z.number().min(0).optional(),
  cookTimeMinutes: z.number().min(0).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  ingredients: z.array(z.object({
    name: z.string(),
    amount: z.preprocess(
      (val) => (val === undefined || val === '' || (typeof val === 'number' && Number.isNaN(val)) ? 0 : Number(val)),
      z.number().min(0)
    ),
    unit: z.string(),
    notes: z.string().optional(),
    optional: z.boolean().optional(),
    inventoryItemId: z.string().optional(),
    rawText: z.string().optional(),
    linkedItemName: z.string().optional(),
  })),
  instructions: z.array(z.object({
    step: z.number(),
    text: z.string(),
  })),
  timers: z.array(z.object({
    name: z.string(),
    durationSeconds: z.number().min(1),
  })).optional(),
  tags: z.array(z.string()),
});
export const recipeSchema = recipeFormSchema;
export type RecipeFormData = z.infer<typeof recipeFormSchema>;

// Inventory forms
export const storageAreaFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  icon: z.string().optional(),
});
export type StorageAreaFormData = z.infer<typeof storageAreaFormSchema>;

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => (val === undefined || val === '' || val === null || (typeof val === 'number' && Number.isNaN(val)) ? undefined : Number(val)),
    schema.optional()
  );

export const inventoryItemFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  category: z.string().optional(),
  barcode: z.string().optional(),
  defaultUnit: z.string().optional(),
  unit: z.string().optional(),
  icon: z.string().optional(),
  keepInStock: z.boolean(),
  keepInStockThreshold: optionalNumber(z.number().min(0)),
  minStockLevel: optionalNumber(z.number().min(0)),
  defaultAreaId: z.string().optional(),
  density: optionalNumber(z.number().positive()),
  defaultShelfLifeDays: optionalNumber(z.number().int().positive()),
  expiryDate: z.string().optional(),
});
export const inventoryItemSchema = inventoryItemFormSchema;
export type InventoryItemFormData = z.infer<typeof inventoryItemFormSchema>;

export const addStockFormSchema = z.object({
  areaId: z.string().uuid('Please select a storage area'),
  quantity: z.number().min(0.01, 'Quantity must be greater than 0'),
  unit: z.string().min(1, 'Unit is required'),
  expiryDate: z.string().optional(),
  notes: z.string().optional(),
});
export type AddStockFormData = z.infer<typeof addStockFormSchema>;

export const leftoverFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  source: z.enum(['recipe', 'restaurant', 'homemade', 'other']),
  sourceRecipeId: z.string().optional(),
  restaurantName: z.string().max(255).optional(),
  areaId: z.string().optional(),
  portions: z.number().min(0.1).default(1),
  quantityNotes: z.string().max(255).optional(),
  preparedAt: z.string().optional(),
  expiryDate: z.string().optional(),
});
export const leftoverSchema = leftoverFormSchema;
export type LeftoverFormData = z.infer<typeof leftoverFormSchema>;

// Task forms
export const taskFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  dueDate: z.string().optional(),
  isChore: z.boolean(),
  assignedTo: z.string().optional(),
  assigneeId: z.string().optional(),
  rewardPoints: z.number().min(0).optional(),
  points: z.number().min(0).optional(),
  recurrence: z.string().optional(),
});
export const taskSchema = taskFormSchema;
export type TaskFormData = z.infer<typeof taskFormSchema>;

// List forms
export const listFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['checklist', 'reminder', 'notes']),
  icon: z.string().optional(),
  color: z.string().optional(),
});
export type ListFormData = z.infer<typeof listFormSchema>;

export const listItemFormSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  dueDate: z.string().optional(),
  reminderAt: z.string().optional(),
});
export type ListItemFormData = z.infer<typeof listItemFormSchema>;
