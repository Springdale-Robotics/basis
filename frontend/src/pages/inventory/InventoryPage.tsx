import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Package,
  AlertTriangle,
  RefreshCcw,
  ArrowUpDown,
  Check,
  Trash2,
  Edit,
  X,
  ShoppingCart,
  Settings,
  Soup,
  MapPin,
  List,
  ChevronDown,
  ChevronRight,
  Clock,
  ClipboardCheck,
  MoreVertical,
} from 'lucide-react';
import { useInventoryTier } from '@/hooks/useInventoryTier';
import { ConfidenceBadge, type ConfidenceBand } from '@/components/inventory/ConfidenceBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { EditGate } from '@/components/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/shared/EmptyState';
import { SearchInput } from '@/components/shared/SearchInput';
import { AreaForm } from '@/components/inventory/AreaForm';
import { ItemForm } from '@/components/inventory/ItemForm';
import { BulkAddDialog } from '@/components/inventory/BulkAddDialog';
import { ManageStockDialog } from '@/components/inventory/ManageStockDialog';
import { LeftoverCard } from '@/components/inventory/LeftoverCard';
import { LeftoverForm } from '@/components/inventory/LeftoverForm';
import { FixIncompleteItemDialog } from '@/components/inventory/FixIncompleteItemDialog';
import { ReconcileDialog } from '@/components/inventory/ReconcileDialog';
import { RelinkDialog } from '@/components/inventory/RelinkDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { inventoryApi } from '@/api/inventory';
import { formatDate, cn } from '@/lib/utils';
import { calculateTotalStock, getItemIcon, categoryIcons } from '@/lib/inventory-constants';
import { useCategories } from '@/hooks/useCategories';
import type { StorageAreaFormData, InventoryItemFormData, LeftoverFormData } from '@/types/forms';
import type { InventoryItem, StockEntry, StorageArea, Leftover } from '@/types/models';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type SortOption = 'name-asc' | 'name-desc' | 'category' | 'quantity-asc' | 'quantity-desc' | 'area' | 'expiry';
type DeleteType = 'stock_only' | 'catalog';

interface DeleteDialogState {
  open: boolean;
  items: InventoryItem[];
  isBulk: boolean;
}

/** Simple fuzzy search — matches if all characters of the query appear in order in the target */
function fuzzyMatch(target: string, query: string): boolean {
  const t = target.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  // First try substring match (covers most cases)
  if (t.includes(q)) return true;
  // Then try character-by-character fuzzy (handles typos like "chckn" for "chicken")
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}

function getDaysUntilExpiry(expiryDate: string): number {
  const [year, month, day] = expiryDate.split('T')[0].split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getExpiryBadgeVariant(days: number): 'destructive' | 'secondary' | 'outline' {
  if (days <= 3) return 'destructive';
  return 'secondary';
}

function isItemIncomplete(item: InventoryItem): boolean {
  if (!item.category) return true;
  if (!item.defaultUnit) return true;
  if (!item.defaultAreaId) return true;
  const minStock = item.minStockQuantity ?? item.minStockLevel ?? item.keepInStockThreshold;
  if (item.keepInStock && minStock == null) return true;
  return false;
}

export function InventoryPage() {
  const queryClient = useQueryClient();
  const { isAdvanced } = useInventoryTier();
  const { categories } = useCategories();
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | undefined>();
  const [areaFormOpen, setAreaFormOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<StorageArea | null>(null);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>(isAdvanced ? 'name-asc' : 'expiry');
  const [stockFilter, setStockFilter] = useState<'all' | 'in-stock' | 'not-in-stock'>('all');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    open: false,
    items: [],
    isBulk: false,
  });
  const [bulkEditCategory, setBulkEditCategory] = useState(false);
  const [bulkEditArea, setBulkEditArea] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [bulkAddDialogOpen, setBulkAddDialogOpen] = useState(false);
  const [manageStockItem, setManageStockItem] = useState<InventoryItem | null>(null);
  const [leftoverFormOpen, setLeftoverFormOpen] = useState(false);
  const [editingLeftover, setEditingLeftover] = useState<Leftover | null>(null);
  const [fixIncompleteDialogOpen, setFixIncompleteDialogOpen] = useState(false);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [reconcileItem, setReconcileItem] = useState<InventoryItem | null>(null);
  const [relinkItem, setRelinkItem] = useState<InventoryItem | null>(null);

  // Queries
  const { data: areas, isLoading: areasLoading } = useQuery({
    queryKey: ['inventory', 'areas'],
    queryFn: inventoryApi.getAreas,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['inventory', 'items', selectedCategory],
    queryFn: () =>
      inventoryApi.getItems({
        category: selectedCategory,
      }),
  });

  const { data: stock, isLoading: stockLoading } = useQuery({
    queryKey: ['inventory', 'stock'],
    queryFn: inventoryApi.getStock,
  });

  const { data: keepInStockItems } = useQuery({
    queryKey: ['inventory', 'keep-in-stock'],
    queryFn: inventoryApi.getKeepInStockItems,
  });

  const { data: leftoversData, isLoading: leftoversLoading } = useQuery({
    queryKey: ['inventory', 'leftovers'],
    queryFn: inventoryApi.getLeftovers,
  });

  const { data: expiringLeftoversData } = useQuery({
    queryKey: ['inventory', 'leftovers', 'expiring'],
    queryFn: () => inventoryApi.getExpiringLeftovers(3),
  });

  const { data: expiringItems } = useQuery({
    queryKey: ['inventory', 'expiring'],
    queryFn: () => inventoryApi.getExpiringItems(7),
  });

  const { data: lowStockItems } = useQuery({
    queryKey: ['inventory', 'low-stock'],
    queryFn: inventoryApi.getLowStockItems,
  });

  const { data: confidenceData } = useQuery({
    queryKey: ['inventory', 'confidence'],
    queryFn: inventoryApi.getConfidenceMap,
    enabled: isAdvanced,
  });

  // Lookups
  const itemLookup = useMemo(() => {
    const lookup: Record<string, InventoryItem> = {};
    if (items?.items) {
      for (const item of items.items) {
        lookup[item.id] = item;
      }
    }
    return lookup;
  }, [items]);

  const itemStockTotals = useMemo(() => {
    const totals: Record<string, { quantity: number; unit: string | undefined; allConverted: boolean }> = {};
    if (stock?.stock) {
      const entriesByItem: Record<string, StockEntry[]> = {};
      for (const entry of stock.stock) {
        const itemId = entry.itemId || entry.inventoryItemId;
        if (!itemId) continue;
        if (!entriesByItem[itemId]) entriesByItem[itemId] = [];
        entriesByItem[itemId].push(entry);
      }
      for (const [itemId, entries] of Object.entries(entriesByItem)) {
        const item = itemLookup[itemId];
        const targetUnit = item?.defaultUnit || entries[0]?.unit || 'pieces';
        const density = item?.density ?? null;
        const quantityUnitWeights = item?.quantityUnitWeights || {};
        const result = calculateTotalStock(entries, targetUnit, density, quantityUnitWeights);
        totals[itemId] = { quantity: result.total, unit: targetUnit, allConverted: result.allConverted };
      }
    }
    return totals;
  }, [stock, itemLookup]);

  const itemStockEntries = useMemo(() => {
    const entries: Record<string, StockEntry[]> = {};
    if (stock?.stock) {
      for (const entry of stock.stock) {
        const itemId = entry.itemId || entry.inventoryItemId;
        if (!itemId) continue;
        if (!entries[itemId]) entries[itemId] = [];
        entries[itemId].push(entry);
      }
    }
    return entries;
  }, [stock]);

  const areaLookup = useMemo(() => {
    const lookup: Record<string, StorageArea> = {};
    if (areas?.areas) {
      for (const area of areas.areas) {
        lookup[area.id] = area;
      }
    }
    return lookup;
  }, [areas]);

  // Apply search filter to items
  const filteredItems = useMemo(() => {
    const allItems = items?.items || [];
    if (!search.trim()) return allItems;
    return allItems.filter((item) =>
      fuzzyMatch(item.name, search) ||
      (item.category && fuzzyMatch(item.category, search))
    );
  }, [items, search]);

  // Apply search filter to leftovers
  const filteredLeftovers = useMemo(() => {
    const allLeftovers = leftoversData?.leftovers || [];
    if (!search.trim()) return allLeftovers;
    return allLeftovers.filter((lo) =>
      fuzzyMatch(lo.name, search) ||
      (lo.description && fuzzyMatch(lo.description, search)) ||
      (lo.restaurantName && fuzzyMatch(lo.restaurantName, search))
    );
  }, [leftoversData, search]);

  const incompleteItems = useMemo(
    () => (items?.items || []).filter(isItemIncomplete),
    [items]
  );

  // Group stock entries by area for the "By Location" view
  const filteredItemIds = useMemo(() => new Set(filteredItems.map(i => i.id)), [filteredItems]);

  const stockByArea = useMemo(() => {
    const groups: Record<string, { entry: StockEntry; item: InventoryItem }[]> = {};
    const unassigned: { entry: StockEntry; item: InventoryItem }[] = [];

    if (!stock?.stock || !items?.items) return { groups, unassigned };

    for (const entry of stock.stock) {
      const quantity = parseFloat(String(entry.quantity));
      if (quantity <= 0) continue;
      const itemId = entry.itemId || entry.inventoryItemId;
      const item = itemId ? itemLookup[itemId] : null;
      if (!item || !filteredItemIds.has(item.id)) continue;

      if (entry.areaId) {
        if (!groups[entry.areaId]) groups[entry.areaId] = [];
        groups[entry.areaId].push({ entry, item });
      } else {
        unassigned.push({ entry, item });
      }
    }

    // Sort items within each group by name
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.item.name.localeCompare(b.item.name));
    }
    unassigned.sort((a, b) => a.item.name.localeCompare(b.item.name));

    return { groups, unassigned };
  }, [stock, items, itemLookup, filteredItemIds]);

  // Items not in stock but in catalog, grouped by default area
  const unstockedByArea = useMemo(() => {
    const groups: Record<string, InventoryItem[]> = {};
    const unassigned: InventoryItem[] = [];
    const stockedItemIds = new Set(Object.keys(itemStockTotals).filter(id => itemStockTotals[id].quantity > 0));

    for (const item of filteredItems) {
      if (stockedItemIds.has(item.id)) continue;
      if (item.defaultAreaId) {
        if (!groups[item.defaultAreaId]) groups[item.defaultAreaId] = [];
        groups[item.defaultAreaId].push(item);
      } else {
        unassigned.push(item);
      }
    }

    return { groups, unassigned };
  }, [filteredItems, itemStockTotals]);

  // Filter options
  const categoryFilterOptions: ComboboxOption[] = useMemo(
    () => categories.map((cat) => ({
      value: cat,
      label: cat,
      icon: categoryIcons[cat] ? <span>{categoryIcons[cat]}</span> : undefined,
    })),
    [categories]
  );

  const areaFilterOptions: ComboboxOption[] = useMemo(
    () =>
      (areas?.areas || []).map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

  // Sort function
  const sortItems = useCallback(
    (itemList: InventoryItem[]) => {
      const sorted = [...itemList];
      switch (sortOption) {
        case 'name-asc':
          return sorted.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc':
          return sorted.sort((a, b) => b.name.localeCompare(a.name));
        case 'category':
          return sorted.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
        case 'quantity-asc':
          return sorted.sort((a, b) => {
            const aQty = itemStockTotals[a.id]?.quantity || 0;
            const bQty = itemStockTotals[b.id]?.quantity || 0;
            return aQty - bQty;
          });
        case 'quantity-desc':
          return sorted.sort((a, b) => {
            const aQty = itemStockTotals[a.id]?.quantity || 0;
            const bQty = itemStockTotals[b.id]?.quantity || 0;
            return bQty - aQty;
          });
        case 'area':
          return sorted.sort((a, b) => {
            const aEntries = itemStockEntries[a.id] || [];
            const bEntries = itemStockEntries[b.id] || [];
            const aArea = aEntries[0]?.areaId ? areaLookup[aEntries[0].areaId]?.name || '' : '';
            const bArea = bEntries[0]?.areaId ? areaLookup[bEntries[0].areaId]?.name || '' : '';
            return aArea.localeCompare(bArea);
          });
        case 'expiry':
          return sorted.sort((a, b) => {
            const aEntries = itemStockEntries[a.id] || [];
            const bEntries = itemStockEntries[b.id] || [];
            const aExpiry = aEntries
              .filter(e => e.expiryDate)
              .map(e => new Date(e.expiryDate!).getTime())
              .sort()[0];
            const bExpiry = bEntries
              .filter(e => e.expiryDate)
              .map(e => new Date(e.expiryDate!).getTime())
              .sort()[0];
            if (aExpiry && bExpiry) return aExpiry - bExpiry;
            if (aExpiry && !bExpiry) return -1;
            if (!aExpiry && bExpiry) return 1;
            const aShelf = a.defaultShelfLifeDays ?? Infinity;
            const bShelf = b.defaultShelfLifeDays ?? Infinity;
            if (aShelf !== bShelf) return aShelf - bShelf;
            return a.name.localeCompare(b.name);
          });
        default:
          return sorted;
      }
    },
    [sortOption, itemStockTotals, itemStockEntries, areaLookup]
  );

  const inStockItems = useMemo(() => {
    const itemList = items?.items || [];
    const filtered = itemList.filter((item) => {
      const stockInfo = itemStockTotals[item.id];
      return stockInfo && stockInfo.quantity > 0;
    });
    return sortItems(filtered);
  }, [items, itemStockTotals, sortItems]);

  const catalogItems = useMemo(() => {
    let itemList = filteredItems;
    if (selectedArea) {
      itemList = itemList.filter((item) => item.defaultAreaId === selectedArea);
    }
    if (stockFilter === 'in-stock') {
      itemList = itemList.filter((item) => {
        const stockInfo = itemStockTotals[item.id];
        return stockInfo && stockInfo.quantity > 0;
      });
    } else if (stockFilter === 'not-in-stock') {
      itemList = itemList.filter((item) => {
        const stockInfo = itemStockTotals[item.id];
        return !stockInfo || stockInfo.quantity <= 0;
      });
    }
    return sortItems(itemList);
  }, [filteredItems, sortItems, selectedArea, stockFilter, itemStockTotals]);

  // Mutations
  const createAreaMutation = useMutation({
    mutationFn: (data: StorageAreaFormData) => inventoryApi.createArea(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setAreaFormOpen(false);
    },
  });

  const updateAreaMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: StorageAreaFormData }) =>
      inventoryApi.updateArea(id, { name: data.name, icon: data.icon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setEditingArea(null);
      setAreaFormOpen(false);
    },
  });

  const deleteAreaMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteArea(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setEditingArea(null);
      setAreaFormOpen(false);
    },
  });

  const createItemMutation = useMutation({
    mutationFn: (data: InventoryItemFormData) => {
      const apiData = {
        name: data.name,
        category: data.category || undefined,
        barcode: data.barcode || undefined,
        defaultUnit: data.unit || 'pieces',
        keepInStock: data.keepInStock,
        minStockQuantity: data.keepInStock ? data.keepInStockThreshold : undefined,
        defaultAreaId: data.defaultAreaId || undefined,
        defaultShelfLifeDays: data.defaultShelfLifeDays || undefined,
      };
      return inventoryApi.createItem(apiData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setItemFormOpen(false);
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: InventoryItemFormData }) => {
      const apiData = {
        name: data.name,
        category: data.category || undefined,
        barcode: data.barcode || undefined,
        defaultUnit: data.unit || 'pieces',
        keepInStock: data.keepInStock,
        minStockQuantity: data.keepInStock ? data.keepInStockThreshold : undefined,
        defaultAreaId: data.defaultAreaId || undefined,
        density: data.density,
        defaultShelfLifeDays: data.defaultShelfLifeDays || undefined,
      };
      return inventoryApi.updateItem(id, apiData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      setEditingItem(null);
      setItemFormOpen(false);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: ({ itemIds, deleteType }: { itemIds: string[]; deleteType: DeleteType }) =>
      inventoryApi.batchDeleteItems({ itemIds, deleteType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setSelectedItems(new Set());
      setBulkMode(false);
      setDeleteDialog({ open: false, items: [], isBulk: false });
    },
  });

  const batchUpdateMutation = useMutation({
    mutationFn: ({ itemIds, updates }: { itemIds: string[]; updates: { category?: string; defaultAreaId?: string | null; keepInStock?: boolean } }) =>
      inventoryApi.batchUpdateItems({ itemIds, updates }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setSelectedItems(new Set());
      setBulkMode(false);
      setBulkEditCategory(false);
      setBulkEditArea(false);
    },
  });

  const batchCreateMutation = useMutation({
    mutationFn: (items: Array<{ name: string; category?: string; defaultUnit?: string; defaultAreaId?: string }>) =>
      inventoryApi.batchCreateItems({ items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setBulkAddDialogOpen(false);
    },
  });

  const addToShoppingListMutation = useMutation({
    mutationFn: (itemId: string) => inventoryApi.addToShoppingList({ itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const addStockMutation = useMutation({
    mutationFn: (data: { itemId: string; areaId: string; quantity: number; unit?: string; expiryDate?: string }) =>
      inventoryApi.addStock(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const updateStockMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { quantity?: number; unit?: string; expiryDate?: string; notes?: string } }) =>
      inventoryApi.updateStock(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const deleteStockMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteStock(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });

  const createLeftoverMutation = useMutation({
    mutationFn: (data: LeftoverFormData) =>
      inventoryApi.createLeftover({
        ...data,
        portions: data.portions,
        areaId: data.areaId || undefined,
        sourceRecipeId: data.sourceRecipeId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'leftovers'] });
      setLeftoverFormOpen(false);
    },
  });

  const updateLeftoverMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: LeftoverFormData }) =>
      inventoryApi.updateLeftover(id, {
        ...data,
        portions: data.portions,
        areaId: data.areaId || undefined,
        sourceRecipeId: data.sourceRecipeId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'leftovers'] });
      setEditingLeftover(null);
      setLeftoverFormOpen(false);
    },
  });

  const deleteLeftoverMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteLeftover(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'leftovers'] });
    },
  });

  const finishLeftoverMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.finishLeftover(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'leftovers'] });
    },
  });

  // Handlers
  const handleFixIncompleteItem = async (
    itemId: string,
    updates: {
      category?: string;
      defaultUnit?: string;
      defaultAreaId?: string;
      minStockQuantity?: number;
    }
  ) => {
    await inventoryApi.updateItem(itemId, updates);
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const handleSelectAll = (itemList: InventoryItem[], checked: boolean) => {
    if (checked) {
      setSelectedItems(new Set(itemList.map((item) => item.id)));
    } else {
      setSelectedItems(new Set());
    }
  };

  const handleDeleteItems = (deleteType: DeleteType) => {
    if (deleteDialog.isBulk) {
      batchDeleteMutation.mutate({
        itemIds: deleteDialog.items.map((item) => item.id),
        deleteType,
      });
    } else {
      if (deleteType === 'stock_only') {
        const entries = itemStockEntries[deleteDialog.items[0]?.id] || [];
        Promise.all(entries.map((entry) => inventoryApi.deleteStock(entry.id))).then(() => {
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
          setDeleteDialog({ open: false, items: [], isBulk: false });
        });
      } else {
        deleteItemMutation.mutate(deleteDialog.items[0]?.id, {
          onSuccess: () => {
            setDeleteDialog({ open: false, items: [], isBulk: false });
          },
          onError: (err: any) => {
            // Check if deletion was blocked because item is linked to recipes
            const errorCode = err?.response?.data?.error?.code || err?.data?.error?.code;
            if (errorCode === 'ITEM_LINKED' || err?.message?.includes('linked')) {
              setDeleteDialog({ open: false, items: [], isBulk: false });
              setRelinkItem(deleteDialog.items[0]);
            }
          },
        });
      }
    }
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setItemFormOpen(true);
  };

  const handleItemFormSubmit = async (data: InventoryItemFormData) => {
    if (editingItem) {
      updateItemMutation.mutate({ id: editingItem.id, data });

      // Handle expiry date: create/update a stock entry for this item
      if (data.expiryDate) {
        const existingEntries = itemStockEntries[editingItem.id] || [];
        const areaId = data.defaultAreaId || editingItem.defaultAreaId || areas?.areas?.[0]?.id;
        if (areaId) {
          if (existingEntries.length > 0) {
            // Update the first stock entry's expiry
            inventoryApi.updateStock(existingEntries[0].id, { expiryDate: data.expiryDate }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['inventory'] });
            });
          } else {
            // Create a stock entry to hold the expiry (quantity 1 for Basic mode)
            inventoryApi.addStock({
              itemId: editingItem.id,
              areaId,
              quantity: 1,
              unit: editingItem.defaultUnit || 'pieces',
              expiryDate: data.expiryDate,
            }).then(() => {
              queryClient.invalidateQueries({ queryKey: ['inventory'] });
            });
          }
        }
      }
    } else {
      const result = await createItemMutation.mutateAsync(data);
      if (data.expiryDate && result?.item?.id) {
        const areaId = data.defaultAreaId || areas?.areas?.[0]?.id;
        if (areaId) {
          await inventoryApi.addStock({
            itemId: result.item.id,
            areaId,
            quantity: 1,
            unit: data.unit || 'pieces',
            expiryDate: data.expiryDate,
          });
          queryClient.invalidateQueries({ queryKey: ['inventory'] });
        }
      }
    }
  };

  const handleItemFormClose = (open: boolean) => {
    if (!open) setEditingItem(null);
    setItemFormOpen(open);
  };

  const handleDeleteClick = (item: InventoryItem) => {
    setDeleteDialog({ open: true, items: [item], isBulk: false });
  };

  const handleBulkDelete = () => {
    const itemsToDelete = (items?.items || []).filter((item) => selectedItems.has(item.id));
    setDeleteDialog({ open: true, items: itemsToDelete, isBulk: true });
  };

  const exitBulkMode = () => {
    setBulkMode(false);
    setSelectedItems(new Set());
  };

  const toggleAreaCollapse = (areaId: string) => {
    setCollapsedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  };

  const isLoading = areasLoading || itemsLoading || stockLoading;

  // Alert counts
  const expiringCount = (expiringItems?.expiring?.length || 0) + (expiringLeftoversData?.leftovers?.length || 0);
  const lowStockCount = isAdvanced ? (lowStockItems?.lowStock?.length || 0) : 0;
  const totalAlerts = expiringCount + lowStockCount;

  // Render helpers
  const renderItemRow = (item: InventoryItem, entry?: StockEntry, area?: StorageArea | null) => {
    const stockInfo = itemStockTotals[item.id];
    const hasStock = stockInfo && stockInfo.quantity > 0;
    const quantity = entry ? parseFloat(String(entry.quantity)) : stockInfo?.quantity;
    const unit = entry?.unit || stockInfo?.unit || item.defaultUnit || 'units';
    const confidence = confidenceData?.confidence?.[item.id];

    // In Basic mode, find earliest expiry from this item's stock entries
    const itemEntries = itemStockEntries[item.id] || [];
    const earliestExpiry = !entry ? itemEntries
      .filter(e => e.expiryDate)
      .sort((a, b) => new Date(a.expiryDate!).getTime() - new Date(b.expiryDate!).getTime())[0]?.expiryDate
      : undefined;
    const displayExpiry = entry?.expiryDate || earliestExpiry;

    return (
      <div
        key={entry?.id || item.id}
        className={cn(
          'flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer border-b last:border-b-0',
          !hasStock && !entry && 'text-muted-foreground'
        )}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('[role="menu"]') || target.closest('[data-radix-popper-content-wrapper]')) return;
          handleEditItem(item);
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {bulkMode && (
            <Checkbox
              checked={selectedItems.has(item.id)}
              onCheckedChange={(checked) => handleSelectItem(item.id, !!checked)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {isAdvanced && confidence && (
            <ConfidenceBadge band={confidence.band as ConfidenceBand} score={confidence.confidence} />
          )}
          <span className="text-base shrink-0">{getItemIcon(item)}</span>
          <div className="min-w-0">
            <p className="font-medium truncate">
              {item.name}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {item.category && <span>{item.category}</span>}
              {displayExpiry && (
                <>
                  {item.category && <span>·</span>}
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    Expires {formatDate(displayExpiry)}
                  </span>
                </>
              )}
              {!displayExpiry && item.defaultShelfLifeDays && (
                <>
                  {item.category && <span>·</span>}
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {item.defaultShelfLifeDays}d shelf life
                  </span>
                </>
              )}
              {!hasStock && !entry && (
                <>
                  {(item.category || displayExpiry || item.defaultShelfLifeDays) && <span>·</span>}
                  <span className="italic">Not in stock</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdvanced && (
            <>
              {quantity != null && quantity > 0 ? (
                <Badge
                  variant="secondary"
                  className="font-mono cursor-pointer hover:bg-secondary/80 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setManageStockItem(item);
                  }}
                >
                  {quantity.toFixed(1)} {unit}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setManageStockItem(item);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add stock
                </Badge>
              )}
            </>
          )}
          {isAdvanced && item.keepInStock && (
            <Badge variant="outline" className="text-xs hidden sm:flex">
              <RefreshCcw className="mr-1 h-3 w-3" />
              Auto
            </Badge>
          )}
          {!bulkMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-foreground">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isAdvanced && (
                  <DropdownMenuItem onClick={() => setManageStockItem(item)}>
                    <Package className="mr-2 h-4 w-4" />
                    Manage Stock
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handleEditItem(item)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Item
                </DropdownMenuItem>
                {isAdvanced && (
                  <DropdownMenuItem onClick={() => setReconcileItem(item)}>
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Verify Stock
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => addToShoppingListMutation.mutate(item.id)}
                  disabled={addToShoppingListMutation.isPending}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Add to Shopping List
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDeleteClick(item)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    );
  };

  const renderAreaCard = (area: StorageArea) => {
    const stockedItems = stockByArea.groups[area.id] || [];
    const itemCount = stockedItems.length;
    const isCollapsed = collapsedAreas.has(area.id);

    return (
      <Card key={area.id} className="overflow-hidden">
        <CardHeader
          className="cursor-pointer hover:bg-muted/30 transition-colors py-3 px-4"
          onClick={() => toggleAreaCollapse(area.id)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-lg">{area.icon || '📦'}</span>
              <CardTitle className="text-base">{area.name}</CardTitle>
              <Badge variant="secondary" className="text-xs">
                {itemCount} item{itemCount !== 1 ? 's' : ''}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                setEditingArea(area);
                setAreaFormOpen(true);
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        {!isCollapsed && (
          <CardContent className="p-0">
            {itemCount === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No items in this area
              </div>
            ) : (
              <>
                {stockedItems.map(({ entry, item }) => renderItemRow(item, entry, area))}
              </>
            )}
          </CardContent>
        )}
      </Card>
    );
  };

  const renderBulkToolbar = (currentItems: InventoryItem[]) => {
    if (!bulkMode) return null;

    const allSelected = currentItems.length > 0 && currentItems.every((item) => selectedItems.has(item.id));
    const someSelected = selectedItems.size > 0;

    return (
      <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/50 p-3">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => handleSelectAll(currentItems, !!checked)}
          />
          <span className="text-sm">
            {selectedItems.size > 0 ? `${selectedItems.size} selected` : 'Select all'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {someSelected && (
            <>
              <DropdownMenu open={bulkEditCategory} onOpenChange={setBulkEditCategory}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Edit className="mr-2 h-4 w-4" />
                    Category
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Select Category</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {categories.map((cat) => (
                    <DropdownMenuItem
                      key={cat}
                      onClick={() => {
                        batchUpdateMutation.mutate({
                          itemIds: Array.from(selectedItems),
                          updates: { category: cat },
                        });
                      }}
                    >
                      {categoryIcons[cat] && <span className="mr-1">{categoryIcons[cat]}</span>}
                      {cat}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu open={bulkEditArea} onOpenChange={setBulkEditArea}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Package className="mr-2 h-4 w-4" />
                    Area
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Select Storage Area</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      batchUpdateMutation.mutate({
                        itemIds: Array.from(selectedItems),
                        updates: { defaultAreaId: null },
                      });
                    }}
                  >
                    No Default Area
                  </DropdownMenuItem>
                  {areas?.areas?.map((area) => (
                    <DropdownMenuItem
                      key={area.id}
                      onClick={() => {
                        batchUpdateMutation.mutate({
                          itemIds: Array.from(selectedItems),
                          updates: { defaultAreaId: area.id },
                        });
                      }}
                    >
                      {area.icon} {area.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {isAdvanced && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Keep in Stock
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() => {
                        batchUpdateMutation.mutate({
                          itemIds: Array.from(selectedItems),
                          updates: { keepInStock: true },
                        });
                      }}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Enable
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        batchUpdateMutation.mutate({
                          itemIds: Array.from(selectedItems),
                          updates: { keepInStock: false },
                        });
                      }}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Disable
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete ({selectedItems.size})
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={exitBulkMode}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  const renderSortAndFilter = () => (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
          <SelectTrigger className="w-[180px]">
            <ArrowUpDown className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expiry">Expiring Soon</SelectItem>
            <SelectItem value="name-asc">Name (A-Z)</SelectItem>
            <SelectItem value="name-desc">Name (Z-A)</SelectItem>
            <SelectItem value="category">Category</SelectItem>
            {isAdvanced && (
              <>
                <SelectItem value="quantity-desc">Quantity (High-Low)</SelectItem>
                <SelectItem value="quantity-asc">Quantity (Low-High)</SelectItem>
              </>
            )}
            <SelectItem value="area">Storage Area</SelectItem>
          </SelectContent>
        </Select>
        <div className="w-[180px]">
          <Combobox
            options={areaFilterOptions}
            value={selectedArea || ''}
            onValueChange={(value) => setSelectedArea(value || undefined)}
            placeholder="All Areas"
            searchPlaceholder="Search areas..."
            emptyText="No area found."
            allowClear
            clearLabel="All Areas"
          />
        </div>
        <div className="w-[180px]">
          <Combobox
            options={categoryFilterOptions}
            value={selectedCategory || ''}
            onValueChange={(value) => setSelectedCategory(value || undefined)}
            placeholder="All Categories"
            searchPlaceholder="Search categories..."
            emptyText="No category found."
            allowClear
            clearLabel="All Categories"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {(['all', 'in-stock', 'not-in-stock'] as const).map((filter) => (
          <Button
            key={filter}
            variant={stockFilter === filter ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStockFilter(filter)}
          >
            {filter === 'all' ? 'All' : filter === 'in-stock' ? 'In Stock' : 'Not in Stock'}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {!bulkMode && (
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkMode(true)}>
              <Check className="mr-2 h-4 w-4" />
              Select Multiple
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkAddDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Bulk Add
            </Button>
          </>
        )}
      </div>
    </div>
  );

  // Render alerts section
  const renderAlerts = () => {
    if (totalAlerts === 0 && incompleteItems.length === 0) return null;

    return (
      <div className="mb-6 space-y-3">
        {/* Expiring + Low stock in a compact row */}
        {totalAlerts > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {expiringCount > 0 && (
              <Card className="border-warning/30 bg-warning-muted">
                <CardContent className="flex items-center gap-3 p-3">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-warning-muted-foreground">
                      {expiringCount} item{expiringCount !== 1 ? 's' : ''} expiring soon
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {expiringItems?.expiring?.slice(0, 3).map((se) => {
                        const days = se.expiryDate ? getDaysUntilExpiry(se.expiryDate) : null;
                        return (
                          <Badge
                            key={se.id}
                            variant={days !== null ? getExpiryBadgeVariant(days) : 'secondary'}
                            className="text-xs cursor-pointer hover:opacity-80"
                            onClick={() => { if (se.item) handleEditItem(se.item as InventoryItem); }}
                          >
                            {se.item?.name || 'Unknown'}
                            {days !== null && ` (${days <= 0 ? 'expired' : `${days}d`})`}
                          </Badge>
                        );
                      })}
                      {expiringLeftoversData?.leftovers?.slice(0, 2).map((lo) => (
                        <Badge
                          key={lo.id}
                          variant="destructive"
                          className="text-xs cursor-pointer hover:opacity-80"
                          onClick={() => {
                            setEditingLeftover(lo);
                            setLeftoverFormOpen(true);
                          }}
                        >
                          {lo.name} (leftover)
                        </Badge>
                      ))}
                      {expiringCount > 5 && (
                        <Badge variant="outline" className="text-xs">+{expiringCount - 5} more</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            {lowStockCount > 0 && (
              <Card className="border-info/30 bg-info-muted">
                <CardContent className="flex items-center gap-3 p-3">
                  <RefreshCcw className="h-5 w-5 text-info shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-info-muted-foreground">
                      {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} running low
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {lowStockItems?.lowStock?.slice(0, 4).map((entry) => (
                        <Badge
                          key={entry.item.id}
                          variant="outline"
                          className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground"
                          onClick={() => addToShoppingListMutation.mutate(entry.item.id)}
                        >
                          <ShoppingCart className="h-3 w-3 mr-1" />
                          {entry.item.name}
                        </Badge>
                      ))}
                      {lowStockCount > 4 && (
                        <Badge variant="outline" className="text-xs">+{lowStockCount - 4} more</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Incomplete items */}
        {incompleteItems.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>
                {incompleteItems.length} item{incompleteItems.length !== 1 ? 's' : ''} need attention (missing category, unit, or storage area)
              </span>
              <Button size="sm" onClick={() => setFixIncompleteDialogOpen(true)}>
                Fix Items
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Manage your household inventory"
        actions={
          <EditGate feature="inventory">
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Settings className="mr-2 h-4 w-4" />
                    Areas
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingArea(null);
                      setAreaFormOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add New Area
                  </DropdownMenuItem>
                  {areas?.areas && areas.areas.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Manage Areas</DropdownMenuLabel>
                      {areas.areas.map((area) => (
                        <DropdownMenuItem
                          key={area.id}
                          onClick={() => {
                            setEditingArea(area);
                            setAreaFormOpen(true);
                          }}
                          className="flex items-center justify-between"
                        >
                          <span className="flex items-center">
                            <span className="mr-2">{area.icon || '📦'}</span>
                            {area.name}
                          </span>
                          <Edit className="h-3.5 w-3.5 text-muted-foreground ml-4" />
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={() => setItemFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </div>
          </EditGate>
        }
      />

      {renderAlerts()}

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search items and leftovers..."
          className="max-w-md"
        />
      </div>

      <Tabs defaultValue="by-location">
        <TabsList className="mb-4">
          <TabsTrigger value="by-location">
            <MapPin className="mr-1.5 h-4 w-4" />
            By Location
          </TabsTrigger>
          <TabsTrigger value="all-items">
            <List className="mr-1.5 h-4 w-4" />
            All Items
            {(items?.items?.length || 0) > 0 && (
              <Badge className="ml-2" variant="outline">
                {items?.items?.length || 0}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="leftovers">
            <Soup className="mr-1.5 h-4 w-4" />
            Leftovers
            {leftoversData?.leftovers && leftoversData.leftovers.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {leftoversData.leftovers.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* By Location View */}
        <TabsContent value="by-location">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : (areas?.areas?.length || 0) === 0 ? (
            <EmptyState
              icon={<MapPin className="h-12 w-12" />}
              title="No storage areas yet"
              description="Create storage areas like Fridge, Pantry, or Freezer to organize your inventory by location"
              action={
                <Button onClick={() => { setEditingArea(null); setAreaFormOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Area
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {areas?.areas?.map((area) => renderAreaCard(area))}

              {/* Unassigned items */}
              {stockByArea.unassigned.length > 0 && (
                <Card className="overflow-hidden border-dashed">
                  <CardHeader
                    className="cursor-pointer hover:bg-muted/30 transition-colors py-3 px-4"
                    onClick={() => toggleAreaCollapse('__unassigned')}
                  >
                    <div className="flex items-center gap-2">
                      {collapsedAreas.has('__unassigned') ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-lg">📋</span>
                      <CardTitle className="text-base text-muted-foreground">Unassigned</CardTitle>
                      <Badge variant="outline" className="text-xs">
                        {stockByArea.unassigned.length}
                      </Badge>
                    </div>
                  </CardHeader>
                  {!collapsedAreas.has('__unassigned') && (
                    <CardContent className="p-0">
                      {stockByArea.unassigned.map(({ entry, item }) => renderItemRow(item, entry))}
                    </CardContent>
                  )}
                </Card>
              )}

              {/* Search returned no results */}
              {search.trim() && filteredItems.length === 0 && (items?.items?.length || 0) > 0 && (
                <EmptyState
                  title="No matching items"
                  description={`No items match "${search}"`}
                />
              )}

              {/* No items at all */}
              {!search.trim() && (items?.items?.length || 0) === 0 && (
                <EmptyState
                  icon={<Package className="h-12 w-12" />}
                  title="No items yet"
                  description="Add items to your inventory to see them organized by location"
                  action={
                    <Button onClick={() => setItemFormOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Item
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </TabsContent>

        {/* All Items View */}
        <TabsContent value="all-items">
          {renderSortAndFilter()}
          {renderBulkToolbar(catalogItems)}

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : !catalogItems.length ? (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title="No items in catalog"
              description="Add items to your catalog to track inventory"
              action={
                <Button onClick={() => setItemFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {catalogItems.map((item) => renderItemRow(item))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Leftovers View */}
        <TabsContent value="leftovers">
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setLeftoverFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Leftover
            </Button>
          </div>

          {leftoversLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : !leftoversData?.leftovers?.length ? (
            <EmptyState
              icon={<Soup className="h-12 w-12" />}
              title="No leftovers to track"
              description="Add leftovers from recipes, restaurants, or homemade dishes to track their freshness"
              action={
                <Button onClick={() => setLeftoverFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Leftover
                </Button>
              }
            />
          ) : filteredLeftovers.length === 0 ? (
            <EmptyState
              title="No matching leftovers"
              description={`No leftovers match "${search}"`}
            />
          ) : (
            <div className="space-y-2">
              {filteredLeftovers.map((leftover) => (
                <LeftoverCard
                  key={leftover.id}
                  leftover={leftover}
                  onFinish={() => finishLeftoverMutation.mutate(leftover.id)}
                  onUsePortion={() => {
                    const current = typeof leftover.portions === 'string' ? parseFloat(leftover.portions) : leftover.portions;
                    if (current <= 1) {
                      finishLeftoverMutation.mutate(leftover.id);
                    } else {
                      inventoryApi.updateLeftover(leftover.id, { portions: current - 1 }).then(() => {
                        queryClient.invalidateQueries({ queryKey: ['inventory', 'leftovers'] });
                      });
                    }
                  }}
                  onEdit={() => {
                    setEditingLeftover(leftover);
                    setLeftoverFormOpen(true);
                  }}
                  onDelete={() => deleteLeftoverMutation.mutate(leftover.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AreaForm
        open={areaFormOpen}
        onOpenChange={(open) => {
          setAreaFormOpen(open);
          if (!open) setEditingArea(null);
        }}
        area={editingArea}
        onSubmit={(data) => {
          if (editingArea) {
            updateAreaMutation.mutate({ id: editingArea.id, data });
          } else {
            createAreaMutation.mutate(data);
          }
        }}
        onDelete={editingArea ? () => deleteAreaMutation.mutate(editingArea.id) : undefined}
        isSubmitting={createAreaMutation.isPending || updateAreaMutation.isPending || deleteAreaMutation.isPending}
      />

      <ItemForm
        open={itemFormOpen}
        onOpenChange={handleItemFormClose}
        item={editingItem}
        areas={areas?.areas || []}
        currentExpiryDate={
          editingItem
            ? (itemStockEntries[editingItem.id] || [])
                .filter(e => e.expiryDate)
                .sort((a, b) => new Date(a.expiryDate!).getTime() - new Date(b.expiryDate!).getTime())[0]?.expiryDate || null
            : null
        }
        onSubmit={handleItemFormSubmit}
        onDelete={editingItem ? () => handleDeleteClick(editingItem) : undefined}
        isSubmitting={createItemMutation.isPending || updateItemMutation.isPending}
      />

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteDialog.isBulk
                ? `Delete ${deleteDialog.items.length} items?`
                : `Delete "${deleteDialog.items[0]?.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isAdvanced
                ? `Choose how you want to remove ${deleteDialog.isBulk ? 'these items' : 'this item'}:`
                : `This will permanently remove ${deleteDialog.isBulk ? 'these items' : 'this item'}. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isAdvanced ? (
            <div className="grid gap-4 py-4">
              <Card
                className="cursor-pointer border-2 hover:border-primary transition-colors"
                onClick={() => handleDeleteItems('stock_only')}
              >
                <CardContent className="p-4">
                  <p className="font-medium">Remove from stock only</p>
                  <p className="text-sm text-muted-foreground">
                    Keep {deleteDialog.isBulk ? 'items' : 'item'} in the catalog but set quantity to zero.
                  </p>
                </CardContent>
              </Card>
              <Card
                className="cursor-pointer border-2 hover:border-destructive transition-colors"
                onClick={() => handleDeleteItems('catalog')}
              >
                <CardContent className="p-4">
                  <p className="font-medium text-destructive">Remove from catalog completely</p>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete {deleteDialog.isBulk ? 'items' : 'item'} and all stock entries. Cannot be undone.
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={() => handleDeleteItems('catalog')}>
                Delete
              </Button>
            </AlertDialogFooter>
          )}
          {isAdvanced && (
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <BulkAddDialog
        open={bulkAddDialogOpen}
        onOpenChange={setBulkAddDialogOpen}
        areas={areas?.areas || []}
        onSubmit={(items) => batchCreateMutation.mutate(items)}
        isSubmitting={batchCreateMutation.isPending}
      />

      <ManageStockDialog
        open={!!manageStockItem}
        onOpenChange={(open) => !open && setManageStockItem(null)}
        item={manageStockItem}
        areas={areas?.areas || []}
        stockEntries={stock?.stock || []}
        onAddStock={(data) => addStockMutation.mutate(data)}
        onUpdateStock={(id, data) => updateStockMutation.mutate({ id, data })}
        onDeleteStock={(id) => deleteStockMutation.mutate(id)}
        isSubmitting={addStockMutation.isPending || updateStockMutation.isPending || deleteStockMutation.isPending}
      />

      <LeftoverForm
        open={leftoverFormOpen}
        onOpenChange={(open) => {
          setLeftoverFormOpen(open);
          if (!open) setEditingLeftover(null);
        }}
        leftover={editingLeftover}
        areas={areas?.areas || []}
        onSubmit={(data) => {
          if (editingLeftover) {
            updateLeftoverMutation.mutate({ id: editingLeftover.id, data });
          } else {
            createLeftoverMutation.mutate(data);
          }
        }}
        onDelete={editingLeftover ? () => deleteLeftoverMutation.mutate(editingLeftover.id) : undefined}
        isSubmitting={createLeftoverMutation.isPending || updateLeftoverMutation.isPending}
      />

      <FixIncompleteItemDialog
        open={fixIncompleteDialogOpen}
        onOpenChange={setFixIncompleteDialogOpen}
        incompleteItems={incompleteItems}
        areas={areas?.areas || []}
        onSave={handleFixIncompleteItem}
      />

      {isAdvanced && (
        <ReconcileDialog
          open={!!reconcileItem}
          onOpenChange={(open) => !open && setReconcileItem(null)}
          item={reconcileItem}
          areas={areas?.areas || []}
          currentConfidence={
            reconcileItem && confidenceData?.confidence?.[reconcileItem.id]
              ? {
                  ...confidenceData.confidence[reconcileItem.id],
                  band: confidenceData.confidence[reconcileItem.id].band as 'high' | 'medium' | 'low',
                }
              : null
          }
        />
      )}

      <RelinkDialog
        open={!!relinkItem}
        onOpenChange={(open) => !open && setRelinkItem(null)}
        item={relinkItem}
        onRelinked={() => {
          // After relinking, try deleting again
          if (relinkItem) {
            deleteItemMutation.mutate(relinkItem.id, {
              onSuccess: () => {
                setRelinkItem(null);
              },
            });
          }
        }}
      />
    </div>
  );
}
