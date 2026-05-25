import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Check, Loader2, Package } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { recipesApi, type GenerateShoppingListResponse } from '@/api/recipes';
import { useInventoryTier } from '@/hooks/useInventoryTier';

interface GenerateShoppingListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startDate: Date;
  endDate: Date;
}

type Step = 'options' | 'preview' | 'success';

export function GenerateShoppingListDialog({
  open,
  onOpenChange,
  startDate,
  endDate,
}: GenerateShoppingListDialogProps) {
  const { isAdvanced } = useInventoryTier();
  const [step, setStep] = useState<Step>('options');
  const [checkInventory, setCheckInventory] = useState(false);
  const [previewData, setPreviewData] = useState<GenerateShoppingListResponse | null>(null);

  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: () =>
      recipesApi.previewShoppingList({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        checkInventory,
      }),
    onSuccess: (data) => {
      setPreviewData(data);
      setStep('preview');
    },
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      recipesApi.generateShoppingList({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        checkInventory,
      }),
    onSuccess: (data) => {
      setPreviewData(data);
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });

  const handleClose = () => {
    setStep('options');
    setCheckInventory(true);
    setPreviewData(null);
    onOpenChange(false);
  };

  const dateRangeLabel = `${startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${endDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Generate Shopping List
          </DialogTitle>
          <DialogDescription>
            Create a shopping list from your meal plans for {dateRangeLabel}
          </DialogDescription>
        </DialogHeader>

        {step === 'options' && (
          <>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Ingredients are scaled by each meal's own servings setting. Adjust
                a meal's servings in the meal plan to change how much is added.
              </p>

              {isAdvanced && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="check-inventory">Check current inventory</Label>
                    <p className="text-xs text-muted-foreground">
                      Subtract items you already have in stock
                    </p>
                  </div>
                  <Switch
                    id="check-inventory"
                    checked={checkInventory}
                    onCheckedChange={setCheckInventory}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
                {previewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Preview List
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'preview' && previewData && (
          <>
            <div className="max-h-[400px] overflow-y-auto">
              <div className="space-y-4 py-4">
                {previewData.items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Package className="h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      {checkInventory
                        ? 'You already have everything you need!'
                        : 'No items to add - no recipes found in this date range'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Items to add</span>
                      <Badge variant="secondary">{previewData.items.length}</Badge>
                    </div>

                    <div className="space-y-2">
                      {previewData.items.map((item, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              From: {item.recipes.join(', ')}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-medium">{item.quantity.toFixed(1)}</span>
                            {item.unit && (
                              <span className="ml-1 text-sm text-muted-foreground">
                                {item.unit}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {isAdvanced && checkInventory && previewData.inventoryDeductions.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <Check className="h-4 w-4" />
                            Already in inventory
                          </div>
                          <div className="mt-2 space-y-1">
                            {previewData.inventoryDeductions.map((item, index) => (
                              <div
                                key={index}
                                className="flex items-center justify-between text-sm text-muted-foreground"
                              >
                                <span>{item.name}</span>
                                <span>
                                  -{item.deducted.toFixed(1)} {item.unit}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('options')}>
                Back
              </Button>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || previewData.items.length === 0}
              >
                {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add to Shopping List
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'success' && previewData && (
          <>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="rounded-full bg-green-100 p-3 dark:bg-green-900">
                <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="mt-4 text-lg font-medium">Shopping List Updated</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {previewData.addedCount} items added
                {(previewData.mergedCount ?? 0) > 0 && `, ${previewData.mergedCount} quantities merged`}
              </p>
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
