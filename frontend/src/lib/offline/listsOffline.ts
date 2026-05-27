// Offline-aware wrapper around listsApi. Reads fall back to IndexedDB when
// the network fails; writes are queued and replayed on reconnect.
//
// Conflict policy (decided in the plan):
//   - Item content: last-write-wins (we replay our latest write).
//   - Checked state: "any client's checked wins" — we never replay a server-
//     newer uncheck, but we DO replay our local checks. Implemented by
//     converting offline 'toggle' calls into explicit checked=true updates
//     when the local snapshot says checked.
import { listsApi } from '@/api/lists';
import { offlineDb, type QueuedMutation } from './db';
import { drainQueue } from './sync';
import type { List, ListItem } from '@/types/models';

function rid() {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function enqueue(
  kind: QueuedMutation['kind'],
  payload: Record<string, unknown>,
  listId?: string,
) {
  await offlineDb.queue.push({
    id: rid(),
    enqueuedAt: Date.now(),
    listId,
    kind,
    payload,
  });
  if (navigator.onLine) void drainQueue();
}

export const listsOffline = {
  async getList(id: string): Promise<{ list: List; items: ListItem[] } | null> {
    try {
      const res = await listsApi.get(id);
      await offlineDb.putList(id, {
        list: res.list,
        items: res.items,
        cachedAt: Date.now(),
      });
      return res;
    } catch (_err) {
      const cached = await offlineDb.getList(id);
      if (cached) return { list: cached.list, items: cached.items };
      return null;
    }
  },

  async listAll(): Promise<{ lists: List[] }> {
    try {
      const res = await listsApi.list({});
      await offlineDb.putAllListsIndex(res.lists);
      return res;
    } catch (_err) {
      const cached = await offlineDb.getAllListsIndex();
      return { lists: cached };
    }
  },

  /**
   * Optimistic local mutation that updates the cached list + items, then
   * enqueues for replay. Used by ChecklistView etc. via useListMutations.
   */
  async mutateItem(
    listId: string,
    itemId: string,
    patch: Partial<ListItem>,
    kind: QueuedMutation['kind'] = 'updateItem',
  ) {
    const cached = await offlineDb.getList(listId);
    if (cached) {
      cached.items = cached.items.map((i) =>
        i.id === itemId ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i,
      );
      await offlineDb.putList(listId, cached);
    }
    await enqueue(kind, { listId, itemId, data: patch }, listId);
  },
};
