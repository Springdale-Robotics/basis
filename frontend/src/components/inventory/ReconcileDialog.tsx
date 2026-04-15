import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfidenceBadge, type ConfidenceBand } from './ConfidenceBadge';
import type { StorageArea, InventoryItem } from '@/types/models';
import { unitOptions } from '@/lib/inventory-constants';
import { inventoryApi } from '@/api/inventory';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

interface ReconcileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
  areas: StorageArea[];
  currentConfidence?: { confidence: number; band: ConfidenceBand; totalQuantity: number; unit: string } | null;
}

export function ReconcileDialog({ open, onOpenChange, item, areas, currentConfidence }: ReconcileDialogProps) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [areaId, setAreaId] = useState('');

  useEffect(() => {
    if (open && item) {
      setQuantity(currentConfidence?.totalQuantity?.toString() || '0');
      setUnit(item.defaultUnit || 'pieces');
      setAreaId(item.defaultAreaId || areas[0]?.id || '');
    }
  }, [open, item, currentConfidence, areas]);

  const reconcileMutation = useMutation({
    mutationFn: () => {
      if (!item) throw new Error('No item');
      return inventoryApi.reconcileItem(item.id, {
        quantity: parseFloat(quantity) || 0,
        unit,
        areaId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onOpenChange(false);
      toast({ title: `${item?.name} verified` });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const areaOptions: ComboboxOption[] = areas.map((area) => ({
    value: area.id,
    label: area.name,
    icon: <span>{area.icon}</span>,
  }));

  const unitSelectOptions: ComboboxOption[] = unitOptions.map((u) => ({
    value: u,
    label: u,
  }));

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Verify Stock: {item.name}
          </DialogTitle>
          <DialogDescription>
            Confirm how much you currently have. This resets the confidence score to 100%.
          </DialogDescription>
        </DialogHeader>

        {currentConfidence && (
          <div className="flex items-center gap-2 rounded-lg border p-3 bg-muted/30">
            <ConfidenceBadge band={currentConfidence.band} score={currentConfidence.confidence} showLabel />
            <span className="text-sm text-muted-foreground">
              Current: {currentConfidence.totalQuantity.toFixed(1)} {currentConfidence.unit}
            </span>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="reconcile-qty">Actual Quantity</Label>
              <Input
                id="reconcile-qty"
                type="number"
                min="0"
                step="0.1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Combobox
                options={unitSelectOptions}
                value={unit}
                onValueChange={setUnit}
                placeholder="Select unit"
                searchPlaceholder="Search units..."
                emptyText="No unit found"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Storage Area</Label>
            <Combobox
              options={areaOptions}
              value={areaId}
              onValueChange={setAreaId}
              placeholder="Select area"
              searchPlaceholder="Search areas..."
              emptyText="No area found"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => reconcileMutation.mutate()}
            disabled={reconcileMutation.isPending || !areaId}
          >
            {reconcileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
