import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { StorageArea, InventoryItem, StockEntry, ShoppingListItem } from '@/types/models';

export interface CreateAreaRequest {
  name: string;
  icon?: string;
}

export interface UpdateAreaRequest {
  name?: string;
  icon?: string;
  order?: number;
}

export interface ReorderAreasRequest {
  order: Array<{ id: string; sortOrder: number }>;
}

export interface CreateItemRequest {
  name: string;
  category?: string;
  barcode?: string;
  defaultUnit: string;
  keepInStock?: boolean;
  minStockLevel?: number;
}

export interface UpdateItemRequest extends Partial<CreateItemRequest> {}

export interface QuickCreateItemRequest {
  name: string;
  defaultUnit?: string;
  category?: string;
  defaultAreaId?: string;
}

export interface BatchCreateItemsRequest {
  items: QuickCreateItemRequest[];
}

export interface BatchDeleteItemsRequest {
  itemIds: string[];
  deleteType: 'stock_only' | 'catalog';
}

export interface BatchUpdateItemsRequest {
  itemIds: string[];
  updates: {
    category?: string;
    keepInStock?: boolean;
    minStockQuantity?: number;
    defaultAreaId?: string | null;
  };
}

export interface GetItemsParams {
  search?: string;
  category?: string;
  areaId?: string;
  lowStock?: boolean;
  expiringSoon?: boolean;
  page?: number;
  limit?: number;
}

export interface AddStockRequest {
  itemId: string;
  areaId: string;
  quantity: number;
  unit?: string;
  expiryDate?: string;
}

export interface UpdateStockRequest {
  quantity?: number;
  unit?: string;
  expiryDate?: string;
  notes?: string;
}

// Shopping list
export interface CreateShoppingListItemRequest {
  itemId?: string;
  customName?: string;
  quantity?: number;
  unit?: string;
  targetAreaId?: string;
}

export interface MoveToInventoryRequest {
  areaId: string;
  expiryDate?: string;
  quantity?: number;
}

export const inventoryApi = {
  // Storage Areas
  getAreas: () =>
    apiGet<{ areas: StorageArea[] }>('/inventory/areas'),

  createArea: (data: CreateAreaRequest) =>
    apiPost<{ area: StorageArea }>('/inventory/areas', data),

  updateArea: (id: string, data: UpdateAreaRequest) =>
    apiPatch<{ area: StorageArea }>(`/inventory/areas/${id}`, data),

  deleteArea: (id: string) =>
    apiDelete<{ message: string }>(`/inventory/areas/${id}`),

  reorderAreas: (data: ReorderAreasRequest) =>
    apiPost<{ message: string }>('/inventory/areas/reorder', data),

  // Inventory Items
  getItems: (params?: GetItemsParams) =>
    apiGet<{ items: InventoryItem[] }>('/inventory/items', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  getItem: (id: string) =>
    apiGet<{ item: InventoryItem }>(`/inventory/items/${id}`),

  createItem: (data: CreateItemRequest) =>
    apiPost<{ item: InventoryItem }>('/inventory/items', data),

  updateItem: (id: string, data: UpdateItemRequest) =>
    apiPatch<{ item: InventoryItem }>(`/inventory/items/${id}`, data),

  deleteItem: (id: string) =>
    apiDelete<{ message: string }>(`/inventory/items/${id}`),

  quickCreateItem: (data: QuickCreateItemRequest) =>
    apiPost<{ item: InventoryItem }>('/inventory/items/quick-create', data),

  batchCreateItems: (data: BatchCreateItemsRequest) =>
    apiPost<{ items: InventoryItem[] }>('/inventory/items/batch', data),

  batchDeleteItems: (data: BatchDeleteItemsRequest) =>
    apiPost<{ message: string }>('/inventory/items/batch-delete', data),

  batchUpdateItems: (data: BatchUpdateItemsRequest) =>
    apiPost<{ items: InventoryItem[] }>('/inventory/items/batch-update', data),

  // Stock
  getStock: () =>
    apiGet<{ stock: StockEntry[] }>('/inventory/stock'),

  addStock: (data: AddStockRequest) =>
    apiPost<{ stock: StockEntry }>('/inventory/stock', data),

  updateStock: (id: string, data: UpdateStockRequest) =>
    apiPatch<{ stock: StockEntry }>(`/inventory/stock/${id}`, data),

  deleteStock: (id: string) =>
    apiDelete<{ message: string }>(`/inventory/stock/${id}`),

  // Expiring & Low Stock
  getExpiringItems: (days?: number) =>
    apiGet<{ expiring: Array<StockEntry & { item: InventoryItem; area: StorageArea }> }>('/inventory/expiring', {
      params: { days }
    }),

  getLowStockItems: () =>
    apiGet<{ lowStock: Array<{ item: InventoryItem; currentQuantity: number; minQuantity: number; status: string }> }>('/inventory/low-stock'),

  getKeepInStockItems: () =>
    apiGet<{ items: Array<{ item: InventoryItem; currentQuantity: number; minQuantity: number; unit: string; status: string; onShoppingList: boolean }> }>('/inventory/keep-in-stock'),

  // Shopping List
  getShoppingList: async () => {
    const response = await apiGet<{ shoppingList: Array<{
      id: string;
      householdId: string;
      itemId?: string;
      customName?: string;
      quantity: number | string;
      unit?: string;
      category?: string;
      isChecked: boolean;
      source: 'manual' | 'meal_plan' | 'low_stock' | 'recipe';
      addedBy: string;
      targetAreaId?: string;
      createdAt: string;
      updatedAt: string;
    }> }>('/inventory/shopping-list');

    // Transform backend field names to frontend expected names
    return {
      shoppingList: response.shoppingList.map(item => ({
        id: item.id,
        householdId: item.householdId,
        inventoryItemId: item.itemId,
        name: item.customName || '',
        quantity: typeof item.quantity === 'string' ? parseFloat(item.quantity) : item.quantity,
        unit: item.unit,
        category: item.category,
        checked: item.isChecked,
        source: item.source,
        addedBy: item.addedBy,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })) as ShoppingListItem[]
    };
  },

  addToShoppingList: async (data: CreateShoppingListItemRequest) => {
    const response = await apiPost<{ item: {
      id: string;
      householdId: string;
      itemId?: string;
      customName?: string;
      quantity: number | string;
      unit?: string;
      category?: string;
      isChecked: boolean;
      source: 'manual' | 'meal_plan' | 'low_stock' | 'recipe';
      addedBy: string;
      createdAt: string;
      updatedAt: string;
    } }>('/inventory/shopping-list', data);

    return {
      item: {
        id: response.item.id,
        householdId: response.item.householdId,
        inventoryItemId: response.item.itemId,
        name: response.item.customName || '',
        quantity: typeof response.item.quantity === 'string' ? parseFloat(response.item.quantity) : response.item.quantity,
        unit: response.item.unit,
        category: response.item.category,
        checked: response.item.isChecked,
        source: response.item.source,
        addedBy: response.item.addedBy,
        createdAt: response.item.createdAt,
        updatedAt: response.item.updatedAt,
      } as ShoppingListItem
    };
  },

  checkShoppingListItem: (id: string) =>
    apiPost<{ item: ShoppingListItem }>(`/inventory/shopping-list/${id}/check`, {}),

  deleteShoppingListItem: (id: string) =>
    apiDelete<{ message: string }>(`/inventory/shopping-list/${id}`),

  clearCheckedItems: () =>
    apiDelete<{ message: string }>('/inventory/shopping-list/checked'),

  moveToInventory: (id: string, data: MoveToInventoryRequest) =>
    apiPost<{ message: string }>(`/inventory/shopping-list/${id}/to-inventory`, data),
};
