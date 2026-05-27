// Drop-in replacement for listsApi mutations that fall back to enqueuing the
// mutation when the network is unavailable. The signatures match the original
// listsApi exactly so callers don't need to branch on online/offline.
import { listsApi, type CreateListItemRequest, type UpdateListItemRequest, type ReorderItemsRequest } from '@/api/lists';
import { offlineDb, type QueuedMutation } from './db';
import { drainQueue } from './sync';
import type { List, ListItem } from '@/types/models';

function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /NetworkError|Failed to fetch|TypeError/i.test(msg);
}

async function enqueue(
  kind: QueuedMutation['kind'],
  payload: Record<string, unknown>,
  listId?: string,
) {
  await offlineDb.queue.push({
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enqueuedAt: Date.now(),
    listId,
    kind,
    payload,
  });
  if (navigator.onLine) void drainQueue();
}

/** Build a fake-but-realistic ListItem for optimistic UI when offline. */
function ghostItem(listId: string, input: CreateListItemRequest): ListItem {
  const now = new Date().toISOString();
  return {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    listId,
    content: input.content,
    isChecked: false,
    dueDate: input.dueDate ?? null,
    sortOrder: input.sortOrder ?? 0,
    parentItemId: input.parentItemId ?? null,
    sectionLabel: input.sectionLabel ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    notes: input.notes ?? null,
    url: input.url ?? null,
    price: input.price != null ? String(input.price) : null,
    claimedByUserId: null,
    claimedAt: null,
    rewardPoints: input.rewardPoints ?? 0,
    createdBy: 'offline',
    createdAt: now,
    checkedAt: null,
    updatedAt: now,
  };
}

export const resilientListsApi = {
  async createItem(listId: string, data: CreateListItemRequest) {
    try {
      return await listsApi.createItem(listId, data);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('addItem', { listId, data }, listId);
      return { item: ghostItem(listId, data) };
    }
  },
  async bulkCreateItems(listId: string, items: CreateListItemRequest[]) {
    try {
      return await listsApi.bulkCreateItems(listId, items);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('bulkAdd', { listId, items }, listId);
      return { items: items.map((i) => ghostItem(listId, i)) };
    }
  },
  async updateItem(listId: string, itemId: string, data: UpdateListItemRequest) {
    try {
      return await listsApi.updateItem(listId, itemId, data);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('updateItem', { listId, itemId, data }, listId);
      // Return shape compatible with online — caller invalidates cache anyway.
      return { item: { id: itemId, ...data } as unknown as ListItem };
    }
  },
  async deleteItem(listId: string, itemId: string) {
    try {
      return await listsApi.deleteItem(listId, itemId);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('deleteItem', { listId, itemId }, listId);
      return { message: 'Queued' };
    }
  },
  async toggleItem(listId: string, itemId: string) {
    try {
      return await listsApi.toggleItem(listId, itemId);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('toggleItem', { listId, itemId }, listId);
      return { item: { id: itemId } as unknown as ListItem };
    }
  },
  async claimItem(listId: string, itemId: string) {
    try {
      return await listsApi.claimItem(listId, itemId);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('claimItem', { listId, itemId }, listId);
      return { item: { id: itemId } as unknown as ListItem };
    }
  },
  async reorderItems(listId: string, data: ReorderItemsRequest) {
    try {
      return await listsApi.reorderItems(listId, data);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('reorder', { listId, order: data.order }, listId);
      return { message: 'Queued' };
    }
  },
  async clearCheckedItems(listId: string) {
    try {
      return await listsApi.clearCheckedItems(listId);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('clearChecked', { listId }, listId);
      return { message: 'Queued' };
    }
  },
  async create(data: Parameters<typeof listsApi.create>[0]) {
    try {
      return await listsApi.create(data);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('createList', { data });
      const list: List = {
        id: `offline-${Date.now()}`,
        householdId: 'offline',
        name: data.name,
        type: data.type ?? 'checklist',
        icon: data.icon ?? null,
        color: data.color ?? null,
        recipientUserId: data.recipientUserId ?? null,
        isTemplate: data.isTemplate ?? false,
        isPinned: false,
        archivedAt: null,
        parentListId: null,
        createdBy: 'offline',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { list };
    }
  },
  async update(id: string, data: Parameters<typeof listsApi.update>[1]) {
    try {
      return await listsApi.update(id, data);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('updateList', { id, data }, id);
      return { list: { id, ...data } as unknown as List };
    }
  },
  async delete(id: string) {
    try {
      return await listsApi.delete(id);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueue('deleteList', { id }, id);
      return { message: 'Queued' };
    }
  },
};
