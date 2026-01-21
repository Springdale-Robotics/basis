import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { inventoryAreas, inventoryItems, inventoryStock, shoppingList } from '../../db/schema/index.js';
import { eq, and, lt, sql, isNotNull } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { randomBytes } from 'crypto';
import { shoppingListSourceSchema } from '../../lib/validators.js';

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

const quickCreateItemSchema = z.object({
  name: z.string().min(1).max(255),
  defaultUnit: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
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

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  // ===== AREAS =====

  app.get(
    '/areas',
    { preHandler: [authMiddleware] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
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

  app.get(
    '/items',
    { preHandler: [authMiddleware] },
    async (request) => {
      const items = await db.query.inventoryItems.findMany({
        where: eq(inventoryItems.householdId, request.user!.householdId),
        orderBy: (i, { asc }) => [asc(i.name)],
      });

      return { success: true, data: { items } };
    }
  );

  app.post(
    '/items',
    { preHandler: [authMiddleware, requireMember()] },
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
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/items/:id',
    { preHandler: [authMiddleware] },
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
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createItemSchema.partial().parse(request.body);

      const [updated] = await db
        .update(inventoryItems)
        .set({ ...input, updatedAt: new Date() })
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

  app.delete<{ Params: { id: string } }>(
    '/items/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
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
    { preHandler: [authMiddleware, requireMember()] },
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
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  // Batch create items - for import flows
  app.post(
    '/items/batch',
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db.delete(inventoryStock).where(eq(inventoryStock.id, request.params.id));

      return { success: true, data: { message: 'Stock entry deleted' } };
    }
  );

  // Get expiring items
  app.get(
    '/expiring',
    { preHandler: [authMiddleware] },
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
    { preHandler: [authMiddleware] },
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

        const totalQuantity = stock.reduce(
          (sum, s) => sum + parseFloat(s.quantity),
          0
        );

        const minQuantity = item.minStockQuantity
          ? parseFloat(item.minStockQuantity)
          : 1;

        if (totalQuantity < minQuantity) {
          lowStock.push({
            item,
            currentQuantity: totalQuantity,
            minQuantity,
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
    { preHandler: [authMiddleware] },
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

        const totalQuantity = stock.reduce(
          (sum, s) => sum + parseFloat(s.quantity),
          0
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
          unit: item.defaultUnit,
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
    { preHandler: [authMiddleware] },
    async (request) => {
      const list = await db.query.shoppingList.findMany({
        where: eq(shoppingList.householdId, request.user!.householdId),
        orderBy: (l, { asc }) => [asc(l.isChecked), asc(l.createdAt)],
        with: {
          item: {
            columns: { id: true, name: true, category: true, defaultUnit: true },
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
    { preHandler: [authMiddleware] },
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
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/shopping-list/:id/check',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { acquiredQuantity, keepRemainder } = z
        .object({
          acquiredQuantity: z.number().min(0).optional(),
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
        return { success: true, data: { item: updated, remainderItem: null } };
      }

      // If checking with partial quantity
      const originalQuantity = Number(current.quantity) || 0;
      const acquired = acquiredQuantity !== undefined ? acquiredQuantity : originalQuantity;
      let remainderItem = null;

      // If we got less than needed and want to keep remainder
      if (keepRemainder && acquired < originalQuantity && acquired > 0) {
        const remainingQuantity = originalQuantity - acquired;
        // Create new item with remaining quantity
        const [newItem] = await db
          .insert(shoppingList)
          .values({
            householdId: current.householdId,
            itemId: current.itemId,
            customName: current.customName,
            quantity: remainingQuantity.toString(),
            unit: current.unit,
            isChecked: false,
            addedBy: request.user!.id,
            source: current.source,
            targetAreaId: current.targetAreaId,
          })
          .returning();
        remainderItem = newItem;
      }

      // Update the original item with acquired quantity and check it off
      const [updated] = await db
        .update(shoppingList)
        .set({
          isChecked: true,
          quantity: acquired.toString(),
          updatedAt: new Date(),
        })
        .where(eq(shoppingList.id, request.params.id))
        .returning();

      return { success: true, data: { item: updated, remainderItem } };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/shopping-list/:id/to-inventory',
    { preHandler: [authMiddleware, requireMember()] },
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
    { preHandler: [authMiddleware] },
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
    { preHandler: [authMiddleware] },
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
    { preHandler: [authMiddleware, requireMember()] },
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
}
