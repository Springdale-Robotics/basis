import { useState, useEffect } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
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
import type { ShoppingListItem } from '@/types/models';

interface CheckOffItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ShoppingListItem | null;
  onConfirm: (acquiredQuantity: number, keepRemainder: boolean) => void;
  isPending?: boolean;
}

export function CheckOffItemDialog({
  open,
  onOpenChange,
  item,
  onConfirm,
  isPending,
}: CheckOffItemDialogProps) {
  const [quantity, setQuantity] = useState(0);
  const [keepRemainder, setKeepRemainder] = useState(true);

  const originalQuantity = item ? Number(item.quantity) || 0 : 0;
  const remainingQuantity = Math.max(0, originalQuantity - quantity);
  const hasRemainder = quantity < originalQuantity && quantity > 0;

  useEffect(() => {
    if (item && open) {
      setQuantity(Number(item.quantity) || 0);
      setKeepRemainder(true);
    }
  }, [item, open]);

  const handleConfirm = () => {
    onConfirm(quantity, keepRemainder && hasRemainder);
  };

  const adjustQuantity = (delta: number) => {
    setQuantity((prev) => Math.max(0, Math.min(originalQuantity * 2, prev + delta)));
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Check Off Item</DialogTitle>
          <DialogDescription>
            How much {item.name} did you get?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Needed: {originalQuantity} {item.unit}</Label>
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
              <span className="text-sm text-muted-foreground w-16">{item.unit}</span>
            </div>
          </div>

          {hasRemainder && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm">
                You're getting <span className="font-medium">{quantity} {item.unit}</span> of{' '}
                <span className="font-medium">{originalQuantity} {item.unit}</span> needed.
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
                  Keep remaining {remainingQuantity} {item.unit} on the list
                </label>
              </div>
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
