import { useState, useMemo, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { categoryOptions, unitOptions } from '@/lib/inventory-constants';
import type { InventoryItem, StorageArea } from '@/types/models';

interface FixIncompleteItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incompleteItems: InventoryItem[];
  areas: StorageArea[];
  onSave: (itemId: string, updates: {
    category?: string;
    defaultUnit?: string;
    defaultAreaId?: string;
    minStockQuantity?: number;
  }) => Promise<void>;
}

export function FixIncompleteItemDialog({
  open,
  onOpenChange,
  incompleteItems,
  areas,
  onSave,
}: FixIncompleteItemDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Track skipped item IDs so we can move past them
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  // Form state for current item
  const [category, setCategory] = useState<string>('');
  const [defaultUnit, setDefaultUnit] = useState<string>('');
  const [defaultAreaId, setDefaultAreaId] = useState<string>('');
  const [minStockQuantity, setMinStockQuantity] = useState<number>(1);

  // Filter out skipped items - always show the first remaining item
  const remainingItems = useMemo(
    () => incompleteItems.filter(item => !skippedIds.has(item.id)),
    [incompleteItems, skippedIds]
  );

  const currentItem = remainingItems[0];
  const totalIncomplete = incompleteItems.length;
  const remainingCount = remainingItems.length;

  // Determine what's missing for the current item
  const missingFields = useMemo(() => {
    if (!currentItem) return { category: false, defaultUnit: false, defaultAreaId: false, minStockQuantity: false };
    // Check minStockQuantity (what API returns) or legacy field names
    const minStock = currentItem.minStockQuantity ?? currentItem.minStockLevel ?? currentItem.keepInStockThreshold;
    return {
      category: !currentItem.category,
      defaultUnit: !currentItem.defaultUnit,
      defaultAreaId: !currentItem.defaultAreaId,
      minStockQuantity: currentItem.keepInStock && minStock == null,
    };
  }, [currentItem]);

  // Reset form state when current item changes
  useEffect(() => {
    if (currentItem) {
      setCategory(currentItem.category || '');
      setDefaultUnit(currentItem.defaultUnit || '');
      setDefaultAreaId(currentItem.defaultAreaId || '');
      setMinStockQuantity(currentItem.minStockQuantity ?? currentItem.minStockLevel ?? currentItem.keepInStockThreshold ?? 1);
    }
  }, [currentItem]);

  // Reset skipped items when dialog opens
  useEffect(() => {
    if (open) {
      setSkippedIds(new Set());
    }
  }, [open]);

  // Close dialog when no remaining items
  useEffect(() => {
    if (open && remainingCount === 0 && !isSubmitting) {
      onOpenChange(false);
    }
  }, [open, remainingCount, isSubmitting, onOpenChange]);

  // Combobox options
  const categoryComboboxOptions: ComboboxOption[] = useMemo(
    () => categoryOptions.map((cat) => ({ value: cat, label: cat })),
    []
  );

  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

  const areaComboboxOptions: ComboboxOption[] = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

  const handleSaveAndNext = async () => {
    if (!currentItem) return;

    // Build updates object with only the fields that were missing and now have values
    const updates: {
      category?: string;
      defaultUnit?: string;
      defaultAreaId?: string;
      minStockQuantity?: number;
    } = {};

    if (missingFields.category && category) {
      updates.category = category;
    }
    if (missingFields.defaultUnit && defaultUnit) {
      updates.defaultUnit = defaultUnit;
    }
    if (missingFields.defaultAreaId && defaultAreaId) {
      updates.defaultAreaId = defaultAreaId;
    }
    if (missingFields.minStockQuantity && minStockQuantity > 0) {
      updates.minStockQuantity = minStockQuantity;
    }

    // Only save if there are updates
    if (Object.keys(updates).length > 0) {
      setIsSubmitting(true);
      try {
        await onSave(currentItem.id, updates);
        // Move to next item immediately (don't wait for query refetch)
        setSkippedIds(prev => new Set([...prev, currentItem.id]));
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Nothing to update — just move to next
      setSkippedIds(prev => new Set([...prev, currentItem.id]));
    }
  };

  const handleSkip = () => {
    if (currentItem) {
      setSkippedIds(prev => new Set([...prev, currentItem.id]));
    }
    // Dialog closes automatically via useEffect when remainingCount becomes 0
  };

  if (!currentItem) {
    return null;
  }

  const hasMissingFields = Object.values(missingFields).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Fix Incomplete Items
          </DialogTitle>
          <DialogDescription>
            {remainingCount} of {totalIncomplete} item{totalIncomplete !== 1 ? 's' : ''} remaining
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Item name - prominent display */}
          <div className="rounded-lg bg-muted p-3">
            <p className="text-lg font-medium">{currentItem.name}</p>
            {currentItem.keepInStock && (
              <p className="text-sm text-muted-foreground">Keep in stock enabled</p>
            )}
          </div>

          {/* Only show missing fields */}
          {missingFields.category && (
            <div className="space-y-2">
              <Label>Category</Label>
              <Combobox
                options={categoryComboboxOptions}
                value={category}
                onValueChange={(value) => setCategory(value)}
                placeholder="Select category"
                searchPlaceholder="Search categories..."
                emptyText="No category found."
              />
            </div>
          )}

          {missingFields.defaultUnit && (
            <div className="space-y-2">
              <Label>Default Unit</Label>
              <Combobox
                options={unitComboboxOptions}
                value={defaultUnit}
                onValueChange={(value) => setDefaultUnit(value || '')}
                placeholder="Select unit"
                searchPlaceholder="Search units..."
                emptyText="No unit found."
              />
            </div>
          )}

          {missingFields.defaultAreaId && (
            <div className="space-y-2">
              <Label>Default Storage Area</Label>
              <Combobox
                options={areaComboboxOptions}
                value={defaultAreaId}
                onValueChange={(value) => setDefaultAreaId(value || '')}
                placeholder="Select storage area"
                searchPlaceholder="Search areas..."
                emptyText="No area found."
              />
            </div>
          )}

          {missingFields.minStockQuantity && (
            <div className="space-y-2">
              <Label htmlFor="minStockQuantity">
                Minimum Stock Quantity{' '}
                {(currentItem.defaultUnit || currentItem.unit) && (
                  <span className="text-muted-foreground">
                    ({currentItem.defaultUnit || currentItem.unit})
                  </span>
                )}
              </Label>
              <Input
                id="minStockQuantity"
                type="number"
                min="1"
                value={minStockQuantity}
                onChange={(e) => setMinStockQuantity(parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                Required when "keep in stock" is enabled
              </p>
            </div>
          )}

          {!hasMissingFields && (
            <p className="text-sm text-muted-foreground">
              This item appears to be complete. Click Skip to move to the next item.
            </p>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleSkip} disabled={isSubmitting}>
              Skip
            </Button>
            <Button onClick={handleSaveAndNext} disabled={isSubmitting || !hasMissingFields}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {remainingCount === 1 ? 'Save & Finish' : 'Save & Next'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
