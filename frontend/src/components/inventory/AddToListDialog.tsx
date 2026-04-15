import { useState, useMemo } from 'react';
import { Plus, Search, Package } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { inventoryApi } from '@/api/inventory';
import type { StorageArea, InventoryItem } from '@/types/models';
import { categoryOptions, unitOptions } from '@/lib/inventory-constants';
import { lookupDensity } from '@/lib/ingredient-densities';

interface AddToListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventoryItems: InventoryItem[];
  areas: StorageArea[];
}

type Mode = 'select' | 'create';

interface NewItemForm {
  name: string;
  category: string;
  unit: string;
  icon: string;
  barcode: string;
  keepInStock: boolean;
  keepInStockThreshold: number;
  defaultAreaId: string;
  density?: number;
}

const defaultNewItemForm: NewItemForm = {
  name: '',
  category: '',
  unit: 'pieces',
  icon: '',
  barcode: '',
  keepInStock: false,
  keepInStockThreshold: 1,
  defaultAreaId: '',
  density: undefined,
};

export function AddToListDialog({
  open,
  onOpenChange,
  inventoryItems,
  areas,
}: AddToListDialogProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('select');
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');

  // New item form state
  const [newItem, setNewItem] = useState<NewItemForm>(defaultNewItemForm);

  const filteredItems = useMemo(() => {
    if (!search) return inventoryItems;
    const searchLower = search.toLowerCase();
    return inventoryItems.filter(
      (item) =>
        item.name.toLowerCase().includes(searchLower) ||
        item.category?.toLowerCase().includes(searchLower)
    );
  }, [inventoryItems, search]);

  const selectedItem = useMemo(
    () => inventoryItems.find((item) => item.id === selectedItemId),
    [inventoryItems, selectedItemId]
  );

  const areaOptions: ComboboxOption[] = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

  const categoryComboboxOptions: ComboboxOption[] = useMemo(
    () => categoryOptions.map((cat) => ({ value: cat, label: cat })),
    []
  );

  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

  // Auto-suggest density for new items
  const densitySuggestion = useMemo(() => {
    if (newItem.name && newItem.name.length >= 2) {
      const d = lookupDensity(newItem.name);
      if (d !== null) return d;
    }
    return null;
  }, [newItem.name]);

  const addToListMutation = useMutation({
    mutationFn: (data: { itemId: string; quantity: number; unit?: string }) =>
      inventoryApi.addToShoppingList({
        itemId: data.itemId,
        quantity: data.quantity,
        unit: data.unit,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
      handleClose();
    },
  });

  const createItemMutation = useMutation({
    mutationFn: (data: NewItemForm) => {
      const apiData = {
        name: data.name,
        category: data.category || undefined,
        barcode: data.barcode || undefined,
        defaultUnit: data.unit || 'pieces',
        keepInStock: data.keepInStock,
        minStockQuantity: data.keepInStock ? data.keepInStockThreshold : undefined,
        defaultAreaId: data.defaultAreaId || undefined,
        icon: data.icon || undefined,
        density: data.density || undefined,
      };
      return inventoryApi.createItem(apiData);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      // Add the newly created item to the shopping list
      addToListMutation.mutate({
        itemId: data.item.id,
        quantity: parseFloat(quantity) || 1,
        unit: newItem.unit,
      });
    },
  });

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId);
    const item = inventoryItems.find((i) => i.id === itemId);
    if (item) {
      setUnit(item.defaultUnit || 'pieces');
    }
  };

  const handleAddToList = () => {
    if (!selectedItemId) return;
    addToListMutation.mutate({
      itemId: selectedItemId,
      quantity: parseFloat(quantity) || 1,
      unit: unit || undefined,
    });
  };

  const handleCreateAndAdd = () => {
    if (!newItem.name.trim()) return;
    createItemMutation.mutate(newItem);
  };

  const handleClose = () => {
    setMode('select');
    setSearch('');
    setSelectedItemId(null);
    setQuantity('1');
    setUnit('');
    setNewItem(defaultNewItemForm);
    onOpenChange(false);
  };

  const handleSwitchToCreate = () => {
    setMode('create');
    setNewItem({ ...defaultNewItemForm, name: search }); // Pre-fill with search term
  };

  const updateNewItem = (updates: Partial<NewItemForm>) => {
    setNewItem((prev) => ({ ...prev, ...updates }));
  };

  const isSubmitting = addToListMutation.isPending || createItemMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {mode === 'select' ? 'Add to Shopping List' : 'Create New Item'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'select'
              ? 'Search and select an item from your catalog'
              : 'Create a new item to add to your catalog and shopping list'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'select' ? (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Item list */}
            <div className="flex-1 min-h-0 max-h-[250px] overflow-y-auto border rounded-lg">
              {filteredItems.length === 0 ? (
                <div className="p-6 text-center">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm text-muted-foreground mb-3">
                    {search ? `No items matching "${search}"` : 'No items in catalog'}
                  </p>
                  <Button variant="outline" size="sm" onClick={handleSwitchToCreate}>
                    <Plus className="h-4 w-4 mr-1" />
                    Create "{search || 'new item'}"
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedItemId === item.id ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.defaultUnit || 'pieces'}
                          </p>
                        </div>
                        {item.category && (
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quantity selection (when item selected) */}
            {selectedItem && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="font-medium">{selectedItem.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground">{unit}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Create new option */}
            {filteredItems.length > 0 && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={handleSwitchToCreate}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create new item instead
              </Button>
            )}
          </>
        ) : (
          /* Create new item form */
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="space-y-2">
              <Label htmlFor="newItemName">Name *</Label>
              <Input
                id="newItemName"
                value={newItem.name}
                onChange={(e) => updateNewItem({ name: e.target.value })}
                placeholder="e.g., Organic Milk"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Combobox
                  options={categoryComboboxOptions}
                  value={newItem.category}
                  onValueChange={(v) => updateNewItem({ category: v })}
                  placeholder="Select category"
                  searchPlaceholder="Search..."
                  emptyText="No category found"
                  allowClear
                  clearLabel="No category"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Combobox
                  options={unitComboboxOptions}
                  value={newItem.unit}
                  onValueChange={(v) => updateNewItem({ unit: v || 'pieces' })}
                  placeholder="Select unit"
                  searchPlaceholder="Search..."
                  emptyText="No unit found"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Default Storage Area</Label>
              <Combobox
                options={areaOptions}
                value={newItem.defaultAreaId}
                onValueChange={(v) => updateNewItem({ defaultAreaId: v })}
                placeholder="Select storage area"
                searchPlaceholder="Search areas..."
                emptyText="No area found"
                allowClear
                clearLabel="No default area"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="newItemIcon">Icon (emoji)</Label>
                <Input
                  id="newItemIcon"
                  value={newItem.icon}
                  onChange={(e) => updateNewItem({ icon: e.target.value })}
                  placeholder="📦"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newItemBarcode">Barcode</Label>
                <Input
                  id="newItemBarcode"
                  value={newItem.barcode}
                  onChange={(e) => updateNewItem({ barcode: e.target.value })}
                  placeholder="Optional barcode"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newItemDensity">Density (g/ml)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="newItemDensity"
                  type="number"
                  step="0.001"
                  min="0"
                  value={newItem.density ?? ''}
                  onChange={(e) => updateNewItem({ density: e.target.value ? parseFloat(e.target.value) : undefined })}
                  placeholder="e.g., 0.529"
                  className="w-32"
                />
                {densitySuggestion && !newItem.density && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => updateNewItem({ density: densitySuggestion })}
                  >
                    Suggested: {densitySuggestion}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Used for weight/volume conversions
              </p>
            </div>

            {/* Quantity to add to shopping list */}
            <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
              <Label htmlFor="quantityToAdd">Quantity to Add to List *</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="quantityToAdd"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">{newItem.unit || 'pieces'}</span>
              </div>
            </div>

            <div className="space-y-4 border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="keepInStock">Keep in Stock</Label>
                  <p className="text-sm text-muted-foreground">
                    Add to shopping list when low
                  </p>
                </div>
                <Switch
                  id="keepInStock"
                  checked={newItem.keepInStock}
                  onCheckedChange={(checked) => updateNewItem({ keepInStock: checked })}
                />
              </div>
              {newItem.keepInStock && (
                <div className="space-y-2">
                  <Label htmlFor="keepInStockThreshold">Minimum Quantity</Label>
                  <Input
                    id="keepInStockThreshold"
                    type="number"
                    min="1"
                    value={newItem.keepInStockThreshold}
                    onChange={(e) => updateNewItem({ keepInStockThreshold: parseInt(e.target.value) || 1 })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Alert when quantity falls below this number
                  </p>
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setMode('select')}
            >
              Back to catalog search
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {mode === 'select' ? (
            <Button
              onClick={handleAddToList}
              disabled={!selectedItemId || isSubmitting}
            >
              Add to List
            </Button>
          ) : (
            <Button
              onClick={handleCreateAndAdd}
              disabled={!newItem.name.trim() || isSubmitting}
            >
              Create & Add to List
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
