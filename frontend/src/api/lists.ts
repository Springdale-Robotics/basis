import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { List, ListItem, ListType } from '@/types/models';

export interface CreateListRequest {
  name: string;
  type?: Exclude<ListType, 'reminder'>;
  icon?: string;
  color?: string;
  recipientUserId?: string | null;
  isTemplate?: boolean;
}

export interface UpdateListRequest {
  name?: string;
  icon?: string | null;
  color?: string | null;
  recipientUserId?: string | null;
  isPinned?: boolean;
  isTemplate?: boolean;
  archivedAt?: string | null;
}

export interface ListItemFields {
  content: string;
  dueDate?: string | null;
  sortOrder?: number;
  parentItemId?: string | null;
  sectionLabel?: string | null;
  assigneeUserId?: string | null;
  notes?: string | null;
  url?: string | null;
  price?: number | null;
  rewardPoints?: number;
}

export type CreateListItemRequest = ListItemFields;
export type UpdateListItemRequest = Partial<ListItemFields>;

export interface ReorderItemsRequest {
  order: Array<{ id: string; sortOrder: number }>;
}

export interface ListQuery {
  includeArchived?: boolean;
  includeTemplates?: boolean;
  onlyTemplates?: boolean;
  search?: string;
}

export interface ItemsSearchQuery {
  assigneeUserId?: string;
  dueWithinDays?: number;
  checked?: boolean;
  search?: string;
  limit?: number;
}

function qs(params: Record<string, unknown> | ListQuery | ItemsSearchQuery): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const listsApi = {
  list: (q: ListQuery = {}) =>
    apiGet<{ lists: List[] }>(`/lists${qs(q)}`),

  get: (id: string) =>
    apiGet<{ list: List; items: ListItem[] }>(`/lists/${id}`),

  create: (data: CreateListRequest) =>
    apiPost<{ list: List }>('/lists', data),

  update: (id: string, data: UpdateListRequest) =>
    apiPatch<{ list: List }>(`/lists/${id}`, data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/lists/${id}`),

  duplicate: (id: string, opts: { name?: string; resetChecks?: boolean; asTemplate?: boolean } = {}) =>
    apiPost<{ list: List }>(`/lists/${id}/duplicate`, opts),

  // Items
  createItem: (listId: string, data: CreateListItemRequest) =>
    apiPost<{ item: ListItem }>(`/lists/${listId}/items`, data),

  bulkCreateItems: (listId: string, items: CreateListItemRequest[]) =>
    apiPost<{ items: ListItem[] }>(`/lists/${listId}/items/bulk`, { items }),

  updateItem: (listId: string, itemId: string, data: UpdateListItemRequest) =>
    apiPatch<{ item: ListItem }>(`/lists/${listId}/items/${itemId}`, data),

  deleteItem: (listId: string, itemId: string) =>
    apiDelete<{ message: string }>(`/lists/${listId}/items/${itemId}`),

  toggleItem: (listId: string, itemId: string) =>
    apiPost<{ item: ListItem }>(`/lists/${listId}/items/${itemId}/toggle`, {}),

  claimItem: (listId: string, itemId: string) =>
    apiPost<{ item: ListItem }>(`/lists/${listId}/items/${itemId}/claim`, {}),

  reorderItems: (listId: string, data: ReorderItemsRequest) =>
    apiPost<{ message: string }>(`/lists/${listId}/items/reorder`, data),

  clearCheckedItems: (listId: string) =>
    apiDelete<{ message: string }>(`/lists/${listId}/items/checked`),

  searchItems: (q: ItemsSearchQuery) =>
    apiGet<{
      items: ListItem[];
      lists: Array<Pick<List, 'id' | 'name' | 'type' | 'recipientUserId'>>;
    }>(`/lists/items/search${qs(q)}`),
};
