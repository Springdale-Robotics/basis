import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { lists, listItems } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireMember } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { listTypeSchema, hexColorSchema } from '../../lib/validators.js';

const createListSchema = z.object({
  name: z.string().min(1).max(255),
  type: listTypeSchema.default('checklist'),
  icon: z.string().max(50).optional(),
  color: hexColorSchema.optional(),
});

const createListItemSchema = z.object({
  content: z.string().min(1),
  dueDate: z.coerce.date().optional(),
  sortOrder: z.number().int().default(0),
});

export async function listsRoutes(app: FastifyInstance): Promise<void> {
  // List all lists
  app.get(
    '/',
    { preHandler: [authMiddleware] },
    async (request) => {
      const listList = await db.query.lists.findMany({
        where: eq(lists.householdId, request.user!.householdId),
        orderBy: (l, { asc }) => [asc(l.name)],
      });

      return { success: true, data: { lists: listList } };
    }
  );

  // Create list
  app.post(
    '/',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createListSchema.parse(request.body);

      const [list] = await db
        .insert(lists)
        .values({
          householdId: request.user!.householdId,
          name: input.name,
          type: input.type,
          icon: input.icon,
          color: input.color,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { list } };
    }
  );

  // Get list with items
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware] },
    async (request) => {
      const list = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId)
        ),
      });

      if (!list) throw Errors.notFound('List');

      const items = await db.query.listItems.findMany({
        where: eq(listItems.listId, list.id),
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
      });

      return { success: true, data: { list, items } };
    }
  );

  // Update list
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      const input = createListSchema.partial().parse(request.body);

      const [updated] = await db
        .update(lists)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(lists.id, request.params.id),
            eq(lists.householdId, request.user!.householdId)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('List');

      return { success: true, data: { list: updated } };
    }
  );

  // Delete list
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireMember()] },
    async (request) => {
      await db
        .delete(lists)
        .where(
          and(
            eq(lists.id, request.params.id),
            eq(lists.householdId, request.user!.householdId)
          )
        );

      return { success: true, data: { message: 'List deleted' } };
    }
  );

  // Add item to list
  app.post<{ Params: { id: string } }>(
    '/:id/items',
    { preHandler: [authMiddleware] },
    async (request) => {
      const input = createListItemSchema.parse(request.body);

      // Verify list exists
      const list = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId)
        ),
      });

      if (!list) throw Errors.notFound('List');

      const [item] = await db
        .insert(listItems)
        .values({
          listId: request.params.id,
          content: input.content,
          dueDate: input.dueDate,
          sortOrder: input.sortOrder,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { item } };
    }
  );

  // Update list item
  app.patch<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId',
    { preHandler: [authMiddleware] },
    async (request) => {
      const input = createListItemSchema.partial().parse(request.body);

      const [updated] = await db
        .update(listItems)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(listItems.id, request.params.itemId),
            eq(listItems.listId, request.params.id)
          )
        )
        .returning();

      if (!updated) throw Errors.notFound('List item');

      return { success: true, data: { item: updated } };
    }
  );

  // Delete list item
  app.delete<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(listItems)
        .where(
          and(
            eq(listItems.id, request.params.itemId),
            eq(listItems.listId, request.params.id)
          )
        );

      return { success: true, data: { message: 'Item deleted' } };
    }
  );

  // Toggle item checked status
  app.post<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId/toggle',
    { preHandler: [authMiddleware] },
    async (request) => {
      const item = await db.query.listItems.findFirst({
        where: eq(listItems.id, request.params.itemId),
      });

      if (!item) throw Errors.notFound('List item');

      const [updated] = await db
        .update(listItems)
        .set({
          isChecked: !item.isChecked,
          checkedAt: !item.isChecked ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(listItems.id, request.params.itemId))
        .returning();

      return { success: true, data: { item: updated } };
    }
  );

  // Reorder items
  app.post<{ Params: { id: string } }>(
    '/:id/items/reorder',
    { preHandler: [authMiddleware] },
    async (request) => {
      const { order } = z
        .object({
          order: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
        })
        .parse(request.body);

      for (const item of order) {
        await db
          .update(listItems)
          .set({ sortOrder: item.sortOrder })
          .where(eq(listItems.id, item.id));
      }

      return { success: true, data: { message: 'Items reordered' } };
    }
  );

  // Clear all checked items
  app.delete<{ Params: { id: string } }>(
    '/:id/items/checked',
    { preHandler: [authMiddleware] },
    async (request) => {
      await db
        .delete(listItems)
        .where(
          and(
            eq(listItems.listId, request.params.id),
            eq(listItems.isChecked, true)
          )
        );

      return { success: true, data: { message: 'Checked items cleared' } };
    }
  );
}
