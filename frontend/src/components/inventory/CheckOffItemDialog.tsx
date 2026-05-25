import { useState, useEffect, useMemo } from 'react';
import { Info, Loader2, Minus, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { cn } from '@/lib/utils';
import { unitOptions, getUnitOptionsByCategory } from '@/lib/inventory-constants';
import { getUnitCategory, resolveUnit } from '@/lib/units';
import type { ShoppingListItem } from '@/types/models';

interface CheckOffItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ShoppingListItem | null;
  onConfirm: (
    acquiredQuantity: number,
    keepRemainder: boolean,
    acquiredUnit?: string
  ) => void;
  isPending?: boolean;
}

function dimensionOf(unit: string | null | undefined): 'volume' | 'weight' | 'count' | 'unknown' {
  if (!unit) return 'unknown';
  const cat = getUnitCategory(unit);
  if (cat === 'unknown' || cat === 'negligible') return 'unknown';
  return cat;
}

export function CheckOffItemDialog({
  open,
  onOpenChange,
  item,
  onConfirm,
  isPending,
}: CheckOffItemDialogProps) {
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState('');
  const [keepRemainder, setKeepRemainder] = useState(true);

  const originalQuantity = item ? Number(item.quantity) || 0 : 0;
  const originalUnit = item?.unit ? resolveUnit(item.unit) : '';
  // Compare on resolved (canonical) unit so synonyms like "tablespoon" vs
  // "tbsp" don't read as a unit change.
  const unitChanged =
    unit.trim() !== '' &&
    !!originalUnit &&
    resolveUnit(unit) !== resolveUnit(originalUnit);
  const sameDimension = dimensionOf(unit) === dimensionOf(originalUnit);

  // Build the picker options: same-dimension first (most likely the user's
  // pick), then the rest of the registry. Pulled from the canonical units
  // table so this stays in sync with every other unit selector in the app.
  const unitOptionsList: ComboboxOption[] = useMemo(() => {
    const dim = dimensionOf(originalUnit);
    const primary = dim !== 'unknown' ? getUnitOptionsByCategory(dim) : [];
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const u of [...primary, ...unitOptions]) {
      if (!seen.has(u)) {
        seen.add(u);
        ordered.push(u);
      }
    }
    return ordered.map((u) => ({ value: u, label: u }));
  }, [originalUnit]);

  // Same-dimension swaps (e.g., fl oz ↔ tbsp) always convert without density.
  // Cross-dimension hint flags the moment we'd need a density to bridge.
  const crossDimensionHint =
    unitChanged && !sameDimension && originalUnit && dimensionOf(originalUnit) !== 'unknown';

  // Remainder math only makes sense when units match (or are convertible —
  // we leave the convertible case to the backend, which receives the same
  // unit and decides whether to keep a remainder).
  const remainingQuantity = sameDimension
    ? Math.max(0, originalQuantity - quantity)
    : 0;
  const hasRemainder = sameDimension && quantity < originalQuantity && quantity > 0;

  useEffect(() => {
    if (item && open) {
      setQuantity(Number(item.quantity) || 0);
      // Resolve to the canonical unit key so the Combobox can match it
      // against `unitOptions` (e.g. "tablespoon" → "tbsp", "pound" → "lb").
      setUnit(item.unit ? resolveUnit(item.unit) : '');
      setKeepRemainder(true);
    }
  }, [item, open]);

  const handleConfirm = () => {
    onConfirm(
      quantity,
      keepRemainder && hasRemainder,
      unitChanged ? unit.trim() : undefined
    );
  };

  const adjustQuantity = (delta: number) => {
    setQuantity((prev) => Math.max(0, prev + delta));
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Check Off Item</DialogTitle>
          <DialogDescription>
            How much {item.name} did you get?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>
              Needed: {originalQuantity} {originalUnit || 'units'}
            </Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => adjustQuantity(-1)}
                disabled={quantity <= 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0, Number(e.target.value) || 0))}
                className="text-center"
                min={0}
                step={0.5}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => adjustQuantity(1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Combobox
                options={unitOptionsList}
                value={unit}
                onValueChange={setUnit}
                placeholder="unit"
                searchPlaceholder="Search units..."
                emptyText="No unit found"
                className="w-32"
              />
            </div>
          </div>

          {hasRemainder && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm">
                You're getting <span className="font-medium">{quantity} {unit || originalUnit}</span> of{' '}
                <span className="font-medium">{originalQuantity} {originalUnit}</span> needed.
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="keepRemainder"
                  checked={keepRemainder}
                  onCheckedChange={(checked) => setKeepRemainder(!!checked)}
                />
                <label
                  htmlFor="keepRemainder"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Keep remaining {remainingQuantity} {originalUnit} on the list
                </label>
              </div>
            </div>
          )}

          {unitChanged && sameDimension && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Storing as {quantity} {unit}. Same dimension as {originalUnit} — auto-converts.
              </span>
            </div>
          )}

          {crossDimensionHint && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2',
                'dark:border-amber-900/40 dark:bg-amber-950/40'
              )}
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-xs text-amber-900 dark:text-amber-100">
                Will store as {quantity} {unit}. Add a density on{' '}
                <span className="font-medium">{item.name}</span> so we can compare
                with the {originalUnit} the recipe asked for.
              </span>
            </div>
          )}

          {quantity === 0 && (
            <div className="text-sm text-muted-foreground">
              Setting quantity to 0 will remove this item from the list.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {quantity === 0 ? 'Remove Item' : 'Check Off'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
