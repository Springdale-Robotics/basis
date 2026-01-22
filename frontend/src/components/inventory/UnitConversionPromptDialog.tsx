import { useState } from 'react';
import { Loader2, ArrowLeftRight } from 'lucide-react';
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

interface UnitConversionPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  fromUnit: string;
  toUnit: string;
  onConfirm: (factor: number, saveForFuture: boolean) => Promise<void>;
  onSkip: () => void;
}

export function UnitConversionPromptDialog({
  open,
  onOpenChange,
  itemName,
  fromUnit,
  toUnit,
  onConfirm,
  onSkip,
}: UnitConversionPromptDialogProps) {
  const [factor, setFactor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSwapped, setIsSwapped] = useState(false);

  // Display units based on swap state
  const displayFromUnit = isSwapped ? toUnit : fromUnit;
  const displayToUnit = isSwapped ? fromUnit : toUnit;

  const handleConfirm = async () => {
    const factorNum = parseFloat(factor);
    if (isNaN(factorNum) || factorNum <= 0) return;

    setIsSubmitting(true);
    try {
      // If swapped, we need to invert the factor
      // User entered: 1 toUnit = factorNum fromUnit
      // We need: 1 fromUnit = (1/factorNum) toUnit
      const actualFactor = isSwapped ? 1 / factorNum : factorNum;
      await onConfirm(actualFactor, true); // Always save for future
      setFactor('');
      setIsSwapped(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    setFactor('');
    setIsSwapped(false);
  };

  const handleSwap = () => {
    setIsSwapped(!isSwapped);
    setFactor(''); // Clear factor when swapping to avoid confusion
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Unit Conversion Needed</DialogTitle>
          <DialogDescription>
            The recipe uses <strong>{fromUnit}</strong>, but <strong>{itemName}</strong> is stored in <strong>{toUnit}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="conversion-factor">
                How many {displayToUnit} is 1 {displayFromUnit}?
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSwap}
                className="h-8 px-2 text-muted-foreground"
              >
                <ArrowLeftRight className="h-4 w-4 mr-1" />
                Swap
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">1 {displayFromUnit} =</span>
              <Input
                id="conversion-factor"
                type="number"
                step="any"
                min="0"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                placeholder="e.g., 120"
                className="w-24"
                autoFocus
              />
              <span className="text-muted-foreground">{displayToUnit}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleSkip} disabled={isSubmitting}>
            Skip
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!factor || parseFloat(factor) <= 0 || isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
