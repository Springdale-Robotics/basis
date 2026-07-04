import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isQueuedOffline, resilientListsApi } from '@/lib/offline/listsApiResilient';
import { offlineDb } from '@/lib/offline/db';
import { useAuthStore } from '@/stores/authStore';
import type { CreateListItemRequest, UpdateListItemRequest } from '@/api/lists';
import type { List, ListItem } from '@/types/models';

interface ListDetail {
  list: List;
  items: ListItem[];
}

/** Drop undefined entries so a partial update can't clobber existing fields. */
function definedEntries<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Centralized list-item mutations with consistent cache invalidation. Uses
 * the offline-aware `resilientListsApi`: writes succeed locally even when
 * the network is down, and are replayed by the sync layer on reconnect.
 *
 * When a write couldn't reach the server (`isQueuedOffline`), the result is
 * written directly into the `['lists', listId]` cache (and the IndexedDB
 * snapshot) so the change is visible immediately — a refetch would fail or
 * return pre-mutation data while offline. Online results invalidate queries
 * as usual so server truth wins.
 */
export function useListMutations(listId: string) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const detailKey = ['lists', listId];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lists', listId] });
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    queryClient.invalidateQueries({ queryKey: ['lists', 'items-search'] });
  };

  /**
   * Rewrite the cached list detail so queued-offline writes are visible
   * immediately. Also refreshes the IndexedDB snapshot so a reload while
   * still offline shows the same state.
   */
  const patchItems = (fn: (items: ListItem[]) => ListItem[]) => {
    const current = queryClient.getQueryData<ListDetail>(detailKey);
    if (!current) return;
    const next: ListDetail = { ...current, items: fn(current.items) };
    queryClient.setQueryData<ListDetail>(detailKey, next);
    offlineDb
      .putList(listId, { list: next.list, items: next.items, cachedAt: Date.now() })
      .catch(() => {
        /* snapshot is best-effort */
      });
  };

  /**
   * Post-mutation reconciliation. Ghost (queued-offline) results are patched
   * into the cache; the queue drain invalidates for server truth after
   * replay. Real server results just invalidate.
   */
  const settle = (res: unknown, applyGhost: () => void) => {
    if (isQueuedOffline(res)) {
      applyGhost();
      // If the browser claims to be online (server unreachable for another
      // reason), still ask for server truth — a failed refetch keeps our
      // patched data.
      if (navigator.onLine) invalidate();
    } else {
      invalidate();
    }
  };

  const nextSortOrder = (items: ListItem[]) =>
    items.reduce((max, i) => Math.max(max, i.sortOrder), 0) + 1;

  const addItem = useMutation({
    mutationFn: (input: CreateListItemRequest) =>
      resilientListsApi.createItem(listId, input),
    onSuccess: (res) =>
      settle(res, () =>
        patchItems((items) => [
          ...items,
          { ...res.item, sortOrder: res.item.sortOrder || nextSortOrder(items) },
        ]),
      ),
  });

  const bulkAdd = useMutation({
    mutationFn: (items: CreateListItemRequest[]) =>
      resilientListsApi.bulkCreateItems(listId, items),
    onSuccess: (res) =>
      settle(res, () =>
        patchItems((items) => {
          const base = nextSortOrder(items);
          return [
            ...items,
            ...res.items.map((it, idx) => ({
              ...it,
              sortOrder: it.sortOrder || base + idx,
            })),
          ];
        }),
      ),
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: UpdateListItemRequest }) =>
      resilientListsApi.updateItem(listId, itemId, data),
    onSuccess: (res, vars) =>
      settle(res, () =>
        patchItems((items) =>
          items.map((i) => {
            if (i.id !== vars.itemId) return i;
            const { price, ...rest } = definedEntries(vars.data);
            const patched: ListItem = {
              ...i,
              ...rest,
              updatedAt: new Date().toISOString(),
            };
            if (price !== undefined) {
              patched.price = price != null ? String(price) : null;
            }
            return patched;
          }),
        ),
      ),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => resilientListsApi.deleteItem(listId, itemId),
    onSuccess: (res, itemId) =>
      settle(res, () =>
        patchItems((items) =>
          items.filter((i) => i.id !== itemId && i.parentItemId !== itemId),
        ),
      ),
  });

  const toggleItem = useMutation({
    mutationFn: (itemId: string) => resilientListsApi.toggleItem(listId, itemId),
    // Optimistic: flip the checkbox immediately so slow connections can't
    // double-fire. Queued-offline results keep this patch (settle's ghost
    // apply is a no-op because the cache is already flipped); online results
    // invalidate so server truth wins.
    onMutate: async (itemId) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const prev = queryClient.getQueryData<ListDetail>(detailKey);
      patchItems((items) =>
        items.map((i) =>
          i.id === itemId
            ? {
                ...i,
                isChecked: !i.isChecked,
                checkedAt: !i.isChecked ? new Date().toISOString() : null,
                updatedAt: new Date().toISOString(),
              }
            : i,
        ),
      );
      return { prev };
    },
    onError: (_err, _itemId, ctx) => {
      if (!ctx?.prev) return;
      queryClient.setQueryData(detailKey, ctx.prev);
      offlineDb
        .putList(listId, {
          list: ctx.prev.list,
          items: ctx.prev.items,
          cachedAt: Date.now(),
        })
        .catch(() => {
          /* snapshot is best-effort */
        });
    },
    onSuccess: (res) => settle(res, () => {}),
  });

  const claimItem = useMutation({
    mutationFn: (itemId: string) => resilientListsApi.claimItem(listId, itemId),
    onSuccess: (res, itemId) =>
      settle(res, () =>
        patchItems((items) =>
          items.map((i) => {
            if (i.id !== itemId) return i;
            const unclaim = !!currentUserId && i.claimedByUserId === currentUserId;
            return {
              ...i,
              claimedByUserId: unclaim ? null : currentUserId ?? i.claimedByUserId,
              claimedAt: unclaim ? null : new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          }),
        ),
      ),
  });

  const reorder = useMutation({
    mutationFn: (order: Array<{ id: string; sortOrder: number }>) =>
      resilientListsApi.reorderItems(listId, { order }),
    onSuccess: (res, order) =>
      settle(res, () =>
        patchItems((items) => {
          const sortById = new Map(order.map((o) => [o.id, o.sortOrder]));
          return items.map((i) => {
            const sortOrder = sortById.get(i.id);
            return sortOrder === undefined ? i : { ...i, sortOrder };
          });
        }),
      ),
  });

  const clearChecked = useMutation({
    mutationFn: () => resilientListsApi.clearCheckedItems(listId),
    onSuccess: (res) =>
      settle(res, () => patchItems((items) => items.filter((i) => !i.isChecked))),
  });

  return {
    addItem,
    bulkAdd,
    updateItem,
    deleteItem,
    toggleItem,
    claimItem,
    reorder,
    clearChecked,
  };
}
