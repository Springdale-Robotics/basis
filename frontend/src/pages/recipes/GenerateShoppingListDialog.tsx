import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Check, Loader2, Package, Calendar, UtensilsCrossed } from 'lucide-react';
import {
  Dialog,
  DialogContent,
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

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  const { data: mealPlansData } = useQuery({
    queryKey: ['meal-plans', startStr, endStr],
    queryFn: () => recipesApi.getMealPlans({ start: startStr, end: endStr }),
    enabled: open,
  });

  const mealPlans = mealPlansData?.mealPlans ?? [];
  const recipeCount = new Set(mealPlans.map((m) => m.recipeId)).size;

  const previewMutation = useMutation({
    mutationFn: () =>
      recipesApi.previewShoppingList({
        startDate: startStr,
        endDate: endStr,
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
        startDate: startStr,
        endDate: endStr,
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

  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const dateRangeLabel = `${startDate.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })} – ${endDate.toLocaleDateString(undefined, {
    weekday: 'short',
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
        </DialogHeader>

        {/* Date range + meal summary card — always visible while the dialog is open. */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Calendar className="h-4 w-4 text-primary" />
            {dateRangeLabel}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UtensilsCrossed className="h-3.5 w-3.5" />
            {mealPlans.length === 0
              ? 'No meals planned in this range'
              : `${mealPlans.length} meal${mealPlans.length === 1 ? '' : 's'} planned across ${recipeCount} recipe${recipeCount === 1 ? '' : 's'}`}
          </div>
        </div>

        {step === 'options' && (
          <>
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground">
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
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending || mealPlans.length === 0}
              >
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
