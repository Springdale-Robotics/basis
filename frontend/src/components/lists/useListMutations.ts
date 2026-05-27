import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resilientListsApi } from '@/lib/offline/listsApiResilient';
import type { CreateListItemRequest, UpdateListItemRequest } from '@/api/lists';

/**
 * Centralized list-item mutations with consistent cache invalidation. Uses
 * the offline-aware `resilientListsApi`: writes succeed locally even when
 * the network is down, and are replayed by the sync layer on reconnect.
 */
export function useListMutations(listId: string) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['lists', listId] });
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    queryClient.invalidateQueries({ queryKey: ['lists', 'items-search'] });
  };

  const addItem = useMutation({
    mutationFn: (input: CreateListItemRequest) =>
      resilientListsApi.createItem(listId, input),
    onSuccess: invalidate,
  });

  const bulkAdd = useMutation({
    mutationFn: (items: CreateListItemRequest[]) =>
      resilientListsApi.bulkCreateItems(listId, items),
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: UpdateListItemRequest }) =>
      resilientListsApi.updateItem(listId, itemId, data),
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => resilientListsApi.deleteItem(listId, itemId),
    onSuccess: invalidate,
  });

  const toggleItem = useMutation({
    mutationFn: (itemId: string) => resilientListsApi.toggleItem(listId, itemId),
    onSuccess: invalidate,
  });

  const claimItem = useMutation({
    mutationFn: (itemId: string) => resilientListsApi.claimItem(listId, itemId),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (order: Array<{ id: string; sortOrder: number }>) =>
      resilientListsApi.reorderItems(listId, { order }),
    onSuccess: invalidate,
  });

  const clearChecked = useMutation({
    mutationFn: () => resilientListsApi.clearCheckedItems(listId),
    onSuccess: invalidate,
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
