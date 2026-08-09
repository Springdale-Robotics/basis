import { z } from 'zod';

export const updateScanSchema = z.object({
  merchant: z.string().trim().min(1).max(120).optional(),
  purchasedAt: z.string().datetime().nullable().optional(),
  defaultAreaId: z.string().uuid().nullable().optional(),
});

export const updateLineSchema = z.object({
  resolution: z.enum(['unresolved', 'link', 'ignore']).optional(),
  itemId: z.string().uuid().nullable().optional(),
  unitsPerCount: z.number().positive().nullable().optional(),
  targetAreaId: z.string().uuid().nullable().optional(),
  count: z.number().positive().optional(),
  price: z.number().nonnegative().nullable().optional(),
  rawText: z.string().trim().min(1).max(500).optional(),
});

export const createItemForLineSchema = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().max(100).optional(),
  defaultUnit: z.string().max(50).optional(),
  defaultAreaId: z.string().uuid().optional(),
  unitsPerCount: z.number().positive(),
});

export const listScansQuerySchema = z.object({
  status: z.enum(['processing', 'review', 'confirmed', 'cancelled', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const updateLinkSchema = z.object({
  itemId: z.string().uuid().optional(),
  unitsPerCount: z.number().positive().optional(),
});

export const listLinksQuerySchema = z.object({
  merchant: z.string().trim().max(120).optional(),
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
