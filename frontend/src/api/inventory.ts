import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { StorageArea, InventoryItem, StockEntry, ShoppingListItem, Leftover, LeftoverSource } from '@/types/models';

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
  minStockQuantity?: number;
  defaultAreaId?: string;
  icon?: string;
  density?: number;
  defaultShelfLifeDays?: number;
  quantityUnitWeights?: Record<string, number>;
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

// Leftovers
export interface CreateLeftoverRequest {
  name: string;
  description?: string;
  source?: LeftoverSource;
  sourceRecipeId?: string;
  restaurantName?: string;
  areaId?: string;
  portions?: number;
  quantityNotes?: string;
  preparedAt?: string;
  expiryDate?: string;
}

export interface UpdateLeftoverRequest extends Partial<CreateLeftoverRequest> {}

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

  saveQuantityUnitWeight: (itemId: string, unit: string, grams: number) =>
    apiPatch<{ item: InventoryItem }>(`/inventory/items/${itemId}/quantity-weight`, { unit, grams }),

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
      item?: {
        id: string;
        name: string;
        category?: string;
        defaultUnit?: string;
        defaultAreaId?: string;
      };
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
        defaultAreaId: item.item?.defaultAreaId,
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

  checkShoppingListItem: (id: string, options?: { acquiredQuantity?: number; keepRemainder?: boolean }) =>
    apiPost<{ item: ShoppingListItem; remainderItem: ShoppingListItem | null }>(`/inventory/shopping-list/${id}/check`, options || {}),

  deleteShoppingListItem: (id: string) =>
    apiDelete<{ message: string }>(`/inventory/shopping-list/${id}`),

  clearCheckedItems: () =>
    apiDelete<{ message: string }>('/inventory/shopping-list/checked'),

  moveToInventory: (id: string, data: MoveToInventoryRequest) =>
    apiPost<{ message: string }>(`/inventory/shopping-list/${id}/to-inventory`, data),

  putAwayGroceries: (defaultAreaId?: string) =>
    apiPost<{ message: string; movedCount: number; skippedCount: number }>(
      '/inventory/shopping-list/put-away',
      { defaultAreaId }
    ),

  // Leftovers
  getLeftovers: () =>
    apiGet<{ leftovers: Leftover[] }>('/inventory/leftovers'),

  getLeftover: (id: string) =>
    apiGet<{ leftover: Leftover }>(`/inventory/leftovers/${id}`),

  createLeftover: (data: CreateLeftoverRequest) =>
    apiPost<{ leftover: Leftover }>('/inventory/leftovers', data),

  updateLeftover: (id: string, data: UpdateLeftoverRequest) =>
    apiPatch<{ leftover: Leftover }>(`/inventory/leftovers/${id}`, data),

  deleteLeftover: (id: string) =>
    apiDelete<{ message: string }>(`/inventory/leftovers/${id}`),

  finishLeftover: (id: string) =>
    apiPost<{ leftover: Leftover }>(`/inventory/leftovers/${id}/finish`),

  getExpiringLeftovers: (days = 3) =>
    apiGet<{ leftovers: Leftover[] }>('/inventory/leftovers/expiring', {
      params: { days }
    }),

  // Confidence & Reconciliation
  getConfidenceMap: () =>
    apiGet<{ confidence: Record<string, { itemId: string; confidence: number; band: 'high' | 'medium' | 'low'; totalQuantity: number; unit: string }> }>('/inventory/confidence'),

  getItemConfidence: (id: string) =>
    apiGet<{ itemId: string; confidence: number; band: 'high' | 'medium' | 'low'; totalQuantity: number; unit: string }>(`/inventory/items/${id}/confidence`),

  reconcileItem: (id: string, data: { quantity: number; unit: string; areaId: string }) =>
    apiPost<{ message: string }>(`/inventory/items/${id}/reconcile`, data),

  depleteItem: (id: string, data: { quantity: number; unit: string }) =>
    apiPost<{ depleted: number; remaining: number }>(`/inventory/items/${id}/deplete`, data),

  markOutOfStock: (id: string, data?: { addToShoppingList?: boolean; quantity?: number; unit?: string }) =>
    apiPost<{ message: string }>(`/inventory/items/${id}/out-of-stock`, data || {}),

  // Linked recipes check
  getLinkedRecipes: (itemId: string) =>
    apiGet<{ linkedRecipes: Array<{ recipeId: string; recipeName: string; ingredientName: string }> }>(`/inventory/items/${itemId}/linked-recipes`),

  // Relink: swap all recipe references from one item to another
  relinkItem: (oldItemId: string, newItemId: string) =>
    apiPost<{ message: string; updatedCount: number }>(`/inventory/items/${oldItemId}/relink`, { newItemId }),
};
