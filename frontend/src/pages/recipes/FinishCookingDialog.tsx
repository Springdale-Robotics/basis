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
import type { RecipeIngredient } from '@/types/models';

interface FinishCookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  ingredients: RecipeIngredient[];
  onComplete: () => void;
}

type DialogStep = 'confirm' | 'adjust';

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
  const [step, setStep] = useState<DialogStep>('confirm');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adjustments, setAdjustments] = useState<IngredientAdjustment[]>([]);

  // Initialize adjustments from ingredients
  const initializeAdjustments = () => {
    setAdjustments(
      ingredients
        .filter(ing => ing.inventoryItemId) // Only show ingredients linked to inventory
        .map(ing => ({
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

  const handleYesUsedAll = async () => {
    setIsSubmitting(true);
    try {
      await recipesApi.finishCooking(recipeId, {
        deductInventory: true,
      });
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
    // Just close without deducting anything
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

  const handleClose = () => {
    setStep('confirm');
    setAdjustments([]);
    onOpenChange(false);
  };

  // Check if there are any inventory-linked ingredients
  const hasInventoryIngredients = ingredients.some(ing => ing.inventoryItemId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        {step === 'confirm' ? (
          <>
            <DialogHeader>
              <DialogTitle>Finish Cooking</DialogTitle>
              <DialogDescription>
                {hasInventoryIngredients
                  ? "Did you use all the ingredients as listed in the recipe?"
                  : "Great job! Since no ingredients are linked to your inventory, there's nothing to deduct."}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {hasInventoryIngredients ? (
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
