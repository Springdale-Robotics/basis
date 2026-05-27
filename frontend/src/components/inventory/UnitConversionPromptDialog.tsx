import { useState, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { unitOptions } from '@/lib/inventory-constants';

interface ConversionPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  /** The unit we don't know how to convert (e.g. "bottle"). */
  unit: string;
  /** Suggested target unit — usually the item's defaultUnit or the recipe unit. */
  suggestedTargetUnit?: string;
  onConfirm: (quantity: number, sizeUnit: string) => Promise<void>;
  onSkip: () => void;
}

/**
 * Asks the user "how does this count unit convert to a standard one?"
 * E.g. "1 bottle of Olive Oil = ___ ___". The user fills in a number + picks
 * a unit (fl oz, lb, g, etc.). Once saved, every conversion path that needs
 * to go through this unit just works.
 */
export function ConversionPromptDialog({
  open,
  onOpenChange,
  itemName,
  unit,
  suggestedTargetUnit,
  onConfirm,
  onSkip,
}: ConversionPromptDialogProps) {
  const [quantity, setQuantity] = useState('');
  const [sizeUnit, setSizeUnit] = useState(suggestedTargetUnit ?? 'g');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuantity('');
      setSizeUnit(suggestedTargetUnit ?? 'g');
    }
  }, [open, suggestedTargetUnit]);

  const unitComboOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

  const handleConfirm = async () => {
    const qtyNum = parseFloat(quantity);
    if (isNaN(qtyNum) || qtyNum <= 0 || !sizeUnit) return;
    setIsSubmitting(true);
    try {
      await onConfirm(qtyNum, sizeUnit);
      setQuantity('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    setQuantity('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a conversion</DialogTitle>
          <DialogDescription>
            We don't know how to convert <strong>{unit}</strong> for{' '}
            <strong>{itemName}</strong> yet. What's 1 {unit} equal to?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="conversion-quantity">
              1 {unit} of {itemName} =
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="conversion-quantity"
                type="number"
                step="any"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g., 16"
                className="w-28"
                autoFocus
              />
              <Combobox
                options={unitComboOptions}
                value={sizeUnit}
                onValueChange={setSizeUnit}
                placeholder="unit"
                searchPlaceholder="Search units..."
                emptyText="No unit found"
                className="w-32"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Anything works — fl oz, lb, g, each. Once saved, recipes and
              stock will convert through it automatically.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleSkip} disabled={isSubmitting}>
            Skip
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!quantity || parseFloat(quantity) <= 0 || !sizeUnit || isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Back-compat alias for existing imports.
export { ConversionPromptDialog as QuantityWeightPromptDialog };
