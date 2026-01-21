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
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { inventoryApi } from '@/api/inventory';
import { formatDate, cn } from '@/lib/utils';
import { categoryOptions } from '@/lib/inventory-constants';
import type { StorageAreaFormData, InventoryItemFormData } from '@/types/forms';
import type { InventoryItem, StockEntry, StorageArea } from '@/types/models';
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

type SortOption = 'name-asc' | 'name-desc' | 'category' | 'quantity-asc' | 'quantity-desc' | 'area';
type DeleteType = 'stock_only' | 'catalog';

interface DeleteDialogState {
  open: boolean;
  items: InventoryItem[];
  isBulk: boolean;
}

function getDaysUntilExpiry(expiryDate: string): number {
  // Parse as local date to avoid timezone issues
  const [year, month, day] = expiryDate.split('T')[0].split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getExpiryBadgeVariant(days: number): 'destructive' | 'secondary' | 'outline' {
  if (days <= 0) return 'destructive';
  if (days <= 3) return 'destructive';
  return 'secondary';
}

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | undefined>();
  const [areaFormOpen, setAreaFormOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<StorageArea | null>(null);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
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

  const { data: areas, isLoading: areasLoading } = useQuery({
    queryKey: ['inventory', 'areas'],
    queryFn: inventoryApi.getAreas,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['inventory', 'items', search, selectedArea, selectedCategory],
    queryFn: () =>
      inventoryApi.getItems({
        search: search || undefined,
        areaId: selectedArea,
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

  // Calculate stock totals per item
  const itemStockTotals = useMemo(() => {
    const totals: Record<string, { quantity: number; unit: string | undefined; areaId?: string }> = {};
    if (stock?.stock) {
      for (const entry of stock.stock) {
        const itemId = entry.itemId || entry.inventoryItemId;
        if (!itemId) continue;
        if (!totals[itemId]) {
          totals[itemId] = { quantity: 0, unit: entry.unit || entry.item?.defaultUnit, areaId: entry.areaId };
        }
        totals[itemId].quantity += parseFloat(String(entry.quantity));
      }
    }
    return totals;
  }, [stock]);

  // Get items stock entries per item for area lookup
  const itemStockEntries = useMemo(() => {
    const entries: Record<string, StockEntry[]> = {};
    if (stock?.stock) {
      for (const entry of stock.stock) {
        const itemId = entry.itemId || entry.inventoryItemId;
        if (!itemId) continue;
        if (!entries[itemId]) {
          entries[itemId] = [];
        }
        entries[itemId].push(entry);
      }
    }
    return entries;
  }, [stock]);

  // Get area name lookup
  const areaLookup = useMemo(() => {
    const lookup: Record<string, StorageArea> = {};
    if (areas?.areas) {
      for (const area of areas.areas) {
        lookup[area.id] = area;
      }
    }
    return lookup;
  }, [areas]);

  // Combobox options for filters
  const categoryFilterOptions: ComboboxOption[] = useMemo(
    () => categoryOptions.map((cat) => ({ value: cat, label: cat })),
    []
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
        default:
          return sorted;
      }
    },
    [sortOption, itemStockTotals, itemStockEntries, areaLookup]
  );

  // Get items currently in stock (sorted) - used for bulk operations
  const inStockItems = useMemo(() => {
    const itemList = items?.items || [];
    const filtered = itemList.filter((item) => {
      const stockInfo = itemStockTotals[item.id];
      return stockInfo && stockInfo.quantity > 0;
    });
    return sortItems(filtered);
  }, [items, itemStockTotals, sortItems]);

  // Get stock entries with item info for the "In Stock" tab (shows each location separately)
  const inStockEntries = useMemo(() => {
    if (!stock?.stock || !items?.items) return [];

    // Create a lookup for items
    const itemLookup: Record<string, InventoryItem> = {};
    for (const item of items.items) {
      itemLookup[item.id] = item;
    }

    // Map stock entries to include item info
    const entries = stock.stock
      .filter((entry) => {
        const quantity = parseFloat(String(entry.quantity));
        return quantity > 0;
      })
      .map((entry) => {
        const itemId = entry.itemId || entry.inventoryItemId;
        const item = itemId ? itemLookup[itemId] : null;
        const area = entry.areaId ? areaLookup[entry.areaId] : null;
        return { entry, item, area };
      })
      .filter((e): e is { entry: StockEntry; item: InventoryItem; area: StorageArea | null } => e.item != null);

    // Sort based on current sort option
    switch (sortOption) {
      case 'name-asc':
        return entries.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''));
      case 'name-desc':
        return entries.sort((a, b) => (b.item?.name || '').localeCompare(a.item?.name || ''));
      case 'category':
        return entries.sort((a, b) => (a.item?.category || '').localeCompare(b.item?.category || ''));
      case 'quantity-asc':
        return entries.sort((a, b) => parseFloat(String(a.entry.quantity)) - parseFloat(String(b.entry.quantity)));
      case 'quantity-desc':
        return entries.sort((a, b) => parseFloat(String(b.entry.quantity)) - parseFloat(String(a.entry.quantity)));
      case 'area':
        return entries.sort((a, b) => (a.area?.name || '').localeCompare(b.area?.name || ''));
      default:
        return entries;
    }
  }, [stock, items, areaLookup, sortOption]);

  // Get all catalog items (sorted)
  const catalogItems = useMemo(() => {
    const itemList = items?.items || [];
    return sortItems(itemList);
  }, [items, sortItems]);

  const { data: expiringItems } = useQuery({
    queryKey: ['inventory', 'expiring'],
    queryFn: () => inventoryApi.getExpiringItems(7),
  });

  const { data: lowStockItems } = useQuery({
    queryKey: ['inventory', 'low-stock'],
    queryFn: inventoryApi.getLowStockItems,
  });

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
      };
      return inventoryApi.updateItem(id, apiData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
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

  const handleSelectItem = (itemId: string, checked: boolean) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
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
        // Delete all stock entries for this item
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
        });
      }
    }
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setItemFormOpen(true);
  };

  const handleItemFormSubmit = (data: InventoryItemFormData) => {
    if (editingItem) {
      updateItemMutation.mutate({ id: editingItem.id, data });
    } else {
      createItemMutation.mutate(data);
    }
  };

  const handleItemFormClose = (open: boolean) => {
    if (!open) {
      setEditingItem(null);
    }
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

  const isLoading = areasLoading || itemsLoading || stockLoading;

  // Get primary storage area for an item
  const getItemPrimaryArea = (item: InventoryItem) => {
    const entries = itemStockEntries[item.id] || [];
    if (entries.length > 0 && entries[0].areaId) {
      return areaLookup[entries[0].areaId];
    }
    if (item.defaultAreaId) {
      return areaLookup[item.defaultAreaId];
    }
    return null;
  };

  const renderItemCard = (item: InventoryItem, showQuantity: boolean = true) => {
    const stockInfo = itemStockTotals[item.id];
    const hasStock = stockInfo && stockInfo.quantity > 0;
    const entries = itemStockEntries[item.id] || [];

    // Get unique areas where this item is stored
    const uniqueAreaIds = [...new Set(entries.map((e) => e.areaId).filter(Boolean))];
    const stockAreas = uniqueAreaIds.map((id) => areaLookup[id]).filter(Boolean);
    const primaryArea = stockAreas[0] || (item.defaultAreaId ? areaLookup[item.defaultAreaId] : null);
    const additionalAreasCount = stockAreas.length > 1 ? stockAreas.length - 1 : 0;

    return (
      <Card
        key={item.id}
        className={cn(
          'cursor-pointer hover:bg-muted/50 transition-colors',
          !hasStock && 'border-dashed'
        )}
        onClick={() => !bulkMode && handleEditItem(item)}
      >
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            {bulkMode && (
              <Checkbox
                checked={selectedItems.has(item.id)}
                onCheckedChange={(checked) => handleSelectItem(item.id, !!checked)}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <div>
              <p className={cn('font-medium', !hasStock && 'text-muted-foreground')}>
                {item.name}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {item.category && <span>{item.category}</span>}
                {primaryArea && (
                  <>
                    {item.category && <span>•</span>}
                    <span className="flex items-center gap-1">
                      {primaryArea.icon} {primaryArea.name}
                      {additionalAreasCount > 0 && (
                        <span className="text-primary font-medium">
                          +{additionalAreasCount} more
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showQuantity && (
              <>
                {hasStock ? (
                  <Badge
                    variant="secondary"
                    className="font-mono cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setManageStockItem(item);
                    }}
                    title="Click to adjust stock"
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    {stockInfo.quantity.toFixed(1)} {stockInfo.unit || item.defaultUnit || 'units'}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setManageStockItem(item);
                    }}
                    title="Click to add stock"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add stock
                  </Badge>
                )}
              </>
            )}
            {item.keepInStock && (
              <Badge variant="outline" className="text-xs">
                <RefreshCcw className="mr-1 h-3 w-3" />
                Keep stocked
              </Badge>
            )}
            {!bulkMode && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Edit className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setManageStockItem(item)}>
                    <Package className="mr-2 h-4 w-4" />
                    Manage Stock
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditItem(item)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Item
                  </DropdownMenuItem>
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
        </CardContent>
      </Card>
    );
  };

  // Render a stock entry card (for the "In Stock" tab showing each location)
  const renderStockEntryCard = (
    entry: StockEntry,
    item: InventoryItem,
    area: StorageArea | null
  ) => {
    const quantity = parseFloat(String(entry.quantity));

    return (
      <Card
        key={entry.id}
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setManageStockItem(item)}
      >
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            {bulkMode && (
              <Checkbox
                checked={selectedItems.has(item.id)}
                onCheckedChange={(checked) => handleSelectItem(item.id, !!checked)}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <div>
              <p className="font-medium">{item.name}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {area && (
                  <span className="flex items-center gap-1">
                    {area.icon} {area.name}
                  </span>
                )}
                {item.category && (
                  <>
                    {area && <span>•</span>}
                    <span>{item.category}</span>
                  </>
                )}
                {entry.expiryDate && (
                  <>
                    <span>•</span>
                    <span>Expires {formatDate(entry.expiryDate)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="font-mono cursor-pointer hover:bg-secondary/80 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setManageStockItem(item);
              }}
              title="Click to adjust stock"
            >
              <Edit className="h-3 w-3 mr-1" />
              {quantity.toFixed(1)} {entry.unit || item.defaultUnit || 'units'}
            </Badge>
            {item.keepInStock && (
              <Badge variant="outline" className="text-xs">
                <RefreshCcw className="mr-1 h-3 w-3" />
                Keep stocked
              </Badge>
            )}
            {!bulkMode && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Edit className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setManageStockItem(item)}>
                    <Package className="mr-2 h-4 w-4" />
                    Manage Stock
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditItem(item)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Item
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => addToShoppingListMutation.mutate(item.id)}
                    disabled={addToShoppingListMutation.isPending}
                  >
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Add to Shopping List
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => deleteStockMutation.mutate(entry.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove from {area?.name || 'location'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardContent>
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
                    Change Category
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Select Category</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {categoryOptions.map((cat) => (
                    <DropdownMenuItem
                      key={cat}
                      onClick={() => {
                        batchUpdateMutation.mutate({
                          itemIds: Array.from(selectedItems),
                          updates: { category: cat },
                        });
                      }}
                    >
                      {cat}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu open={bulkEditArea} onOpenChange={setBulkEditArea}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Package className="mr-2 h-4 w-4" />
                    Change Area
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
                    Enable Keep in Stock
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
                    Disable Keep in Stock
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search items..."
          className="max-w-sm"
        />
        <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
          <SelectTrigger className="w-[180px]">
            <ArrowUpDown className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name-asc">Name (A-Z)</SelectItem>
            <SelectItem value="name-desc">Name (Z-A)</SelectItem>
            <SelectItem value="category">Category</SelectItem>
            <SelectItem value="quantity-desc">Quantity (High-Low)</SelectItem>
            <SelectItem value="quantity-asc">Quantity (Low-High)</SelectItem>
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

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Manage your household inventory"
        actions={
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
                    <DropdownMenuLabel>Edit Area</DropdownMenuLabel>
                    {areas.areas.map((area) => (
                      <DropdownMenuItem
                        key={area.id}
                        onClick={() => {
                          setEditingArea(area);
                          setAreaFormOpen(true);
                        }}
                      >
                        <span className="mr-2">{area.icon || '📦'}</span>
                        {area.name}
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
        }
      />

      {/* Alerts */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {expiringItems?.expiring && expiringItems.expiring.length > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {expiringItems.expiring.length} items expiring soon
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Check your inventory
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {lowStockItems?.lowStock && lowStockItems.lowStock.length > 0 && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
            <CardContent className="flex items-center gap-3 p-4">
              <RefreshCcw className="h-5 w-5 text-blue-600" />
              <div>
                <p className="font-medium text-blue-900 dark:text-blue-100">
                  {lowStockItems.lowStock.length} items running low
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Consider adding to shopping list
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="all">
        <TabsList className="mb-4">
          <TabsTrigger value="all">
            In Stock
            {inStockEntries.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {inStockEntries.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="catalog">
            Catalog
            {(items?.items?.length || 0) > 0 && (
              <Badge className="ml-2" variant="outline">
                {items?.items?.length || 0}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="expiring">
            Expiring
            {expiringItems?.expiring && expiringItems.expiring.length > 0 && (
              <Badge className="ml-2" variant="destructive">
                {expiringItems.expiring.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="low-stock">
            Low Stock
            {lowStockItems?.lowStock && lowStockItems.lowStock.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {lowStockItems.lowStock.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="keep-in-stock">
            Keep in Stock
            {keepInStockItems?.items && keepInStockItems.items.length > 0 && (
              <Badge className="ml-2" variant="outline">
                {keepInStockItems.items.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {renderSortAndFilter()}
          {renderBulkToolbar(inStockItems)}

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : inStockEntries.length === 0 ? (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title="No items in stock"
              description="Add stock to your inventory items, or create a new item"
              action={
                <Button onClick={() => setItemFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {inStockEntries.map(({ entry, item, area }) =>
                item && renderStockEntryCard(entry, item, area)
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="catalog">
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
            <div className="space-y-2">
              {catalogItems.map((item) => renderItemCard(item))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="expiring">
          {!expiringItems?.expiring?.length ? (
            <EmptyState
              title="No items expiring soon"
              description="All your items are fresh"
            />
          ) : (
            <div className="space-y-2">
              {expiringItems.expiring.map((stockEntry) => {
                const daysUntil = stockEntry.expiryDate ? getDaysUntilExpiry(stockEntry.expiryDate) : null;
                const daysLabel = daysUntil === null ? '' :
                  daysUntil < 0 ? `${Math.abs(daysUntil)}d ago` :
                  daysUntil === 0 ? 'Today' :
                  daysUntil === 1 ? '1 day' :
                  `${daysUntil} days`;

                return (
                  <Card key={stockEntry.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium">{stockEntry.item?.name || 'Unknown'}</p>
                        <p className="text-sm text-muted-foreground">
                          {stockEntry.expiryDate &&
                            `Expires ${formatDate(stockEntry.expiryDate)}`}
                          {stockEntry.area && (
                            <span className="ml-2">
                              • {stockEntry.area.icon} {stockEntry.area.name}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {daysUntil !== null && (
                          <Badge variant={getExpiryBadgeVariant(daysUntil)}>
                            {daysLabel}
                          </Badge>
                        )}
                        <Badge variant="outline" className="font-mono">
                          {parseFloat(String(stockEntry.quantity)).toFixed(1)} {stockEntry.unit}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="low-stock">
          {!lowStockItems?.lowStock?.length ? (
            <EmptyState
              title="All items are well stocked"
              description="No items are running low"
            />
          ) : (
            <div className="space-y-2">
              {lowStockItems.lowStock.map((entry) => (
                <Card key={entry.item.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium">{entry.item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Current: {entry.currentQuantity} / Min: {entry.minQuantity}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => addToShoppingListMutation.mutate(entry.item.id)}
                      disabled={addToShoppingListMutation.isPending}
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Add to List
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="keep-in-stock">
          {!keepInStockItems?.items?.length ? (
            <EmptyState
              icon={<RefreshCcw className="h-12 w-12" />}
              title="No keep-in-stock items"
              description="Mark items as 'keep in stock' to track their levels and get reminders to restock"
            />
          ) : (
            <div className="space-y-2">
              {keepInStockItems.items.map((entry) => {
                const statusColor =
                  entry.status === 'out'
                    ? 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-900'
                    : entry.status === 'low'
                    ? 'text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-900'
                    : '';
                return (
                  <Card key={entry.item.id} className={cn(statusColor)}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium">{entry.item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Current: {entry.currentQuantity} / Min: {entry.minQuantity} {entry.unit}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.status === 'out' && (
                          <Badge variant="destructive">Out of stock</Badge>
                        )}
                        {entry.status === 'low' && (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                            Low
                          </Badge>
                        )}
                        {entry.status === 'ok' && (
                          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            Good
                          </Badge>
                        )}
                        {entry.onShoppingList && (
                          <Badge variant="outline" className="text-xs">
                            On list
                          </Badge>
                        )}
                        {!entry.onShoppingList && entry.status !== 'ok' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => addToShoppingListMutation.mutate(entry.item.id)}
                            disabled={addToShoppingListMutation.isPending}
                          >
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            Add to List
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

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
        onSubmit={handleItemFormSubmit}
        onDelete={editingItem ? () => handleDeleteClick(editingItem) : undefined}
        isSubmitting={createItemMutation.isPending || updateItemMutation.isPending}
      />

      {/* Delete Confirmation Dialog */}
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
              Choose how you want to remove {deleteDialog.isBulk ? 'these items' : 'this item'}:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-4 py-4">
            <Card
              className="cursor-pointer border-2 hover:border-primary transition-colors"
              onClick={() => handleDeleteItems('stock_only')}
            >
              <CardContent className="p-4">
                <p className="font-medium">Remove from stock only</p>
                <p className="text-sm text-muted-foreground">
                  Keep {deleteDialog.isBulk ? 'items' : 'item'} in the catalog but set quantity to zero.
                  You can add stock again later.
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
                  Permanently delete {deleteDialog.isBulk ? 'items' : 'item'} and all associated stock entries.
                  This cannot be undone.
                </p>
              </CardContent>
            </Card>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Add Dialog */}
      <BulkAddDialog
        open={bulkAddDialogOpen}
        onOpenChange={setBulkAddDialogOpen}
        areas={areas?.areas || []}
        onSubmit={(items) => batchCreateMutation.mutate(items)}
        isSubmitting={batchCreateMutation.isPending}
      />

      {/* Manage Stock Dialog */}
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
    </div>
  );
}
