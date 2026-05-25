import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  Loader2,
  Minus,
  Plus,
  Trash2,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import {
  formatMultiplier,
  formatServings,
  multiplierFromServings,
  snapNearInteger,
} from '@/lib/servings';
import type { MealPlan, Recipe } from '@/types/models';

interface MealActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meal: MealPlan;
}

const MEAL_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

function recipeImageSrc(recipe: Recipe | undefined): string | undefined {
  if (!recipe) return undefined;
  if (recipe.imageData) {
    return `data:${recipe.imageMimeType};base64,${recipe.imageData}`;
  }
  return recipe.imageUrl;
}


function formatPlannedDate(d: string): string {
  // d is YYYY-MM-DD — parse without timezone shift.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function MealActionDialog({
  open,
  onOpenChange,
  meal,
}: MealActionDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const originalMultiplier = meal.servingsMultiplier
    ? Number(meal.servingsMultiplier)
    : 1;
  const baseServings = meal.recipe?.servings ?? null;
  // Edit servings directly when the recipe has a base serving count; otherwise
  // fall back to editing the multiplier (some imported recipes don't specify).
  const editsServings = baseServings != null;

  const [value, setValue] = useState<number>(() =>
    editsServings
      ? snapNearInteger(baseServings! * originalMultiplier)
      : originalMultiplier
  );

  useEffect(() => {
    if (open) {
      setValue(
        editsServings
          ? snapNearInteger(baseServings! * originalMultiplier)
          : originalMultiplier
      );
    }
  }, [open, meal.id, editsServings, baseServings, originalMultiplier]);

  // Computed multiplier we'll persist. 6-dp matches the DB column precision so
  // an 8-of-6 entry round-trips as 1.333333 instead of being truncated to 1.33.
  const multiplier = editsServings
    ? multiplierFromServings(value, baseServings!)
    : value;

  // Round-trip via the persisted multiplier so the dirty check is stable across
  // re-opens (avoids floating-point drift like 1.49999).
  const persistedValue = editsServings
    ? baseServings! * originalMultiplier
    : originalMultiplier;
  const dirty =
    Math.abs(value - persistedValue) > 1e-4 ||
    Math.abs(multiplier - originalMultiplier) > 1e-4;

  const updateMutation = useMutation({
    mutationFn: (newMultiplier: number) =>
      recipesApi.updateMealPlan(meal.id, { servingsMultiplier: newMultiplier }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => recipesApi.deleteMealPlan(meal.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
      onOpenChange(false);
    },
  });

  const imageSrc = recipeImageSrc(meal.recipe);

  // Step by 1 when editing whole servings, by 0.5 when editing the multiplier.
  const step = editsServings ? 1 : 0.5;
  const minValue = editsServings ? Math.max(1, Math.round(baseServings! * 0.5)) : 0.5;
  const maxValue = editsServings ? baseServings! * 10 : 10;

  const adjustValue = (delta: number) => {
    const next = Math.max(minValue, Math.min(maxValue, Number((value + delta).toFixed(2))));
    setValue(next);
  };

  // Fire-and-forget save so the user can close immediately; React Query keeps
  // the mutation alive even after unmount and updates the cache when it lands.
  const commitIfDirty = () => {
    if (dirty) {
      updateMutation.mutate(multiplier);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) commitIfDirty();
    onOpenChange(next);
  };

  const handleStartCooking = async () => {
    if (dirty) {
      // Wait for the save before navigating so the cook session reads the
      // current servings count.
      await updateMutation.mutateAsync(multiplier);
    }
    onOpenChange(false);
    navigate(`/recipes/${meal.recipeId}/cook`);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* Recipe banner */}
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-primary/5">
              <ChefHat className="h-10 w-10 text-primary/60" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-white/80">
              {formatPlannedDate(meal.plannedDate)} · {MEAL_LABEL[meal.mealType]}
            </div>
          </div>
        </div>

        <DialogHeader className="px-6 pt-4 pb-2">
          <DialogTitle className="text-lg leading-tight">
            {meal.recipe?.title}
          </DialogTitle>
          {editsServings && (
            <DialogDescription>
              Recipe makes {baseServings} servings
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="px-6 pb-4 space-y-4">
          {/* Servings stepper */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">
                  {editsServings ? 'Servings' : 'Servings multiplier'}
                </div>
                {editsServings && Math.abs(multiplier - 1) > 1e-4 && (
                  <div className="text-xs text-muted-foreground">
                    {formatMultiplier(multiplier)}× recipe
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => adjustValue(-step)}
                disabled={value <= minValue}
                aria-label="Decrease servings"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-sm font-medium tabular-nums">
                {editsServings ? formatServings(value) : `${value}×`}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => adjustValue(step)}
                disabled={value >= maxValue}
                aria-label="Increase servings"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {dirty && (
            <div className="text-xs text-muted-foreground">
              Changes will be saved automatically.
            </div>
          )}

          <Separator />

          <Button
            className="w-full"
            size="lg"
            onClick={handleStartCooking}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UtensilsCrossed className="mr-2 h-4 w-4" />
            )}
            Start cooking
          </Button>
        </div>

        <DialogFooter className="px-6 py-3 border-t bg-muted/30 sm:justify-between">
          <Button
            variant="ghost"
            className={cn('text-destructive hover:text-destructive')}
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
          >
            {removeMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Remove from plan
          </Button>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
