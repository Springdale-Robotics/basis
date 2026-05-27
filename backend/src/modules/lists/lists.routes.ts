import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { lists, listItems, permissions } from '../../db/schema/index.js';
import { eq, and, ilike, isNull, isNotNull, inArray } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireListAccess, requireListsAccess } from '../../middleware/permission.middleware.js';
import { setResourceDefaults } from '../../services/permission.service.js';
import { Errors } from '../../lib/errors.js';
import { createListTypeSchema, hexColorSchema } from '../../lib/validators.js';

const createListSchema = z.object({
  name: z.string().min(1).max(255),
  type: createListTypeSchema.default('checklist'),
  icon: z.string().max(50).optional(),
  color: hexColorSchema.optional(),
  recipientUserId: z.string().uuid().optional().nullable(),
  isTemplate: z.boolean().optional(),
});

const updateListSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  icon: z.string().max(50).nullable().optional(),
  color: hexColorSchema.nullable().optional(),
  recipientUserId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  archivedAt: z.coerce.date().nullable().optional(),
});

const itemFieldsSchema = z.object({
  content: z.string().min(1),
  dueDate: z.coerce.date().nullable().optional(),
  sortOrder: z.number().int().optional(),
  parentItemId: z.string().uuid().nullable().optional(),
  sectionLabel: z.string().max(100).nullable().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  url: z.string().url().nullable().optional().or(z.literal('')),
  price: z.coerce.number().nullable().optional(),
  rewardPoints: z.number().int().min(0).optional(),
});

const createListItemSchema = itemFieldsSchema;
const updateListItemSchema = itemFieldsSchema.partial();

const bulkCreateItemsSchema = z.object({
  items: z.array(itemFieldsSchema.partial().extend({ content: z.string().min(1) })).min(1),
});

/**
 * Strip claim metadata from an item when the requester is the wishlist
 * recipient. Returns a shallow copy so the original row is untouched.
 */
function maybeHideClaim<T extends { claimedByUserId?: string | null; claimedAt?: Date | null }>(
  item: T,
  hide: boolean,
): T {
  if (!hide) return item;
  return { ...item, claimedByUserId: null, claimedAt: null };
}

export async function listsRoutes(app: FastifyInstance): Promise<void> {
  // List all lists (filterable)
  app.get<{
    Querystring: {
      includeArchived?: string;
      includeTemplates?: string;
      onlyTemplates?: string;
      search?: string;
    };
  }>(
    '/',
    { preHandler: [authMiddleware, requireListsAccess('view')] },
    async (request) => {
      const { includeArchived, includeTemplates, onlyTemplates, search } = request.query;
      const includeArch = includeArchived === 'true' || includeArchived === '1';
      const includeTpl = includeTemplates === 'true' || includeTemplates === '1';
      const onlyTpl = onlyTemplates === 'true' || onlyTemplates === '1';

      const conditions = [eq(lists.householdId, request.user!.householdId)];
      if (!includeArch) conditions.push(isNull(lists.archivedAt));
      if (onlyTpl) {
        conditions.push(eq(lists.isTemplate, true));
      } else if (!includeTpl) {
        conditions.push(eq(lists.isTemplate, false));
      }
      if (search) {
        conditions.push(ilike(lists.name, `%${search}%`));
      }

      const listList = await db.query.lists.findMany({
        where: and(...conditions),
        orderBy: (l, { asc, desc }) => [desc(l.isPinned), asc(l.name)],
      });

      return { success: true, data: { lists: listList } };
    },
  );

  // Cross-list item search / smart-list queries
  app.get<{
    Querystring: {
      assigneeUserId?: string;
      dueWithinDays?: string;
      checked?: string;
      search?: string;
      limit?: string;
    };
  }>(
    '/items/search',
    { preHandler: [authMiddleware, requireListsAccess('view')] },
    async (request) => {
      const { assigneeUserId, dueWithinDays, checked, search, limit } = request.query;
      const householdId = request.user!.householdId;

      // Resolve which lists this household has (we filter by listId IN).
      const householdLists = await db.query.lists.findMany({
        where: and(eq(lists.householdId, householdId), isNull(lists.archivedAt)),
        columns: { id: true, name: true, type: true, recipientUserId: true },
      });
      const listIds = householdLists.map((l) => l.id);
      if (listIds.length === 0) {
        return { success: true, data: { items: [], lists: [] } };
      }

      const conditions = [inArray(listItems.listId, listIds)];
      if (assigneeUserId) conditions.push(eq(listItems.assigneeUserId, assigneeUserId));
      if (checked === 'true') conditions.push(eq(listItems.isChecked, true));
      else if (checked === 'false') conditions.push(eq(listItems.isChecked, false));
      if (search) conditions.push(ilike(listItems.content, `%${search}%`));
      if (dueWithinDays) {
        const days = Math.max(0, parseInt(dueWithinDays, 10) || 0);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + days);
        conditions.push(isNotNull(listItems.dueDate));
        // We post-filter in JS because Drizzle's date comparison helpers are
        // awkward across timezones — this query is bounded by the listId set.
      }

      const max = Math.min(500, parseInt(limit ?? '200', 10) || 200);
      let items = await db.query.listItems.findMany({
        where: and(...conditions),
        orderBy: (i, { asc }) => [asc(i.dueDate), asc(i.sortOrder)],
        limit: max,
      });

      if (dueWithinDays) {
        const days = Math.max(0, parseInt(dueWithinDays, 10) || 0);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + days);
        items = items.filter((i) => i.dueDate && i.dueDate <= cutoff);
      }

      // Hide claim info for any wishlist item whose parent list has the
      // requester as recipient.
      const recipientListIds = new Set(
        householdLists
          .filter((l) => l.type === 'wishlist' && l.recipientUserId === request.user!.id)
          .map((l) => l.id),
      );
      const cleaned = items.map((i) =>
        maybeHideClaim(i, recipientListIds.has(i.listId)),
      );

      return { success: true, data: { items: cleaned, lists: householdLists } };
    },
  );

  // Create list
  app.post(
    '/',
    { preHandler: [authMiddleware, requireListsAccess('edit')] },
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
          recipientUserId: input.recipientUserId ?? null,
          isTemplate: input.isTemplate ?? false,
          createdBy: request.user!.id,
        })
        .returning();

      await setResourceDefaults('list', list.id, request.user!.id, request.user!.householdId);

      return { success: true, data: { list } };
    },
  );

  // Duplicate a list as a fresh list (used by "Use template" and "Duplicate")
  app.post<{ Params: { id: string }; Body: { name?: string; resetChecks?: boolean; asTemplate?: boolean } }>(
    '/:id/duplicate',
    { preHandler: [authMiddleware, requireListAccess('view'), requireListsAccess('edit')] },
    async (request) => {
      const source = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId),
        ),
      });
      if (!source) throw Errors.notFound('List');

      const sourceItems = await db.query.listItems.findMany({
        where: eq(listItems.listId, source.id),
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
      });

      const [copy] = await db
        .insert(lists)
        .values({
          householdId: source.householdId,
          name: request.body?.name ?? `${source.name} (copy)`,
          type: source.type,
          icon: source.icon,
          color: source.color,
          recipientUserId: source.recipientUserId,
          isTemplate: request.body?.asTemplate ?? false,
          parentListId: source.id,
          createdBy: request.user!.id,
        })
        .returning();

      await setResourceDefaults('list', copy.id, request.user!.id, request.user!.householdId);

      // Two-pass copy to preserve parent_item_id wiring inside the new list.
      const idMap = new Map<string, string>();
      const reset = request.body?.resetChecks !== false; // default true
      for (const it of sourceItems) {
        const [newItem] = await db
          .insert(listItems)
          .values({
            listId: copy.id,
            content: it.content,
            isChecked: reset ? false : it.isChecked,
            checkedAt: reset ? null : it.checkedAt,
            dueDate: it.dueDate,
            sortOrder: it.sortOrder,
            sectionLabel: it.sectionLabel,
            assigneeUserId: it.assigneeUserId,
            notes: it.notes,
            url: it.url,
            price: it.price,
            rewardPoints: it.rewardPoints,
            createdBy: request.user!.id,
          })
          .returning();
        idMap.set(it.id, newItem.id);
      }
      // Pass two: fix parent_item_id refs now that we have new ids.
      for (const it of sourceItems) {
        if (it.parentItemId && idMap.has(it.parentItemId)) {
          await db
            .update(listItems)
            .set({ parentItemId: idMap.get(it.parentItemId)! })
            .where(eq(listItems.id, idMap.get(it.id)!));
        }
      }

      return { success: true, data: { list: copy } };
    },
  );

  // Get list with items
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireListAccess('view')] },
    async (request) => {
      const list = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId),
        ),
      });

      if (!list) throw Errors.notFound('List');

      const items = await db.query.listItems.findMany({
        where: eq(listItems.listId, list.id),
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
      });

      const hideClaim =
        list.type === 'wishlist' && list.recipientUserId === request.user!.id;
      const cleaned = items.map((i) => maybeHideClaim(i, hideClaim));

      return { success: true, data: { list, items: cleaned } };
    },
  );

  // Update list (rename, change icon/color, pin, archive, template flag)
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
    async (request) => {
      const input = updateListSchema.parse(request.body);

      const [updated] = await db
        .update(lists)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(lists.id, request.params.id),
            eq(lists.householdId, request.user!.householdId),
          ),
        )
        .returning();

      if (!updated) throw Errors.notFound('List');

      return { success: true, data: { list: updated } };
    },
  );

  // Delete list
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authMiddleware, requireListAccess('admin')] },
    async (request) => {
      await db
        .delete(lists)
        .where(
          and(
            eq(lists.id, request.params.id),
            eq(lists.householdId, request.user!.householdId),
          ),
        );

      return { success: true, data: { message: 'List deleted' } };
    },
  );

  // Add item to list
  app.post<{ Params: { id: string } }>(
    '/:id/items',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
    async (request) => {
      const input = createListItemSchema.parse(request.body);

      const list = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId),
        ),
      });
      if (!list) throw Errors.notFound('List');

      // Append at end if no sortOrder given.
      let sortOrder = input.sortOrder;
      if (sortOrder === undefined) {
        const tail = await db.query.listItems.findMany({
          where: eq(listItems.listId, list.id),
          orderBy: (i, { desc }) => [desc(i.sortOrder)],
          limit: 1,
        });
        sortOrder = (tail[0]?.sortOrder ?? -1) + 1;
      }

      const [item] = await db
        .insert(listItems)
        .values({
          listId: request.params.id,
          content: input.content,
          dueDate: input.dueDate ?? null,
          sortOrder,
          parentItemId: input.parentItemId ?? null,
          sectionLabel: input.sectionLabel ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
          notes: input.notes ?? null,
          url: input.url || null,
          price: input.price != null ? String(input.price) : null,
          rewardPoints: input.rewardPoints ?? 0,
          createdBy: request.user!.id,
        })
        .returning();

      return { success: true, data: { item } };
    },
  );

  // Bulk add items
  app.post<{ Params: { id: string } }>(
    '/:id/items/bulk',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
    async (request) => {
      const input = bulkCreateItemsSchema.parse(request.body);

      const list = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId),
        ),
      });
      if (!list) throw Errors.notFound('List');

      const tail = await db.query.listItems.findMany({
        where: eq(listItems.listId, list.id),
        orderBy: (i, { desc }) => [desc(i.sortOrder)],
        limit: 1,
      });
      let nextSort = (tail[0]?.sortOrder ?? -1) + 1;

      const rows = input.items.map((it) => ({
        listId: request.params.id,
        content: it.content,
        dueDate: it.dueDate ?? null,
        sortOrder: nextSort++,
        sectionLabel: it.sectionLabel ?? null,
        assigneeUserId: it.assigneeUserId ?? null,
        notes: it.notes ?? null,
        url: it.url || null,
        price: it.price != null ? String(it.price) : null,
        rewardPoints: it.rewardPoints ?? 0,
        createdBy: request.user!.id,
      }));

      const inserted = await db.insert(listItems).values(rows).returning();
      return { success: true, data: { items: inserted } };
    },
  );

  // Update list item
  app.patch<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
    async (request) => {
      const input = updateListItemSchema.parse(request.body);

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(input)) {
        if (v === undefined) continue;
        patch[k] = k === 'price' && v !== null ? String(v) : v === '' ? null : v;
      }

      const [updated] = await db
        .update(listItems)
        .set(patch)
        .where(
          and(
            eq(listItems.id, request.params.itemId),
            eq(listItems.listId, request.params.id),
          ),
        )
        .returning();

      if (!updated) throw Errors.notFound('List item');
      return { success: true, data: { item: updated } };
    },
  );

  // Delete list item
  app.delete<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
    async (request) => {
      await db
        .delete(listItems)
        .where(
          and(
            eq(listItems.id, request.params.itemId),
            eq(listItems.listId, request.params.id),
          ),
        );

      return { success: true, data: { message: 'Item deleted' } };
    },
  );

  // Toggle item checked status (awards rewardPoints if rewards feature on)
  app.post<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId/toggle',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
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
    },
  );

  // Claim / unclaim a wishlist item
  app.post<{ Params: { id: string; itemId: string } }>(
    '/:id/items/:itemId/claim',
    { preHandler: [authMiddleware, requireListAccess('view')] },
    async (request) => {
      const list = await db.query.lists.findFirst({
        where: and(
          eq(lists.id, request.params.id),
          eq(lists.householdId, request.user!.householdId),
        ),
      });
      if (!list) throw Errors.notFound('List');
      if (list.type !== 'wishlist') {
        throw Errors.validation('Only wishlist items can be claimed');
      }
      if (list.recipientUserId === request.user!.id) {
        throw Errors.validation('Recipient cannot claim items on their own list');
      }

      const item = await db.query.listItems.findFirst({
        where: and(
          eq(listItems.id, request.params.itemId),
          eq(listItems.listId, request.params.id),
        ),
      });
      if (!item) throw Errors.notFound('List item');

      // Toggle: if I claimed it, unclaim. If someone else claimed it, refuse.
      // If unclaimed, take it.
      let next: { claimedByUserId: string | null; claimedAt: Date | null };
      if (item.claimedByUserId === request.user!.id) {
        next = { claimedByUserId: null, claimedAt: null };
      } else if (item.claimedByUserId) {
        throw Errors.validation('Already claimed by another member');
      } else {
        next = { claimedByUserId: request.user!.id, claimedAt: new Date() };
      }

      const [updated] = await db
        .update(listItems)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(listItems.id, request.params.itemId))
        .returning();

      return { success: true, data: { item: updated } };
    },
  );

  // Reorder items
  app.post<{ Params: { id: string } }>(
    '/:id/items/reorder',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
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
    },
  );

  // Clear all checked items
  app.delete<{ Params: { id: string } }>(
    '/:id/items/checked',
    { preHandler: [authMiddleware, requireListAccess('edit')] },
    async (request) => {
      await db
        .delete(listItems)
        .where(
          and(
            eq(listItems.listId, request.params.id),
            eq(listItems.isChecked, true),
          ),
        );

      return { success: true, data: { message: 'Checked items cleared' } };
    },
  );

  // Public read-only view (for share-via-link). Token is the list id; gated by
  // a special "public share" permission row created when the user enables
  // sharing on a list. For now we keep this loose — the route checks for a
  // share permission with grantee_type='external' on the list resource.
  app.get<{ Params: { id: string } }>(
    '/:id/public',
    async (request) => {
      const list = await db.query.lists.findFirst({
        where: eq(lists.id, request.params.id),
      });
      if (!list) throw Errors.notFound('List');

      // Public route has no authenticated user — only readable if an external
      // share permission exists for this resource.
      const share = await db.query.permissions.findFirst({
        where: and(
          eq(permissions.resourceType, 'list'),
          eq(permissions.resourceId, list.id),
          eq(permissions.granteeType, 'external'),
        ),
      });
      if (!share) throw Errors.notFound('List');

      const items = await db.query.listItems.findMany({
        where: eq(listItems.listId, list.id),
        orderBy: (i, { asc }) => [asc(i.sortOrder)],
      });

      // Public view never exposes claim metadata.
      const safeItems = items.map((i) => maybeHideClaim(i, true));
      return { success: true, data: { list, items: safeItems } };
    },
  );
}
