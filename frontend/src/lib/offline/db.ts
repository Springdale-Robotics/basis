// Tiny IndexedDB wrapper around idb-keyval. We use named stores to keep the
// surface focused (lists / items / queue / meta). Anything more complex than
// key/value should be modeled as a typed accessor below — callers should
// never reach for raw idb-keyval values.
import { createStore, get, set, del, keys, clear } from 'idb-keyval';
import type { List, ListItem } from '@/types/models';

const listsStore = createStore('homemanager-offline', 'lists');
const itemsStore = createStore('homemanager-offline', 'list-items');
const queueStore = createStore('homemanager-offline', 'mutation-queue');
const metaStore = createStore('homemanager-offline', 'meta');

export interface CachedList {
  list: List;
  items: ListItem[];
  cachedAt: number;
}

export const offlineDb = {
  async getList(id: string): Promise<CachedList | undefined> {
    return get<CachedList>(id, listsStore);
  },
  async putList(id: string, value: CachedList): Promise<void> {
    await set(id, value, listsStore);
  },
  async deleteList(id: string): Promise<void> {
    await del(id, listsStore);
  },
  async allListIds(): Promise<string[]> {
    return (await keys(listsStore)) as string[];
  },
  async getAllListsIndex(): Promise<List[]> {
    return (await get<List[]>('all', itemsStore)) ?? [];
  },
  async putAllListsIndex(lists: List[]): Promise<void> {
    await set('all', lists, itemsStore);
  },
  async clearAll(): Promise<void> {
    await Promise.all([clear(listsStore), clear(itemsStore), clear(queueStore)]);
  },
  // Queue API — see queue.ts for higher-level mutation handling.
  queue: {
    async push(entry: QueuedMutation): Promise<void> {
      await set(entry.id, entry, queueStore);
    },
    async pop(id: string): Promise<void> {
      await del(id, queueStore);
    },
    async all(): Promise<QueuedMutation[]> {
      const ids = (await keys(queueStore)) as string[];
      const entries = await Promise.all(
        ids.map((id) => get<QueuedMutation>(id, queueStore)),
      );
      return entries
        .filter((e): e is QueuedMutation => !!e)
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    },
    async clear(): Promise<void> {
      await clear(queueStore);
    },
  },
  meta: {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return get<T>(key, metaStore);
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      await set(key, value, metaStore);
    },
  },
};

export interface QueuedMutation {
  id: string;
  enqueuedAt: number;
  /** Optional list scope for grouped flushes. */
  listId?: string;
  /**
   * The mutation kind. The replay logic in sync.ts maps these to the actual
   * listsApi call. Keep this enum stable — old entries persist across reloads.
   */
  kind:
    | 'addItem'
    | 'updateItem'
    | 'deleteItem'
    | 'toggleItem'
    | 'reorder'
    | 'clearChecked'
    | 'claimItem'
    | 'bulkAdd'
    | 'createList'
    | 'updateList'
    | 'deleteList';
  // Free-form payload; sync.ts validates shape on replay.
  payload: Record<string, unknown>;
}
