import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ExitCookingWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmExit: () => void;
  onFinishCooking: () => void;
}

export function ExitCookingWarningDialog({
  open,
  onOpenChange,
  onConfirmExit,
  onFinishCooking,
}: ExitCookingWarningDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exit without finishing?</DialogTitle>
          <DialogDescription>
            If you exit now, ingredient amounts won't be adjusted in your inventory.
            Would you like to finish cooking first to update your stock?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={onFinishCooking}
            className="w-full"
          >
            Finish & Adjust Inventory
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full"
          >
            Continue Cooking
          </Button>
          <Button
            variant="ghost"
            onClick={onConfirmExit}
            className="w-full border border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
          >
            Exit Without Adjusting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
