import { useState } from 'react';
import { Loader2, Check, X } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { recipesApi, type FinishCookingRequest } from '@/api/recipes';
import { inventoryApi } from '@/api/inventory';
import type { RecipeIngredient } from '@/types/models';
import { useInventoryTier } from '@/hooks/useInventoryTier';

interface FinishCookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  ingredients: RecipeIngredient[];
  onComplete: () => void;
}

type DialogStep = 'confirm' | 'adjust' | 'basic-used';

interface IngredientAdjustment {
  ingredientId: string;
  name: string;
  originalAmount: number;
  unit: string;
  actualAmount: number;
  skipped: boolean;
  inventoryItemId?: string;
}

export function FinishCookingDialog({
  open,
  onOpenChange,
  recipeId,
  ingredients,
  onComplete,
}: FinishCookingDialogProps) {
  const { isAdvanced } = useInventoryTier();
  const [step, setStep] = useState<DialogStep>('confirm');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adjustments, setAdjustments] = useState<IngredientAdjustment[]>([]);
  // Basic mode: which items did the user use up completely
  const [usedUpItems, setUsedUpItems] = useState<Set<string>>(new Set());

  const inventoryIngredients = ingredients.filter(ing => ing.inventoryItemId);
  const hasInventoryIngredients = inventoryIngredients.length > 0;

  const initializeAdjustments = () => {
    setAdjustments(
      inventoryIngredients.map(ing => ({
        ingredientId: ing.id,
        name: ing.name,
        originalAmount: ing.amount,
        unit: ing.unit,
        actualAmount: ing.amount,
        skipped: false,
        inventoryItemId: ing.inventoryItemId,
      }))
    );
  };

  const initializeUsedUp = () => {
    // Default all items to "used up" (pre-checked)
    setUsedUpItems(new Set(inventoryIngredients.map(ing => ing.inventoryItemId!)));
  };

  const handleYesUsedAll = async () => {
    setIsSubmitting(true);
    try {
      await recipesApi.finishCooking(recipeId, { deductInventory: true });
      onComplete();
    } catch (error) {
      console.error('Failed to finish cooking:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNoAdjust = () => {
    initializeAdjustments();
    setStep('adjust');
  };

  const handleDidntCook = () => {
    onComplete();
  };

  const handleAdjustmentChange = (ingredientId: string, field: 'actualAmount' | 'skipped', value: number | boolean) => {
    setAdjustments(prev =>
      prev.map(adj =>
        adj.ingredientId === ingredientId
          ? { ...adj, [field]: value }
          : adj
      )
    );
  };

  const handleSubmitAdjustments = async () => {
    setIsSubmitting(true);
    try {
      const request: FinishCookingRequest = {
        deductInventory: true,
        adjustments: adjustments.map(adj => ({
          ingredientId: adj.ingredientId,
          actualQuantityUsed: adj.skipped ? 0 : adj.actualAmount,
          skipDeduction: adj.skipped,
        })),
      };
      await recipesApi.finishCooking(recipeId, request);
      onComplete();
    } catch (error) {
      console.error('Failed to finish cooking:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Basic mode: mark checked items as out of stock
  const handleBasicFinish = async () => {
    setIsSubmitting(true);
    try {
      await recipesApi.finishCooking(recipeId, { deductInventory: false });
      // Mark used-up items as out of stock
      for (const itemId of usedUpItems) {
        try {
          await inventoryApi.markOutOfStock(itemId);
        } catch {
          // Silently continue if one fails
        }
      }
      onComplete();
    } catch (error) {
      console.error('Failed to finish cooking:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setStep('confirm');
    setAdjustments([]);
    setUsedUpItems(new Set());
    onOpenChange(false);
  };

  const toggleUsedUp = (itemId: string) => {
    setUsedUpItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        {step === 'confirm' ? (
          <>
            <DialogHeader>
              <DialogTitle>Finish Cooking</DialogTitle>
              <DialogDescription>
                {!isAdvanced
                  ? "Nice work! Did you use up any ingredients?"
                  : hasInventoryIngredients
                  ? "Did you use all the ingredients as listed in the recipe?"
                  : "Great job! Since no ingredients are linked to your inventory, there's nothing to deduct."}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {!isAdvanced ? (
                <>
                  {hasInventoryIngredients && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        initializeUsedUp();
                        setStep('basic-used');
                      }}
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      Yes, update my inventory
                    </Button>
                  )}
                  <Button
                    onClick={async () => {
                      setIsSubmitting(true);
                      try {
                        await recipesApi.finishCooking(recipeId, { deductInventory: false });
                        onComplete();
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    {hasInventoryIngredients ? 'No, just mark as done' : 'Done cooking'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleDidntCook}
                    disabled={isSubmitting}
                    className="w-full text-muted-foreground"
                  >
                    I didn't actually make this
                  </Button>
                </>
              ) : hasInventoryIngredients ? (
                <>
                  <Button
                    onClick={handleYesUsedAll}
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    {isSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Yes, deduct from inventory
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleNoAdjust}
                    disabled={isSubmitting}
                    className="w-full"
                  >
                    No, let me adjust amounts
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleDidntCook}
                    disabled={isSubmitting}
                    className="w-full text-muted-foreground"
                  >
                    I didn't actually make this
                  </Button>
                </>
              ) : (
                <Button onClick={onComplete} className="w-full">
                  Done
                </Button>
              )}
            </DialogFooter>
          </>
        ) : step === 'basic-used' ? (
          <>
            <DialogHeader>
              <DialogTitle>What did you use up?</DialogTitle>
              <DialogDescription>
                Check the items you've completely used up. They'll be removed from your inventory.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[400px] pr-4">
              <div className="space-y-2 py-4">
                {inventoryIngredients.map(ing => (
                  <div
                    key={ing.id}
                    className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                    onClick={() => ing.inventoryItemId && toggleUsedUp(ing.inventoryItemId)}
                  >
                    <Checkbox
                      checked={usedUpItems.has(ing.inventoryItemId!)}
                      onCheckedChange={() => ing.inventoryItemId && toggleUsedUp(ing.inventoryItemId)}
                    />
                    <div className="flex-1">
                      <p className="font-medium">{ing.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ing.amount} {ing.unit}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setStep('confirm')}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                onClick={handleBasicFinish}
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {usedUpItems.size > 0
                  ? `Remove ${usedUpItems.size} item${usedUpItems.size !== 1 ? 's' : ''} from inventory`
                  : 'Done cooking'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Adjust Ingredient Usage</DialogTitle>
              <DialogDescription>
                Update the amounts you actually used, or mark ingredients you didn't use.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[400px] pr-4">
              <div className="space-y-4 py-4">
                {adjustments.map(adj => (
                  <div
                    key={adj.ingredientId}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      adj.skipped ? 'bg-muted opacity-60' : ''
                    }`}
                  >
                    <Checkbox
                      id={`skip-${adj.ingredientId}`}
                      checked={!adj.skipped}
                      onCheckedChange={(checked) =>
                        handleAdjustmentChange(adj.ingredientId, 'skipped', !checked)
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <Label
                        htmlFor={`skip-${adj.ingredientId}`}
                        className="font-medium cursor-pointer"
                      >
                        {adj.name}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Recipe called for: {adj.originalAmount} {adj.unit}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={adj.actualAmount}
                        onChange={(e) =>
                          handleAdjustmentChange(
                            adj.ingredientId,
                            'actualAmount',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        disabled={adj.skipped}
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground w-12">
                        {adj.unit}
                      </span>
                    </div>
                  </div>
                ))}

                {adjustments.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No ingredients are linked to your inventory.
                  </p>
                )}
              </div>
            </ScrollArea>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setStep('confirm')}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                onClick={handleSubmitAdjustments}
                disabled={isSubmitting}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Deduct from Inventory
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
