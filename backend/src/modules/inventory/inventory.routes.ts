import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { inventoryAreas, inventoryItems, inventoryStock, shoppingList, leftovers, recipeIngredients, recipes } from '../../db/schema/index.js';
import { eq, and, lt, lte, sql, isNotNull, isNull } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { requireInventoryAccess, requireShoppingListAccess } from '../../middleware/permission.middleware.js';
import { Errors } from '../../lib/errors.js';
import { randomBytes } from 'crypto';
import { shoppingListSourceSchema } from '../../lib/validators.js';
import { convertWithDensity, normalizeUnit, getUnitCategory, isNegligible, type QuantityUnitSizes } from '../../lib/unit-conversions.js';
import { inArray } from 'drizzle-orm';
import {
  getItemConfidence,
  getInventoryConfidenceMap,
  depleteTranches,
  reconcileItem,
  markOutOfStock,
} from '../../services/inventory-confidence.service.js';

/**
 * Calculate total stock quantity for an item, converting all stock entries to the target unit.
 * Uses density for weight↔volume and quantityUnitSizes for custom count units.
 */
function calculateTotalStockWithConversions(
  stockEntries: Array<{ quantity: string; unit: string | null }>,
  targetUnit: string,
  density: number | null,
  quantityUnitSizes: QuantityUnitSizes = {}
): { total: number; allConverted: boolean; unconvertedUnits: string[] } {
  let total = 0;
  let allConverted = true;
  const unconvertedUnits: string[] = [];

  for (const entry of stockEntries) {
    const qty = parseFloat(entry.quantity);
    const entryUnit = entry.unit || targetUnit;

    if (normalizeUnit(entryUnit) === normalizeUnit(targetUnit)) {
      total += qty;
    } else {
      const converted = convertWithDensity(qty, entryUnit, targetUnit, density, quantityUnitSizes);
      if (converted !== null) {
        total += converted;
      } else {
        allConverted = false;
        if (!unconvertedUnits.includes(entryUnit)) {
          unconvertedUnits.push(entryUnit);
        }
      }
    }
  }

  return { total, allConverted, unconvertedUnits };
}

/**
 * Validate that adding/replacing `key → target.unit` in a sizes map doesn't
 * create a cycle. We walk the chain from the proposed target unit; if it
 * comes back around to `key`, the entry would loop. Stops at depth 8 to
 * tolerate pre-existing cycles (which can be cleaned up but shouldn't make
 * a fresh save fail).
 */
function sizesEntryWouldCycle(
  sizes: QuantityUnitSizes,
  key: string,
  target: { quantity: number; unit: string }
): boolean {
  const normKey = normalizeUnit(key);
  let cur = normalizeUnit(target.unit);
  const seen = new Set<string>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (cur === normKey) return true;
    if (seen.has(cur)) return false; // pre-existing cycle elsewhere, not our concern
    seen.add(cur);
    const next = sizes[cur];
    if (!next) return false;
    cur = normalizeUnit(next.unit);
  }
  return false;
}

/**
 * Walk every household item that has stock + linked recipe ingredients, and
 * flip `needs_conversion` to reflect whether any (stock unit, ingredient unit)
 * pair is unbridgeable given the item's density and quantity-unit weights.
 *
 * Runs as a read-side effect on GET /items so the badge stays accurate even
 * when the user hasn't triggered a shopping-list pass yet. Cheap in practice:
 * three batched queries per household and an in-memory loop.
 */
async function reconcileNeedsConversionForHousehold(householdId: string): Promise<void> {
  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.householdId, householdId));
  if (items.length === 0) return;
  const itemIds = items.map((i) => i.id);

  const stockRows = await db
    .select({ itemId: inventoryStock.itemId, unit: inventoryStock.unit })
    .from(inventoryStock)
    .where(inArray(inventoryStock.itemId, itemIds));

  const ingredientRows = await db
    .select({
      inventoryItemId: recipeIngredients.inventoryItemId,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.inventoryItemId, itemIds));

  // Group units by item, dedup, drop nulls/negligibles.
  const stockUnits = new Map<string, Set<string>>();
  for (const s of stockRows) {
    if (!s.itemId || !s.unit) continue;
    if (isNegligible(s.unit)) continue;
    if (!stockUnits.has(s.itemId)) stockUnits.set(s.itemId, new Set());
    stockUnits.get(s.itemId)!.add(s.unit);
  }
  const ingredientUnits = new Map<string, Set<string>>();
  for (const ing of ingredientRows) {
    if (!ing.inventoryItemId || !ing.unit) continue;
    if (isNegligible(ing.unit)) continue;
    if (!ingredientUnits.has(ing.inventoryItemId)) ingredientUnits.set(ing.inventoryItemId, new Set());
    ingredientUnits.get(ing.inventoryItemId)!.add(ing.unit);
  }

  const toRaise: string[] = [];
  const toClear: string[] = [];

  for (const item of items) {
    const stocks = stockUnits.get(item.id);
    const ings = ingredientUnits.get(item.id);
    // Targets to compare stock against: recipe ingredient units (when the
    // item is used in recipes) PLUS the item's defaultUnit (so unlinked
    // items still flag gaps between their stock and the unit the user
    // chose to display them in).
    const targets = new Set<string>();
    if (ings) for (const u of ings) targets.add(u);
    if (item.defaultUnit && !isNegligible(item.defaultUnit)) targets.add(item.defaultUnit);

    if (!stocks || stocks.size === 0 || targets.size === 0) {
      // Nothing to compare — clear the flag if it was raised by a stale gap.
      if (item.needsConversion) toClear.push(item.id);
      continue;
    }
    const density = item.density ? Number(item.density) : null;
    const sizes = (item.quantityUnitSizes ?? undefined) as QuantityUnitSizes | undefined;
    let hasGap = false;
    outer: for (const su of stocks) {
      for (const iu of targets) {
        if (normalizeUnit(su) === normalizeUnit(iu)) continue;
        const factor = convertWithDensity(1, su, iu, density, sizes);
        if (factor === null) {
          hasGap = true;
          break outer;
        }
      }
    }
    if (hasGap && !item.needsConversion) toRaise.push(item.id);
    if (!hasGap && item.needsConversion) toClear.push(item.id);
  }

  if (toRaise.length > 0) {
    await db
      .update(inventoryItems)
      .set({ needsConversion: true, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryItems.householdId, householdId),
          inArray(inventoryItems.id, toRaise)
        )
      );
  }
  if (toClear.length > 0) {
    await db
      .update(inventoryItems)
      .set({ needsConversion: false, updatedAt: new Date() })
      .where(
        and(
          eq(inventoryItems.householdId, householdId),
          inArray(inventoryItems.id, toClear)
        )
      );
  }
}

const createAreaSchema = z.object({
  name: z.string().min(1).max(255),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().int().default(0),
});

const createItemSchema = z.object({
  name: z.string().min(1).max(255),
  barcode: z.string().max(255).optional(),
  defaultUnit: z.string().max(50).optional(),
  defaultShelfLifeDays: z.number().int().positive().optional(),
  category: z.string().max(100).optional(),
  keepInStock: z.boolean().default(false),
  minStockQuantity: z.number().positive().optional(),
  defaultAreaId: z.string().uuid().optional(),
  density: z.number().positive().optional(),
  quantityUnitSizes: z
    .record(
      z.string(),
      z.object({ quantity: z.number().positive(), unit: z.string().min(1).max(50) })
    )
    .optional(),
});

const addStockSchema = z.object({
  itemId: z.string().uuid(),
  areaId: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.string().max(50).optional(),
  expiryDate: z.coerce.date().optional(),
});

const addToShoppingListSchema = z.object({
  itemId: z.string().uuid().optional(),
  customName: z.string().max(255).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(50).optional(),
  targetAreaId: z.string().uuid().optional(),
});

const updateShoppingListItemSchema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  customName: z.string().max(255).nullable().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(50).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  targetAreaId: z.string().uuid().nullable().optional(),
});

const quickCreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  defaultUnit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  defaultAreaId: z.string().uuid().optional(),
});

const batchCreateItemsSchema = z.object({
  items: z.array(z.object({
    name: z.string().min(1).max(255),
    defaultUnit: z.string().max(50).optional(),
    category: z.string().max(100).optional(),
    defaultAreaId: z.string().uuid().optional(),
  })).min(1).max(50),
});

const batchDeleteItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(50),
  deleteType: z.enum(['stock_only', 'catalog']).default('catalog'),
});

const batchUpdateItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(50),
  updates: z.object({
    category: z.string().max(100).optional(),
    keepInStock: z.boolean().optional(),
    minStockQuantity: z.number().positive().optional(),
    defaultAreaId: z.string().uuid().nullable().optional(),
  }),
});

const createLeftoverSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  source: z.enum(['recipe', 'restaurant', 'homemade', 'other']).default('homemade'),
  sourceRecipeId: z.string().uuid().optional(),
  restaurantName: z.string().max(255).optional(),
  areaId: z.string().uuid().optional(),
  portions: z.number().positive().default(1),
  quantityNotes: z.string().max(255).optional(),
  preparedAt: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
});

const updateLeftoverSchema = createLeftoverSchema.partial();

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  // ===== AREAS =====

  app.get(
    '/areas',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const areas = await db.query.inventoryAreas.findMany({
        where: eq(inventoryAreas.householdId, request.user!.householdId),
        orderBy: (a, { asc }) => [asc(a.sortOrder)],
      });

      return { success: true, data: { areas } };
    }
  );

  app.post(
    '/areas',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = createAreaSchema.parse(request.body);

      const [area] = await db
        .insert(inventoryAreas)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          icon: input.icon,
          sortOrder: input.sortOrder,
        })
        .returning();

      return { success: true, data: { area } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/areas/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = createAreaSchema.partial().parse(request.body);

      const [updated] = await db
        .update(inventoryAreas)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(inventoryAreas.id, request.params.id),
            eq(inventoryAreas.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Area');

      return { success: true, data: { area: updated } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/areas/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      await db
        .delete(inventoryAreas)
        .where(
          and(
            eq(inventoryAreas.id, request.params.id),
            eq(inventoryAreas.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Area deleted' } };
    }
  );

  app.post(
    '/areas/reorder',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const { order } = z
        .object({
          order: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
        })
        .parse(request.body);

      for (const item of order) {
        await db
          .update(inventoryAreas)
          .set({ sortOrder: item.sortOrder })
          .where(eq(inventoryAreas.id, item.id));
      }

      return { success: true, data: { message: 'Areas reordered' } };
    }
  );

  // ===== ITEMS =====

  app.get<{ Querystring: { search?: string; category?: string; areaId?: string } }>(
    '/items',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const { search, category, areaId } = request.query;

      // Recompute needs_conversion flags so the badge reflects current state of
      // stock vs. linked recipe units. Wrapped in try/catch so a scan hiccup
      // never breaks the inventory list — it's an opportunistic side effect.
      try {
        await reconcileNeedsConversionForHousehold(request.user!.householdId);
      } catch (err) {
        request.log.warn({ err }, 'needs_conversion reconcile failed');
      }

      // Build where conditions
      const conditions = [eq(inventoryItems.householdId, request.user!.householdId)];

      if (search) {
        conditions.push(sql`${inventoryItems.name} ILIKE ${'%' + search + '%'}`);
      }

      if (category) {
        conditions.push(eq(inventoryItems.category, category));
      }

      if (areaId) {
        conditions.push(eq(inventoryItems.defaultAreaId, areaId));
      }

      const items = await db.query.inventoryItems.findMany({
        where: and(...conditions),
        orderBy: (i, { asc }) => [asc(i.name)],
      });

      return { success: true, data: { items } };
    }
  );

  app.post(
    '/items',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = createItemSchema.parse(request.body);

      // Generate internal ID if no barcode
      const internalId = input.barcode ? null : `HM-${randomBytes(3).toString('hex').toUpperCase()}`;

      const [item] = await db
        .insert(inventoryItems)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          barcode: input.barcode,
          internalId,
          defaultUnit: input.defaultUnit,
          defaultShelfLifeDays: input.defaultShelfLifeDays,
          category: input.category,
          keepInStock: input.keepInStock,
          minStockQuantity: input.minStockQuantity?.toString(),
          defaultAreaId: input.defaultAreaId,
          density: input.density?.toString(),
          quantityUnitSizes: input.quantityUnitSizes || {},
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/items/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const item = await db.query.inventoryItems.findFirst({
        where: and(
          eq(inventoryItems.id, request.params.id),
          eq(inventoryItems.householdId, request.user!.householdId)
        ),
      });

      if (!item) throw Errors.notFound('Item');

      return { success: true, data: { item } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/items/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = createItemSchema.partial().parse(request.body);

      // Build update data, handling minStockQuantity separately
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.barcode !== undefined) updateData.barcode = input.barcode;
      if (input.defaultUnit !== undefined) updateData.defaultUnit = input.defaultUnit;
      if (input.defaultShelfLifeDays !== undefined) updateData.defaultShelfLifeDays = input.defaultShelfLifeDays;
      if (input.category !== undefined) updateData.category = input.category;
      if (input.keepInStock !== undefined) updateData.keepInStock = input.keepInStock;
      if (input.minStockQuantity !== undefined) updateData.minStockQuantity = input.minStockQuantity.toString();
      if (input.defaultAreaId !== undefined) updateData.defaultAreaId = input.defaultAreaId;
      if (input.density !== undefined) updateData.density = input.density.toString();
      if (input.quantityUnitSizes !== undefined) {
        // Reject saves that would put the sizes map into a cycle (e.g.
        // bottle → case while case → bottle).
        for (const [key, entry] of Object.entries(input.quantityUnitSizes)) {
          if (sizesEntryWouldCycle(input.quantityUnitSizes, key, entry)) {
            throw Errors.validation(
              `Conversion would create a cycle: ${key} → ${entry.unit}.`
            );
          }
        }
        updateData.quantityUnitSizes = input.quantityUnitSizes;
      }
      // Adding a density OR a container size can both resolve the unit
      // mismatch that raises needs_conversion. Either way, give the scan a fresh
      // chance to clear (or re-raise) the flag on the next GET /items.
      if (
        (input.density !== undefined && input.density != null) ||
        input.quantityUnitSizes !== undefined
      ) {
        updateData.needsConversion = false;
      }

      const [updated] = await db
        .update(inventoryItems)
        .set(updateData)
        .where(
          and(
            eq(inventoryItems.id, request.params.id),
            eq(inventoryItems.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Item');

      return { success: true, data: { item: updated } };
    }
  );

  // Save a container size for a count unit on an item
  // (e.g., 1 bottle = 16 fl oz, 1 bag = 5 lb).
  app.patch<{ Params: { id: string } }>(
    '/items/:id/quantity-weight',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = z.object({
        unit: z.string().min(1).max(50),
        // Accept the new (quantity, unit) shape; for backwards-compat, also
        // accept the legacy `grams` number which is treated as { quantity, unit: 'g' }.
        quantity: z.number().positive().optional(),
        sizeUnit: z.string().min(1).max(50).optional(),
        grams: z.number().positive().optional(),
      }).parse(request.body);

      const sizeEntry =
        input.quantity !== undefined && input.sizeUnit
          ? { quantity: input.quantity, unit: input.sizeUnit }
          : input.grams !== undefined
          ? { quantity: input.grams, unit: 'g' }
          : null;
      if (!sizeEntry) {
        throw Errors.validation('Provide either {quantity, sizeUnit} or {grams}.');
      }

      const item = await db.query.inventoryItems.findFirst({
        where: and(
          eq(inventoryItems.id, request.params.id),
          eq(inventoryItems.householdId, request.user!.householdId)
        ),
      });

      if (!item) throw Errors.notFound('Item');

      const currentSizes = (item.quantityUnitSizes as QuantityUnitSizes) || {};
      const newKey = input.unit.toLowerCase();
      const updatedSizes: QuantityUnitSizes = {
        ...currentSizes,
        [newKey]: sizeEntry,
      };
      if (sizesEntryWouldCycle(updatedSizes, newKey, sizeEntry)) {
        throw Errors.validation(
          `Conversion would create a cycle: ${newKey} → ${sizeEntry.unit}.`
        );
      }

      const [updated] = await db
        .update(inventoryItems)
        .set({
          quantityUnitSizes: updatedSizes,
          needsConversion: false,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, request.params.id))
        .returning();

      return { success: true, data: { item: updated } };
    }
  );

  // Get recipes linked to an inventory item
  app.get<{ Params: { id: string } }>(
    '/items/:id/linked-recipes',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const linkedRecipes = await db
        .select({
          recipeId: recipeIngredients.recipeId,
          recipeName: recipes.title,
          ingredientName: recipeIngredients.name,
        })
        .from(recipeIngredients)
        .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
        .where(eq(recipeIngredients.inventoryItemId, request.params.id));

      return { success: true, data: { linkedRecipes } };
    }
  );

  // Relink: swap all recipe ingredient references from one item to another
  app.post<{ Params: { id: string } }>(
    '/items/:id/relink',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const schema = z.object({
        newItemId: z.string().uuid(),
      });
      const { newItemId } = schema.parse(request.body);

      // Update all recipe ingredients pointing to old item
      const result = await db
        .update(recipeIngredients)
        .set({ inventoryItemId: newItemId })
        .where(eq(recipeIngredients.inventoryItemId, request.params.id));

      return { success: true, data: { message: 'Relinked', updatedCount: result.rowCount } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/items/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      // Check for recipe links before deleting
      const linkedRecipes = await db
        .select({ id: recipeIngredients.id })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.inventoryItemId, request.params.id))
        .limit(1);

      if (linkedRecipes.length > 0) {
        return {
          success: false,
          error: {
            code: 'ITEM_LINKED',
            message: 'This item is linked to recipe ingredients. Relink them before deleting.',
          },
        };
      }

      await db
        .delete(inventoryItems)
        .where(
          and(
            eq(inventoryItems.id, request.params.id),
            eq(inventoryItems.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Item deleted' } };
    }
  );

  // Quick create item - minimal fields, returns ID for immediate use
  app.post(
    '/items/quick-create',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = quickCreateItemSchema.parse(request.body);

      // Generate internal ID
      const internalId = `HM-${randomBytes(3).toString('hex').toUpperCase()}`;

      const [item] = await db
        .insert(inventoryItems)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          internalId,
          defaultUnit: input.defaultUnit,
          category: input.category,
          defaultAreaId: input.defaultAreaId,
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  // Batch create items - for import flows
  app.post(
    '/items/batch',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = batchCreateItemsSchema.parse(request.body);

      const createdItems = [];

      for (const itemData of input.items) {
        const internalId = `HM-${randomBytes(3).toString('hex').toUpperCase()}`;

        const [item] = await db
          .insert(inventoryItems)
          .values({
            householdId: request.user!.householdId,
            name: itemData.name,
            internalId,
            defaultUnit: itemData.defaultUnit,
            category: itemData.category,
            defaultAreaId: itemData.defaultAreaId,
          })
          .returning();

        createdItems.push(item);
      }

      return { success: true, data: { items: createdItems } };
    }
  );

  // Batch delete items - delete multiple items at once
  app.post(
    '/items/batch-delete',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = batchDeleteItemsSchema.parse(request.body);

      if (input.deleteType === 'stock_only') {
        // Only delete stock entries, keep items in catalog
        for (const itemId of input.itemIds) {
          // Verify item belongs to household
          const item = await db.query.inventoryItems.findFirst({
            where: and(
              eq(inventoryItems.id, itemId),
              eq(inventoryItems.householdId, request.user!.householdId)
            ),
          });
          if (item) {
            await db.delete(inventoryStock).where(eq(inventoryStock.itemId, itemId));
          }
        }
      } else {
        // Delete items from catalog (stock cascades)
        for (const itemId of input.itemIds) {
          await db
            .delete(inventoryItems)
            .where(
              and(
                eq(inventoryItems.id, itemId),
                eq(inventoryItems.householdId, request.user!.householdId)
              )
            );
        }
      }

      return { success: true, data: { message: `${input.itemIds.length} items processed` } };
    }
  );

  // Batch update items - update multiple items at once
  app.post(
    '/items/batch-update',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = batchUpdateItemsSchema.parse(request.body);

      const updatedItems = [];
      for (const itemId of input.itemIds) {
        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (input.updates.category !== undefined) {
          updateData.category = input.updates.category;
        }
        if (input.updates.keepInStock !== undefined) {
          updateData.keepInStock = input.updates.keepInStock;
        }
        if (input.updates.minStockQuantity !== undefined) {
          updateData.minStockQuantity = input.updates.minStockQuantity.toString();
        }
        if (input.updates.defaultAreaId !== undefined) {
          updateData.defaultAreaId = input.updates.defaultAreaId;
        }

        const [updated] = await db
          .update(inventoryItems)
          .set(updateData)
          .where(
            and(
              eq(inventoryItems.id, itemId),
              eq(inventoryItems.householdId, request.user!.householdId)
            )
          )
          .returning();

        if (updated) {
          updatedItems.push(updated);
        }
      }

      return { success: true, data: { items: updatedItems } };
    }
  );

  // ===== STOCK =====

  app.get(
    '/stock',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      // Get all stock with item and area info
      const stock = await db.query.inventoryStock.findMany({
        with: {
          item: true,
          area: true,
        },
      });

      return { success: true, data: { stock } };
    }
  );

  app.post(
    '/stock',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = addStockSchema.parse(request.body);

      const [stock] = await db
        .insert(inventoryStock)
        .values({
          itemId: input.itemId,
          areaId: input.areaId,
          quantity: input.quantity.toString(),
          unit: input.unit,
          expiryDate: input.expiryDate?.toISOString().split('T')[0],
        })
        .returning();

      return { success: true, data: { stock } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/stock/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = addStockSchema.partial().parse(request.body);

      const [updated] = await db
        .update(inventoryStock)
        .set({
          ...input,
          quantity: input.quantity?.toString(),
          expiryDate: input.expiryDate?.toISOString().split('T')[0],
          updatedAt: new Date(),
        })
        .where(eq(inventoryStock.id, request.params.id))
        .returning();

      if (!updated) throw Errors.notFound('Stock entry');

      return { success: true, data: { stock: updated } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/stock/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      await db.delete(inventoryStock).where(eq(inventoryStock.id, request.params.id));

      return { success: true, data: { message: 'Stock entry deleted' } };
    }
  );

  // Get expiring items
  app.get(
    '/expiring',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const { days = '7' } = request.query as any;
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + parseInt(days));

      const expiring = await db.query.inventoryStock.findMany({
        where: and(
          isNotNull(inventoryStock.expiryDate),
          lt(inventoryStock.expiryDate, futureDate.toISOString().split('T')[0])
        ),
        with: {
          item: {
            columns: { id: true, name: true, icon: true, householdId: true },
          },
          area: {
            columns: { id: true, name: true, icon: true },
          },
        },
        orderBy: (s, { asc }) => [asc(s.expiryDate)],
      });

      // Filter by household (item has householdId)
      const filteredExpiring = expiring.filter(
        (stock) => stock.item?.householdId === request.user!.householdId
      );

      return { success: true, data: { expiring: filteredExpiring } };
    }
  );

  // Get low stock items
  app.get(
    '/low-stock',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      // Get items marked as keep-in-stock with current quantities
      const items = await db.query.inventoryItems.findMany({
        where: and(
          eq(inventoryItems.householdId, request.user!.householdId),
          eq(inventoryItems.keepInStock, true)
        ),
      });

      const lowStock = [];
      for (const item of items) {
        const stock = await db.query.inventoryStock.findMany({
          where: eq(inventoryStock.itemId, item.id),
        });

        const targetUnit = item.defaultUnit || 'pieces';
        const density = item.density ? parseFloat(item.density) : null;
        const quantityUnitSizes = (item.quantityUnitSizes as QuantityUnitSizes) || {};

        const { total: totalQuantity } = calculateTotalStockWithConversions(
          stock.map((s) => ({ quantity: s.quantity, unit: s.unit })),
          targetUnit,
          density,
          quantityUnitSizes
        );

        const minQuantity = item.minStockQuantity
          ? parseFloat(item.minStockQuantity)
          : 1;

        if (totalQuantity < minQuantity) {
          lowStock.push({
            item,
            currentQuantity: totalQuantity,
            minQuantity,
            unit: targetUnit,
            status: totalQuantity === 0 ? 'out' : 'low',
          });
        }
      }

      return { success: true, data: { lowStock } };
    }
  );

  // Keep in stock view
  app.get(
    '/keep-in-stock',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const items = await db.query.inventoryItems.findMany({
        where: and(
          eq(inventoryItems.householdId, request.user!.householdId),
          eq(inventoryItems.keepInStock, true)
        ),
      });

      const result = [];
      for (const item of items) {
        const stock = await db.query.inventoryStock.findMany({
          where: eq(inventoryStock.itemId, item.id),
        });

        const targetUnit = item.defaultUnit || 'pieces';
        const density = item.density ? parseFloat(item.density) : null;
        const quantityUnitSizes = (item.quantityUnitSizes as QuantityUnitSizes) || {};

        const { total: totalQuantity } = calculateTotalStockWithConversions(
          stock.map((s) => ({ quantity: s.quantity, unit: s.unit })),
          targetUnit,
          density,
          quantityUnitSizes
        );

        const minQuantity = item.minStockQuantity
          ? parseFloat(item.minStockQuantity)
          : 1;

        // Check if on shopping list
        const onList = await db.query.shoppingList.findFirst({
          where: and(
            eq(shoppingList.itemId, item.id),
            eq(shoppingList.isChecked, false)
          ),
        });

        result.push({
          item,
          currentQuantity: totalQuantity,
          minQuantity,
          unit: targetUnit,
          status: totalQuantity === 0 ? 'out' : totalQuantity < minQuantity ? 'low' : 'ok',
          onShoppingList: !!onList,
        });
      }

      return { success: true, data: { items: result } };
    }
  );

  // ===== SHOPPING LIST =====

  app.get(
    '/shopping-list',
    { preHandler: [authMiddleware, requireShoppingListAccess('view')] },
    async (request) => {
      const list = await db.query.shoppingList.findMany({
        where: eq(shoppingList.householdId, request.user!.householdId),
        orderBy: (l, { asc }) => [asc(l.isChecked), asc(l.createdAt)],
        with: {
          item: {
            columns: { id: true, name: true, category: true, defaultUnit: true, defaultAreaId: true },
          },
        },
      });

      // Transform to include item name from linked inventory item
      const transformedList = list.map((entry) => ({
        ...entry,
        // Use customName if set, otherwise use linked inventory item name
        customName: entry.customName || entry.item?.name || null,
        // Use category from linked item if not set on shopping list entry
        category: entry.category || entry.item?.category || null,
      }));

      return { success: true, data: { shoppingList: transformedList } };
    }
  );

  app.post(
    '/shopping-list',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit')] },
    async (request) => {
      const input = addToShoppingListSchema.parse(request.body);

      if (!input.itemId && !input.customName) {
        throw Errors.validation('Either itemId or customName is required');
      }

      const [item] = await db
        .insert(shoppingList)
        .values({
          householdId: request.user!.householdId,
          itemId: input.itemId,
          customName: input.customName,
          quantity: input.quantity?.toString(),
          unit: input.unit,
          addedBy: request.user!.id,
          targetAreaId: input.targetAreaId,
          sources: ['manual'],
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/shopping-list/:id',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit')] },
    async (request) => {
      const input = updateShoppingListItemSchema.parse(request.body);

      const current = await db.query.shoppingList.findFirst({
        where: and(
          eq(shoppingList.id, request.params.id),
          eq(shoppingList.householdId, request.user!.householdId)
        ),
      });

      if (!current) {
        throw Errors.notFound('Shopping list item');
      }

      if (input.itemId) {
        const inv = await db.query.inventoryItems.findFirst({
          where: and(
            eq(inventoryItems.id, input.itemId),
            eq(inventoryItems.householdId, request.user!.householdId)
          ),
        });
        if (!inv) {
          throw Errors.notFound('Inventory item');
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.itemId !== undefined) updates.itemId = input.itemId;
      if (input.customName !== undefined) updates.customName = input.customName;
      if (input.quantity !== undefined) updates.quantity = input.quantity.toString();
      if (input.unit !== undefined) updates.unit = input.unit;
      if (input.category !== undefined) updates.category = input.category;
      if (input.targetAreaId !== undefined) updates.targetAreaId = input.targetAreaId;

      const [updated] = await db
        .update(shoppingList)
        .set(updates)
        .where(eq(shoppingList.id, request.params.id))
        .returning();

      return { success: true, data: { item: updated } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/shopping-list/:id/check',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit')] },
    async (request) => {
      const { acquiredQuantity, acquiredUnit, keepRemainder } = z
        .object({
          acquiredQuantity: z.number().min(0).optional(),
          acquiredUnit: z.string().max(50).optional(),
          keepRemainder: z.boolean().optional(),
        })
        .parse(request.body || {});

      // First get the current state
      const current = await db.query.shoppingList.findFirst({
        where: and(
          eq(shoppingList.id, request.params.id),
          eq(shoppingList.householdId, request.user!.householdId)
        ),
      });

      if (!current) {
        throw Errors.notFound('Shopping list item');
      }

      // If unchecking, just toggle
      if (current.isChecked) {
        const [updated] = await db
          .update(shoppingList)
          .set({ isChecked: false, updatedAt: new Date() })
          .where(eq(shoppingList.id, request.params.id))
          .returning();
        return { success: true, data: { item: updated, remainderItem: null, conversion: null } };
      }

      // If checking with partial quantity
      const originalQuantity = Number(current.quantity) || 0;
      const requestedUnit = current.unit ?? null;
      const acquired = acquiredQuantity !== undefined ? acquiredQuantity : originalQuantity;
      const newUnit = acquiredUnit?.trim() || requestedUnit;
      const unitChanged =
        !!acquiredUnit &&
        !!requestedUnit &&
        normalizeUnit(acquiredUnit) !== normalizeUnit(requestedUnit);

      // Look up the linked inventory item (if any) so we can check whether the
      // acquired unit can be converted back to the requested one.
      const inventoryItem = current.itemId
        ? await db.query.inventoryItems.findFirst({
            where: eq(inventoryItems.id, current.itemId),
          })
        : null;

      // Compute conversion when the unit changed.
      let conversion: {
        canConvert: boolean;
        factor: number | null;
        sameDimension: boolean;
        missingDensity: boolean;
        requestedUnit: string | null;
        acquiredUnit: string | null;
      } | null = null;

      if (unitChanged && requestedUnit && acquiredUnit) {
        const fromCat = getUnitCategory(acquiredUnit);
        const toCat = getUnitCategory(requestedUnit);
        const sameDimension = fromCat === toCat && fromCat !== 'other';
        const density = inventoryItem?.density ? Number(inventoryItem.density) : null;
        const factor = convertWithDensity(
          1,
          acquiredUnit,
          requestedUnit,
          density,
          (inventoryItem?.quantityUnitSizes ?? undefined) as QuantityUnitSizes | undefined
        );
        const canConvert = factor !== null;
        const missingDensity = !sameDimension && !canConvert && !density;
        conversion = {
          canConvert,
          factor,
          sameDimension,
          missingDensity,
          requestedUnit,
          acquiredUnit,
        };

        // Flag the inventory item if we can't auto-convert and density is missing.
        if (inventoryItem && missingDensity && !inventoryItem.needsConversion) {
          await db
            .update(inventoryItems)
            .set({ needsConversion: true, updatedAt: new Date() })
            .where(eq(inventoryItems.id, inventoryItem.id));
        }
      }

      // "Did we get enough?" is judged in the requested unit. If a conversion
      // was possible, normalize the acquired amount before comparing.
      const acquiredInRequested =
        unitChanged && conversion?.canConvert && conversion.factor !== null
          ? acquired * conversion.factor
          : acquired;
      let remainderItem = null;

      // If we got less than needed and want to keep remainder
      if (keepRemainder && acquiredInRequested < originalQuantity && acquired > 0) {
        const remainingQuantity = originalQuantity - acquiredInRequested;
        // Create new item with remaining quantity in the requested unit
        const [newItem] = await db
          .insert(shoppingList)
          .values({
            householdId: current.householdId,
            itemId: current.itemId,
            customName: current.customName,
            quantity: remainingQuantity.toString(),
            unit: requestedUnit,
            isChecked: false,
            addedBy: request.user!.id,
            source: current.source,
            sources: current.sources,
            targetAreaId: current.targetAreaId,
          })
          .returning();
        remainderItem = newItem;
      }

      // Update the original item: store the acquired qty/unit verbatim so
      // put-away inserts inventory in the unit the user actually bought.
      const [updated] = await db
        .update(shoppingList)
        .set({
          isChecked: true,
          quantity: acquired.toString(),
          unit: newUnit,
          updatedAt: new Date(),
        })
        .where(eq(shoppingList.id, request.params.id))
        .returning();

      return { success: true, data: { item: updated, remainderItem, conversion } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/shopping-list/:id/to-inventory',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit'), requireInventoryAccess('edit')] },
    async (request) => {
      const { areaId, quantity, expiryDate, splits } = z
        .object({
          areaId: z.string().uuid().optional(),
          quantity: z.number().positive().optional(),
          expiryDate: z.coerce.date().optional(),
          splits: z.array(z.object({
            areaId: z.string().uuid(),
            quantity: z.number().positive(),
            expiryDate: z.coerce.date().optional(),
          })).optional(),
        })
        .parse(request.body);

      const item = await db.query.shoppingList.findFirst({
        where: eq(shoppingList.id, request.params.id),
      });

      if (!item || !item.itemId) {
        throw Errors.notFound('Shopping list item');
      }

      // Add to inventory
      if (splits && splits.length > 0) {
        for (const split of splits) {
          await db.insert(inventoryStock).values({
            itemId: item.itemId,
            areaId: split.areaId,
            quantity: split.quantity.toString(),
            unit: item.unit,
            expiryDate: split.expiryDate?.toISOString().split('T')[0],
          });
        }
      } else if (areaId) {
        await db.insert(inventoryStock).values({
          itemId: item.itemId,
          areaId,
          quantity: (quantity || parseFloat(item.quantity || '1')).toString(),
          unit: item.unit,
          expiryDate: expiryDate?.toISOString().split('T')[0],
        });
      }

      // Remove from shopping list
      await db
        .delete(shoppingList)
        .where(eq(shoppingList.id, request.params.id));

      return { success: true, data: { message: 'Moved to inventory' } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/shopping-list/:id',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit')] },
    async (request) => {
      await db
        .delete(shoppingList)
        .where(
          and(
            eq(shoppingList.id, request.params.id),
            eq(shoppingList.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Item removed' } };
    }
  );

  app.delete(
    '/shopping-list/checked',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit')] },
    async (request) => {
      await db
        .delete(shoppingList)
        .where(
          and(
            eq(shoppingList.householdId, request.user!.householdId),
            eq(shoppingList.isChecked, true)
          )
        );

      return { success: true, data: { message: 'Checked items cleared' } };
    }
  );

  // Batch put away - move all checked items to inventory
  app.post(
    '/shopping-list/put-away',
    { preHandler: [authMiddleware, requireShoppingListAccess('edit'), requireInventoryAccess('edit')] },
    async (request) => {
      const { defaultAreaId } = z
        .object({
          defaultAreaId: z.string().uuid().optional(),
        })
        .parse(request.body);

      // Get all checked items with itemId (can be added to inventory)
      const checkedItems = await db.query.shoppingList.findMany({
        where: and(
          eq(shoppingList.householdId, request.user!.householdId),
          eq(shoppingList.isChecked, true)
        ),
      });

      let movedCount = 0;
      let skippedCount = 0;

      for (const item of checkedItems) {
        // Skip custom items without itemId - they can't be added to inventory
        if (!item.itemId) {
          skippedCount++;
          continue;
        }

        // Get the inventory item to find defaultAreaId if needed
        const inventoryItem = await db.query.inventoryItems.findFirst({
          where: eq(inventoryItems.id, item.itemId),
        });

        // Determine area: targetAreaId > item's defaultAreaId > provided defaultAreaId
        const areaId = item.targetAreaId || inventoryItem?.defaultAreaId || defaultAreaId;

        if (!areaId) {
          skippedCount++;
          continue;
        }

        // Add to inventory stock
        await db.insert(inventoryStock).values({
          itemId: item.itemId,
          areaId,
          quantity: item.quantity || '1',
          unit: item.unit,
        });

        // Delete the shopping list item
        await db.delete(shoppingList).where(eq(shoppingList.id, item.id));

        movedCount++;
      }

      return {
        success: true,
        data: {
          message: `Moved ${movedCount} items to inventory`,
          movedCount,
          skippedCount,
        },
      };
    }
  );

  // ===== LEFTOVERS =====

  // Get all active leftovers (not finished)
  app.get(
    '/leftovers',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const leftoversList = await db.query.leftovers.findMany({
        where: and(
          eq(leftovers.householdId, request.user!.householdId),
          isNull(leftovers.finishedAt)
        ),
        with: {
          area: true,
          sourceRecipe: {
            columns: { id: true, title: true },
          },
        },
        orderBy: (l, { asc }) => [asc(l.expiryDate)],
      });

      return { success: true, data: { leftovers: leftoversList } };
    }
  );

  // Get leftovers expiring soon
  app.get(
    '/leftovers/expiring',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const { days = '3' } = request.query as { days?: string };
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + parseInt(days));

      const expiringLeftovers = await db.query.leftovers.findMany({
        where: and(
          eq(leftovers.householdId, request.user!.householdId),
          isNull(leftovers.finishedAt),
          lte(leftovers.expiryDate, futureDate.toISOString().split('T')[0])
        ),
        with: {
          area: true,
          sourceRecipe: {
            columns: { id: true, title: true },
          },
        },
        orderBy: (l, { asc }) => [asc(l.expiryDate)],
      });

      return { success: true, data: { leftovers: expiringLeftovers } };
    }
  );

  // Get single leftover
  app.get<{ Params: { id: string } }>(
    '/leftovers/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('view')] },
    async (request) => {
      const leftover = await db.query.leftovers.findFirst({
        where: and(
          eq(leftovers.id, request.params.id),
          eq(leftovers.householdId, request.user!.householdId)
        ),
        with: {
          area: true,
          sourceRecipe: {
            columns: { id: true, title: true },
          },
        },
      });

      if (!leftover) throw Errors.notFound('Leftover');

      return { success: true, data: { leftover } };
    }
  );

  // Create leftover
  app.post(
    '/leftovers',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = createLeftoverSchema.parse(request.body);

      const [leftover] = await db
        .insert(leftovers)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          description: input.description,
          source: input.source,
          sourceRecipeId: input.sourceRecipeId,
          restaurantName: input.restaurantName,
          areaId: input.areaId,
          portions: input.portions.toString(),
          quantityNotes: input.quantityNotes,
          preparedAt: input.preparedAt || new Date(),
          expiryDate: input.expiryDate ? input.expiryDate.toISOString().split('T')[0] : null,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { leftover } };
    }
  );

  // Update leftover
  app.patch<{ Params: { id: string } }>(
    '/leftovers/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const input = updateLeftoverSchema.parse(request.body);

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.source !== undefined) updateData.source = input.source;
      if (input.sourceRecipeId !== undefined) updateData.sourceRecipeId = input.sourceRecipeId;
      if (input.restaurantName !== undefined) updateData.restaurantName = input.restaurantName;
      if (input.areaId !== undefined) updateData.areaId = input.areaId;
      if (input.portions !== undefined) updateData.portions = input.portions.toString();
      if (input.quantityNotes !== undefined) updateData.quantityNotes = input.quantityNotes;
      if (input.preparedAt !== undefined) updateData.preparedAt = input.preparedAt;
      if (input.expiryDate !== undefined) updateData.expiryDate = input.expiryDate.toISOString().split('T')[0];

      const [updated] = await db
        .update(leftovers)
        .set(updateData)
        .where(
          and(
            eq(leftovers.id, request.params.id),
            eq(leftovers.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Leftover');

      return { success: true, data: { leftover: updated } };
    }
  );

  // Delete leftover
  app.delete<{ Params: { id: string } }>(
    '/leftovers/:id',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      await db
        .delete(leftovers)
        .where(
          and(
            eq(leftovers.id, request.params.id),
            eq(leftovers.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'Leftover deleted' } };
    }
  );

  // Mark leftover as finished/consumed
  app.post<{ Params: { id: string } }>(
    '/leftovers/:id/finish',
    { preHandler: [authMiddleware, requireInventoryAccess('edit')] },
    async (request) => {
      const [updated] = await db
        .update(leftovers)
        .set({ finishedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(leftovers.id, request.params.id),
            eq(leftovers.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('Leftover');

      return { success: true, data: { leftover: updated } };
    }
  );

  // ===== CONFIDENCE & DEPLETION ENDPOINTS =====

  // Get confidence map for all items in the household
  app.get(
    '/confidence',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const map = await getInventoryConfidenceMap(request.user!.householdId);
      // Convert Map to plain object for JSON
      const confidence: Record<string, { itemId: string; confidence: number; band: string; totalQuantity: number; unit: string }> = {};
      for (const [key, value] of map) {
        confidence[key] = value;
      }
      return { success: true, data: { confidence } };
    }
  );

  // Get confidence for a single item
  app.get<{ Params: { id: string } }>(
    '/items/:id/confidence',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const result = await getItemConfidence(request.params.id);
      if (!result) throw Errors.notFound('Item');
      return { success: true, data: result };
    }
  );

  // Ad-hoc deplete an item (not tied to a cooking session)
  app.post<{ Params: { id: string } }>(
    '/items/:id/deplete',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        quantity: z.number().positive(),
        unit: z.string().min(1),
      });
      const { quantity, unit } = schema.parse(request.body);
      const plan = await depleteTranches(request.params.id, quantity, unit);
      return { success: true, data: plan };
    }
  );

  // Reconcile an item ("I checked, I have X amount")
  app.post<{ Params: { id: string } }>(
    '/items/:id/reconcile',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        quantity: z.number().nonnegative(),
        unit: z.string().min(1),
        areaId: z.string().uuid(),
      });
      const { quantity, unit, areaId } = schema.parse(request.body);
      await reconcileItem(request.params.id, quantity, unit, areaId, request.user!.id);
      return { success: true, data: { message: 'Item reconciled' } };
    }
  );

  // Mark item as out of stock (mid-cook discovery)
  app.post<{ Params: { id: string } }>(
    '/items/:id/out-of-stock',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const schema = z.object({
        addToShoppingList: z.boolean().default(false),
        quantity: z.number().positive().optional(),
        unit: z.string().optional(),
      });
      const body = schema.parse(request.body || {});

      await markOutOfStock(request.params.id);

      // Optionally add to shopping list
      if (body.addToShoppingList) {
        const item = await db.query.inventoryItems.findFirst({
          where: eq(inventoryItems.id, request.params.id),
        });
        if (item) {
          await db.insert(shoppingList).values({
            householdId: request.user!.householdId,
            itemId: item.id,
            quantity: body.quantity?.toString() ?? null,
            unit: body.unit ?? item.defaultUnit ?? null,
            addedBy: request.user!.id,
            source: 'low_stock',
            sources: ['low_stock'],
          });
        }
      }

      return { success: true, data: { message: 'Item marked out of stock' } };
    }
  );
}
