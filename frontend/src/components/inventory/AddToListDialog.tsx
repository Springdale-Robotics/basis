import { useState, useMemo } from 'react';
import { Plus, Search, Package } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { unitOptions } from '@/lib/inventory-constants';

interface AddToListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventoryItems: InventoryItem[];
  areas: StorageArea[];
}

type Mode = 'select' | 'create';

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

  // New item form
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('pieces');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemDefaultArea, setNewItemDefaultArea] = useState('');

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

  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

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
    mutationFn: (data: { name: string; defaultUnit?: string; category?: string; defaultAreaId?: string }) =>
      inventoryApi.quickCreateItem(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      // Add the newly created item to the shopping list
      addToListMutation.mutate({
        itemId: data.item.id,
        quantity: parseFloat(quantity) || 1,
        unit: newItemUnit,
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
    if (!newItemName.trim()) return;
    createItemMutation.mutate({
      name: newItemName.trim(),
      defaultUnit: newItemUnit || undefined,
      category: newItemCategory || undefined,
      defaultAreaId: newItemDefaultArea || undefined,
    });
  };

  const handleClose = () => {
    setMode('select');
    setSearch('');
    setSelectedItemId(null);
    setQuantity('1');
    setUnit('');
    setNewItemName('');
    setNewItemUnit('pieces');
    setNewItemCategory('');
    setNewItemDefaultArea('');
    onOpenChange(false);
  };

  const handleSwitchToCreate = () => {
    setMode('create');
    setNewItemName(search); // Pre-fill with search term
  };

  const isSubmitting = addToListMutation.isPending || createItemMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
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
          <div className="space-y-4">
            <div>
              <Label>Item Name *</Label>
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="e.g., Organic Milk"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Default Unit</Label>
                <Combobox
                  options={unitComboboxOptions}
                  value={newItemUnit}
                  onValueChange={(v) => setNewItemUnit(v || 'pieces')}
                  placeholder="Unit"
                  searchPlaceholder="Search..."
                  emptyText="Not found"
                />
              </div>
              <div>
                <Label>Quantity to Add</Label>
                <Input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label>Category (optional)</Label>
              <Input
                value={newItemCategory}
                onChange={(e) => setNewItemCategory(e.target.value)}
                placeholder="e.g., Dairy"
              />
            </div>

            <div>
              <Label>Default Storage Area (optional)</Label>
              <Combobox
                options={areaOptions}
                value={newItemDefaultArea}
                onValueChange={(v) => setNewItemDefaultArea(v)}
                placeholder="Select area..."
                searchPlaceholder="Search areas..."
                emptyText="No areas found"
                allowClear
                clearLabel="None"
              />
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
              disabled={!newItemName.trim() || isSubmitting}
            >
              Create & Add
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
