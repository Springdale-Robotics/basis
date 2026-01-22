import { useState, useMemo, useEffect, useRef } from 'react';
import { Package, Check, SkipForward, Zap, ListChecks } from 'lucide-react';
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
import type { StorageArea, InventoryItem, ShoppingListItem } from '@/types/models';

interface PutAwayItem {
  shoppingListItem: ShoppingListItem;
  inventoryItem?: InventoryItem;
  areaId: string;
  quantity: string;
  expiryDate: string;
}

type DialogMode = 'choice' | 'step-by-step';

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
  const [mode, setMode] = useState<DialogMode>('choice');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [putAwayItems, setPutAwayItems] = useState<PutAwayItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const wasOpen = useRef(false);

  // Initialize put away items only when dialog first opens
  useEffect(() => {
    if (open && !wasOpen.current) {
      // Dialog just opened - initialize items
      const items = checkedItems
        .filter(item => item.inventoryItemId) // Only items linked to inventory
        .map(item => {
          const inventoryItem = inventoryItems.find(inv => inv.id === item.inventoryItemId);
          // Use defaultAreaId from shopping list item (fresh from API) as primary source,
          // falling back to inventoryItem for backward compatibility
          const defaultArea = item.defaultAreaId || inventoryItem?.defaultAreaId || '';
          return {
            shoppingListItem: item,
            inventoryItem,
            areaId: defaultArea,
            quantity: String(item.quantity || 1),
            expiryDate: '',
          };
        });
      setPutAwayItems(items);
      setCurrentIndex(0);
      setMode('choice');
    }
    wasOpen.current = open;
  }, [open, checkedItems, inventoryItems]);

  const currentItem = putAwayItems[currentIndex];
  const hasMoreItems = currentIndex < putAwayItems.length - 1;
  const itemsWithoutInventoryLink = checkedItems.filter(item => !item.inventoryItemId);

  // Count items with and without default areas
  const itemsWithDefaultArea = putAwayItems.filter(item => item.areaId).length;
  const itemsWithoutDefaultArea = putAwayItems.filter(item => !item.areaId).length;

  // Area combobox options
  const areaOptions: ComboboxOption[] = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

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
    // Just move to the next item without deleting - the skipped item
    // will remain checked on the list so the user can put it away later
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
    wasOpen.current = false;
    onOpenChange(false);
  };

  // No items to put away (all are custom items without inventory link)
  if (!currentItem) {
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
            <p className="text-muted-foreground">
              {itemsWithoutInventoryLink.length > 0
                ? `All ${itemsWithoutInventoryLink.length} checked item(s) are custom items not linked to your inventory catalog. Use "Clear Checked" to remove them.`
                : 'No checked items to put away.'}
            </p>
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

  // Choice screen - quick vs step-by-step
  if (mode === 'choice') {
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
            {/* Quick put away option */}
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

            {/* Step-by-step option */}
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
          </div>

          {itemsWithoutInventoryLink.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Note: {itemsWithoutInventoryLink.length} custom item(s) without inventory links will be skipped.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={processing}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step-by-step mode
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

        {/* Progress indicator */}
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

        {/* Current item */}
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
                  <Label>Quantity</Label>
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

        {/* Skipped items note */}
        {itemsWithoutInventoryLink.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Note: {itemsWithoutInventoryLink.length} custom item(s) without inventory links will be skipped.
          </p>
        )}

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
