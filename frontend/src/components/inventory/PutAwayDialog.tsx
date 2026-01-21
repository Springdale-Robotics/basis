import { useState, useMemo, useEffect, useRef } from 'react';
import { Package, Check, SkipForward } from 'lucide-react';
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

interface PutAwayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkedItems: ShoppingListItem[];
  inventoryItems: InventoryItem[];
  areas: StorageArea[];
  onPutAway: (data: { shoppingListItemId: string; areaId: string; quantity: number; expiryDate?: string }) => Promise<void>;
  onSkip: (id: string) => void;
  isSubmitting?: boolean;
}

export function PutAwayDialog({
  open,
  onOpenChange,
  checkedItems,
  inventoryItems,
  areas,
  onPutAway,
  onSkip,
  isSubmitting,
}: PutAwayDialogProps) {
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
          return {
            shoppingListItem: item,
            inventoryItem,
            areaId: inventoryItem?.defaultAreaId || '',
            quantity: String(item.quantity || 1),
            expiryDate: '',
          };
        });
      setPutAwayItems(items);
      setCurrentIndex(0);
    }
    wasOpen.current = open;
  }, [open, checkedItems, inventoryItems]);

  const currentItem = putAwayItems[currentIndex];
  const hasMoreItems = currentIndex < putAwayItems.length - 1;
  const itemsWithoutInventoryLink = checkedItems.filter(item => !item.inventoryItemId);

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
    onSkip(currentItem.shoppingListItem.id);
    if (hasMoreItems) {
      setCurrentIndex(idx => idx + 1);
    } else {
      handleClose();
    }
  };

  const handleClose = () => {
    setCurrentIndex(0);
    setPutAwayItems([]);
    wasOpen.current = false;
    onOpenChange(false);
  };

  if (!currentItem) {
    // No items to put away (all are custom items without inventory link)
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
