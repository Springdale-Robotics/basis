import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { List, ListItem } from '@/types/models';

export interface CreateListRequest {
  name: string;
  type?: 'checklist' | 'reminder' | 'notes';
  icon?: string;
  color?: string;
}

export interface UpdateListRequest extends Partial<CreateListRequest> {}

export interface CreateListItemRequest {
  content: string;
  dueDate?: string;
  sortOrder?: number;
}

export interface UpdateListItemRequest {
  content?: string;
  dueDate?: string;
  sortOrder?: number;
}

export interface ReorderItemsRequest {
  order: Array<{ id: string; sortOrder: number }>;
}

export const listsApi = {
  list: () =>
    apiGet<{ lists: List[] }>('/lists'),

  get: (id: string) =>
    apiGet<{ list: List; items: ListItem[] }>(`/lists/${id}`),

  create: (data: CreateListRequest) =>
    apiPost<{ list: List }>('/lists', data),

  update: (id: string, data: UpdateListRequest) =>
    apiPatch<{ list: List }>(`/lists/${id}`, data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/lists/${id}`),

  // Items
  createItem: (listId: string, data: CreateListItemRequest) =>
    apiPost<{ item: ListItem }>(`/lists/${listId}/items`, data),

  updateItem: (listId: string, itemId: string, data: UpdateListItemRequest) =>
    apiPatch<{ item: ListItem }>(`/lists/${listId}/items/${itemId}`, data),

  deleteItem: (listId: string, itemId: string) =>
    apiDelete<{ message: string }>(`/lists/${listId}/items/${itemId}`),

  toggleItem: (listId: string, itemId: string) =>
    apiPost<{ item: ListItem }>(`/lists/${listId}/items/${itemId}/toggle`, {}),

  reorderItems: (listId: string, data: ReorderItemsRequest) =>
    apiPost<{ message: string }>(`/lists/${listId}/items/reorder`, data),

  clearCheckedItems: (listId: string) =>
    apiDelete<{ message: string }>(`/lists/${listId}/items/checked`),
};
