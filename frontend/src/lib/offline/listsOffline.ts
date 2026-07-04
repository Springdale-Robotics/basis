// Offline read path for the lists domain. Drop-in replacements for the
// listsApi read calls: successful responses are snapshotted to IndexedDB;
// when the fetch fails because we're offline, the snapshot is served
// instead. Non-network errors (404, 403, ...) are rethrown so pages still
// show their real error states, and an offline miss (no snapshot) also
// rethrows so pages fall back to ErrorState.
//
// The write path lives in listsApiResilient.ts; useListMutations keeps the
// snapshot in sync when offline writes are patched into the query cache.
import { listsApi, type ListQuery } from '@/api/lists';
import { offlineDb } from './db';
import { isNetworkError } from './listsApiResilient';
import type { List, ListItem } from '@/types/models';

export const listsOffline = {
  /** listsApi.get with an IndexedDB fallback while offline. */
  async getList(id: string): Promise<{ list: List; items: ListItem[] }> {
    try {
      const res = await listsApi.get(id);
      offlineDb
        .putList(id, { list: res.list, items: res.items, cachedAt: Date.now() })
        .catch(() => {
          /* snapshot is best-effort */
        });
      return res;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const cached = await offlineDb.getList(id);
      if (cached) return { list: cached.list, items: cached.items };
      throw err;
    }
  },

  /**
   * listsApi.list with an IndexedDB fallback while offline. Only the default
   * view (active lists, no search/template/archive filters) is snapshotted
   * and served offline — filtered views rethrow so the page shows its error
   * state rather than wrong results.
   */
  async list(q: ListQuery = {}): Promise<{ lists: List[] }> {
    const isDefaultView = !q.search && !q.onlyTemplates && !q.includeArchived;
    try {
      const res = await listsApi.list(q);
      if (isDefaultView) {
        offlineDb.putAllListsIndex(res.lists).catch(() => {
          /* snapshot is best-effort */
        });
      }
      return res;
    } catch (err) {
      if (!isNetworkError(err) || !isDefaultView) throw err;
      const cached = await offlineDb.getAllListsIndex();
      if (cached.length > 0) return { lists: cached };
      throw err;
    }
  },
};
