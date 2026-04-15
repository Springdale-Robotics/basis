import { useState, useEffect } from 'react';
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

interface QuantityWeightPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  unit: string;
  onConfirm: (grams: number) => Promise<void>;
  onSkip: () => void;
}

export function QuantityWeightPromptDialog({
  open,
  onOpenChange,
  itemName,
  unit,
  onConfirm,
  onSkip,
}: QuantityWeightPromptDialogProps) {
  const [grams, setGrams] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setGrams('');
    }
  }, [open]);

  const handleConfirm = async () => {
    const gramsNum = parseFloat(grams);
    if (isNaN(gramsNum) || gramsNum <= 0) return;

    setIsSubmitting(true);
    try {
      await onConfirm(gramsNum);
      setGrams('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    setGrams('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Quantity Weight Needed</DialogTitle>
          <DialogDescription>
            To convert between units, we need to know the weight of <strong>{itemName}</strong> per <strong>{unit}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="grams-per-unit">
              How many grams does 1 {unit} of {itemName} weigh?
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">1 {unit} =</span>
              <Input
                id="grams-per-unit"
                type="number"
                step="any"
                min="0"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                placeholder="e.g., 500"
                className="w-24"
                autoFocus
              />
              <span className="text-muted-foreground">g</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleSkip} disabled={isSubmitting}>
            Skip
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!grams || parseFloat(grams) <= 0 || isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
