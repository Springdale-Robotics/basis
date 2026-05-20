import { useState, useMemo, useEffect, useRef } from 'react';
import { Package, Check, SkipForward, Zap, ListChecks, Link2, Plus, ArrowRight } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
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
import { inventoryApi } from '@/api/inventory';
import { toast } from '@/hooks/useToast';
import type { StorageArea, InventoryItem, ShoppingListItem } from '@/types/models';

interface PutAwayItem {
  shoppingListItem: ShoppingListItem;
  inventoryItem?: InventoryItem;
  areaId: string;
  quantity: string;
  expiryDate: string;
}

type DialogMode = 'choice' | 'step-by-step' | 'resolve';

interface PutAwayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkedItems: ShoppingListItem[];
  inventoryItems: InventoryItem[];
  areas: StorageArea[];
  onPutAway: (data: { shoppingListItemId: string; areaId: string; quantity: number; expiryDate?: string }) => Promise<void>;
  onPutAwayAll: () => Promise<{ movedCount: number; skippedCount: number }>;
  isSubmitting?: boolean;
}

function buildPutAwayItem(item: ShoppingListItem, inventoryItems: InventoryItem[]): PutAwayItem {
  const inventoryItem = inventoryItems.find(inv => inv.id === item.inventoryItemId);
  const defaultArea = item.defaultAreaId || inventoryItem?.defaultAreaId || '';
  return {
    shoppingListItem: item,
    inventoryItem,
    areaId: defaultArea,
    quantity: String(item.quantity || 1),
    expiryDate: '',
  };
}

export function PutAwayDialog({
  open,
  onOpenChange,
  checkedItems,
  inventoryItems,
  areas,
  onPutAway,
  onPutAwayAll,
  isSubmitting,
}: PutAwayDialogProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<DialogMode>('choice');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [putAwayItems, setPutAwayItems] = useState<PutAwayItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const wasOpen = useRef(false);

  // Initialize on first open; on subsequent renders, merge newly-linked items.
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      const linkable = checkedItems.filter(item => item.inventoryItemId);
      const items = linkable.map(item => buildPutAwayItem(item, inventoryItems));
      setPutAwayItems(items);
      setCurrentIndex(0);
      const hasUnlinked = checkedItems.some(c => !c.inventoryItemId);
      setMode(items.length === 0 && hasUnlinked ? 'resolve' : 'choice');
      wasOpen.current = true;
    } else {
      setPutAwayItems(prev => {
        const existing = new Set(prev.map(p => p.shoppingListItem.id));
        const newOnes = checkedItems
          .filter(item => item.inventoryItemId && !existing.has(item.id))
          .map(item => buildPutAwayItem(item, inventoryItems));
        if (newOnes.length === 0) return prev;
        return [...prev, ...newOnes];
      });
    }
  }, [open, checkedItems, inventoryItems]);

  const currentItem = putAwayItems[currentIndex];
  const hasMoreItems = currentIndex < putAwayItems.length - 1;
  const itemsWithoutInventoryLink = checkedItems.filter(item => !item.inventoryItemId);

  const itemsWithDefaultArea = putAwayItems.filter(item => item.areaId).length;
  const itemsWithoutDefaultArea = putAwayItems.filter(item => !item.areaId).length;

  const areaOptions: ComboboxOption[] = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

  const inventoryOptions: ComboboxOption[] = useMemo(
    () =>
      inventoryItems.map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [inventoryItems]
  );

  const linkMutation = useMutation({
    mutationFn: ({ shoppingListItemId, inventoryItemId }: { shoppingListItemId: string; inventoryItemId: string }) =>
      inventoryApi.updateShoppingListItem(shoppingListItemId, { itemId: inventoryItemId, customName: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
      setResolvingItemId(null);
    },
    onError: (error) => {
      toast({
        title: 'Link failed',
        description: error instanceof Error ? error.message : 'Could not link item',
        variant: 'destructive',
      });
      setResolvingItemId(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (shoppingItem: ShoppingListItem) => {
      const result = await inventoryApi.quickCreateItem({
        name: shoppingItem.name,
        defaultUnit: shoppingItem.unit || undefined,
        category: shoppingItem.category || undefined,
      });
      await inventoryApi.updateShoppingListItem(shoppingItem.id, {
        itemId: result.item.id,
        customName: null,
      });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      setResolvingItemId(null);
    },
    onError: (error) => {
      toast({
        title: 'Create failed',
        description: error instanceof Error ? error.message : 'Could not create catalog item',
        variant: 'destructive',
      });
      setResolvingItemId(null);
    },
  });

  const updateCurrentItem = (updates: Partial<PutAwayItem>) => {
    setPutAwayItems(items =>
      items.map((item, idx) =>
        idx === currentIndex ? { ...item, ...updates } : item
      )
    );
  };

  const handlePutAwayAll = async () => {
    setProcessing(true);
    try {
      await onPutAwayAll();
      handleClose();
    } finally {
      setProcessing(false);
    }
  };

  const handlePutAway = async () => {
    if (!currentItem || !currentItem.areaId) return;

    setProcessing(true);
    try {
      await onPutAway({
        shoppingListItemId: currentItem.shoppingListItem.id,
        areaId: currentItem.areaId,
        quantity: parseFloat(currentItem.quantity) || 1,
        expiryDate: currentItem.expiryDate || undefined,
      });

      if (hasMoreItems) {
        setCurrentIndex(idx => idx + 1);
      } else {
        handleClose();
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleSkip = () => {
    if (hasMoreItems) {
      setCurrentIndex(idx => idx + 1);
    } else {
      handleClose();
    }
  };

  const handleClose = () => {
    setCurrentIndex(0);
    setPutAwayItems([]);
    setMode('choice');
    setResolvingItemId(null);
    wasOpen.current = false;
    onOpenChange(false);
  };

  const handleLink = (shoppingListItemId: string, inventoryItemId: string) => {
    setResolvingItemId(shoppingListItemId);
    linkMutation.mutate({ shoppingListItemId, inventoryItemId });
  };

  const handleCreate = (shoppingItem: ShoppingListItem) => {
    setResolvingItemId(shoppingItem.id);
    createMutation.mutate(shoppingItem);
  };

  // Nothing at all to do
  if (putAwayItems.length === 0 && itemsWithoutInventoryLink.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Put Away Groceries
            </DialogTitle>
            <DialogDescription>
              No items to put away
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 text-center">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground">No checked items to put away.</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Force resolve view when there's nothing linkable yet
  const effectiveMode: DialogMode =
    putAwayItems.length === 0 && itemsWithoutInventoryLink.length > 0 ? 'resolve' : mode;

  if (effectiveMode === 'resolve') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Link custom items
            </DialogTitle>
            <DialogDescription>
              These items aren't in your inventory catalog. Link each to an existing catalog item or create a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {itemsWithoutInventoryLink.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                All custom items resolved.
              </p>
            ) : (
              itemsWithoutInventoryLink.map(item => (
                <CustomItemRow
                  key={item.id}
                  item={item}
                  inventoryOptions={inventoryOptions}
                  onLink={(invId) => handleLink(item.id, invId)}
                  onCreate={() => handleCreate(item)}
                  isProcessing={resolvingItemId === item.id}
                  disableAll={linkMutation.isPending || createMutation.isPending}
                />
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={() => setMode('choice')}
              disabled={putAwayItems.length === 0}
            >
              Continue
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (effectiveMode === 'choice') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Put Away Groceries
            </DialogTitle>
            <DialogDescription>
              {putAwayItems.length} item{putAwayItems.length !== 1 ? 's' : ''} to put away
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Card
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={itemsWithDefaultArea > 0 && !processing ? handlePutAwayAll : undefined}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">Use default locations</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Quickly put away all items in their default storage areas
                    </p>
                    {itemsWithDefaultArea > 0 ? (
                      <p className="text-xs text-muted-foreground mt-2">
                        {itemsWithDefaultArea} item{itemsWithDefaultArea !== 1 ? 's' : ''} will be put away
                        {itemsWithoutDefaultArea > 0 && (
                          <span className="text-amber-600">
                            {' '}({itemsWithoutDefaultArea} without default area will be skipped)
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 mt-2">
                        No items have default areas set
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => !processing && setMode('step-by-step')}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-muted p-2">
                    <ListChecks className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">Review one by one</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Choose location and add expiry dates for each item
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {itemsWithoutInventoryLink.length > 0 && (
              <Card
                className="cursor-pointer border-amber-300 bg-amber-50/40 transition-colors hover:border-amber-400 dark:bg-amber-950/20"
                onClick={() => setMode('resolve')}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/40">
                      <Link2 className="h-5 w-5 text-amber-700 dark:text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium">
                        {itemsWithoutInventoryLink.length} custom item
                        {itemsWithoutInventoryLink.length !== 1 ? 's' : ''} not in catalog
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Link or create catalog entries so they can be put away
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={processing}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step-by-step
  if (!currentItem) {
    // Defensive: if somehow we got here without a current item, fall back to choice.
    setMode('choice');
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Put Away Groceries
          </DialogTitle>
          <DialogDescription>
            Item {currentIndex + 1} of {putAwayItems.length}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1">
          {putAwayItems.map((_, idx) => (
            <div
              key={idx}
              className={`h-1 flex-1 rounded-full ${
                idx < currentIndex
                  ? 'bg-primary'
                  : idx === currentIndex
                  ? 'bg-primary/50'
                  : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-medium text-lg">{currentItem.shoppingListItem.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {currentItem.shoppingListItem.quantity} {currentItem.shoppingListItem.unit || 'item(s)'}
                </p>
              </div>
              <Badge variant="outline">{currentItem.shoppingListItem.category || 'Uncategorized'}</Badge>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Storage Area *</Label>
                <Combobox
                  options={areaOptions}
                  value={currentItem.areaId}
                  onValueChange={(v) => updateCurrentItem({ areaId: v })}
                  placeholder="Select where to store..."
                  searchPlaceholder="Search areas..."
                  emptyText="No areas found"
                />
                {!currentItem.areaId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Select a storage area to put this item away
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>
                    Quantity
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({currentItem.shoppingListItem.unit || currentItem.inventoryItem?.defaultUnit || 'item(s)'})
                    </span>
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={currentItem.quantity}
                    onChange={(e) => updateCurrentItem({ quantity: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Expiry Date</Label>
                  <Input
                    type="date"
                    value={currentItem.expiryDate}
                    onChange={(e) => updateCurrentItem({ expiryDate: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={processing || isSubmitting}
          >
            <SkipForward className="h-4 w-4 mr-2" />
            Skip
          </Button>
          <Button
            onClick={handlePutAway}
            disabled={!currentItem.areaId || processing || isSubmitting}
          >
            <Check className="h-4 w-4 mr-2" />
            {hasMoreItems ? 'Put Away & Next' : 'Put Away & Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomItemRow({
  item,
  inventoryOptions,
  onLink,
  onCreate,
  isProcessing,
  disableAll,
}: {
  item: ShoppingListItem;
  inventoryOptions: ComboboxOption[];
  onLink: (inventoryItemId: string) => void;
  onCreate: () => void;
  isProcessing: boolean;
  disableAll: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium truncate">{item.name}</p>
            <p className="text-xs text-muted-foreground">
              {item.quantity} {item.unit || 'item(s)'}
              {item.category ? ` · ${item.category}` : ''}
            </p>
          </div>
          {isProcessing && (
            <Badge variant="secondary" className="text-xs">Saving…</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <Combobox
              options={inventoryOptions}
              value=""
              onValueChange={onLink}
              placeholder="Link to existing…"
              searchPlaceholder="Search catalog…"
              emptyText="No catalog items found"
              disabled={disableAll}
            />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={onCreate}
            disabled={disableAll}
            title="Create catalog item from this"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
