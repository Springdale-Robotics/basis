import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Plus,
  Check,
  Loader2,
  UtensilsCrossed,
  Trash2,
  Minus,
  ChefHat,
  Clock,
  Users,
} from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import {
  formatMultiplier,
  formatServings,
  multiplierFromServings,
} from '@/lib/servings';
import { Recipe, MealPlan } from '@/types/models';

interface AddMealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  existingMeals?: MealPlan[];
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function recipeImageSrc(recipe: Recipe): string | undefined {
  if (recipe.imageData) {
    return `data:${recipe.imageMimeType};base64,${recipe.imageData}`;
  }
  return recipe.imageUrl;
}

export function AddMealDialog({
  open,
  onOpenChange,
  date,
  mealType,
  existingMeals = [],
}: AddMealDialogProps) {
  const [search, setSearch] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null);
  // `servingsValue` is either a servings count (when the chosen recipe has a
  // base servings) or a multiplier (when it doesn't). Initialized from the
  // recipe on select; null until then.
  const [servingsValue, setServingsValue] = useState<number | null>(null);

  const queryClient = useQueryClient();

  // Reset transient state whenever the dialog reopens for a different cell.
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedRecipe(null);
      setServingsValue(null);
    }
  }, [open, date, mealType]);

  const { data: recipesData, isLoading } = useQuery({
    queryKey: ['recipes', search],
    queryFn: () => recipesApi.list({ search: search || undefined }),
    enabled: open,
  });

  const recipes = recipesData?.recipes || [];
  const existingRecipeIds = new Set(existingMeals.map((m) => m.recipeId));
  const availableRecipes = recipes.filter((r) => !existingRecipeIds.has(r.id));
  const selected = selectedRecipe
    ? recipes.find((r) => r.id === selectedRecipe) ?? null
    : null;
  const editsServings = !!selected && selected.servings != null;
  const baseServings = selected?.servings ?? null;

  const handleSelect = (recipe: Recipe) => {
    const same = selectedRecipe === recipe.id;
    if (same) {
      setSelectedRecipe(null);
      setServingsValue(null);
      return;
    }
    setSelectedRecipe(recipe.id);
    // Default to one recipe's worth — base servings if known, else 1× multiplier.
    setServingsValue(recipe.servings ?? 1);
  };

  const computedMultiplier =
    servingsValue == null
      ? 1
      : editsServings && baseServings
      ? multiplierFromServings(servingsValue, baseServings)
      : servingsValue;

  const addMealMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      return recipesApi.createMealPlan({
        recipeId,
        plannedDate: formatLocalDate(date),
        mealType,
        servingsMultiplier:
          Math.abs(computedMultiplier - 1) > 1e-4 ? computedMultiplier : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
      setSelectedRecipe(null);
      setServingsValue(null);
      setSearch('');
    },
  });

  const removeMealMutation = useMutation({
    mutationFn: (mealPlanId: string) => recipesApi.deleteMealPlan(mealPlanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
    },
  });

  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const mealLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <UtensilsCrossed className="h-5 w-5 text-primary" />
            {mealLabel}
          </DialogTitle>
          <DialogDescription>{dateLabel}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-4">
          {existingMeals.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Planned
              </div>
              <div className="space-y-2">
                {existingMeals.map((meal) => (
                  <PlannedMealRow
                    key={meal.id}
                    meal={meal}
                    onRemove={() => removeMealMutation.mutate(meal.id)}
                    removing={
                      removeMealMutation.isPending &&
                      removeMealMutation.variables === meal.id
                    }
                  />
                ))}
              </div>
              <Separator className="mt-4" />
            </div>
          )}

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {existingMeals.length > 0 ? 'Add another recipe' : 'Add a recipe'}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search recipes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="min-h-[240px]">
              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : availableRecipes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <ChefHat className="h-10 w-10 text-muted-foreground/50" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    {search
                      ? 'No recipes match your search'
                      : recipes.length === 0
                      ? "You haven't added any recipes yet."
                      : 'All recipes are already planned for this meal.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {availableRecipes.map((recipe) => (
                    <RecipeRow
                      key={recipe.id}
                      recipe={recipe}
                      selected={selectedRecipe === recipe.id}
                      onSelect={() => handleSelect(recipe)}
                    />
                  ))}
                </div>
              )}
            </div>

            {selected && servingsValue != null && (
              <ServingsStepper
                value={servingsValue}
                onChange={setServingsValue}
                editsServings={editsServings}
                baseServings={baseServings}
                computedMultiplier={computedMultiplier}
              />
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30 sm:justify-between gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button
            onClick={() => selectedRecipe && addMealMutation.mutate(selectedRecipe)}
            disabled={!selectedRecipe || addMealMutation.isPending}
          >
            {addMealMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add to {mealLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlannedMealRow({
  meal,
  onRemove,
  removing,
}: {
  meal: MealPlan;
  onRemove: () => void;
  removing: boolean;
}) {
  const imageSrc = meal.recipe ? recipeImageSrc(meal.recipe) : undefined;
  const multiplier = meal.servingsMultiplier
    ? Number(meal.servingsMultiplier)
    : 1;
  const base = meal.recipe?.servings ?? null;
  const effective = base != null ? base * multiplier : null;
  const scaled = Math.abs(multiplier - 1) > 1e-4;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2 pr-2">
      <RecipeThumb src={imageSrc} className="h-10 w-10" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{meal.recipe?.title}</div>
        {effective != null ? (
          <div className="text-xs text-muted-foreground">
            {formatServings(effective)} servings
            {scaled && <> · {formatMultiplier(multiplier)}×</>}
          </div>
        ) : scaled ? (
          <div className="text-xs text-muted-foreground">
            {formatMultiplier(multiplier)}× recipe
          </div>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        disabled={removing}
        aria-label="Remove recipe"
      >
        {removing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

function RecipeRow({
  recipe,
  selected,
  onSelect,
}: {
  recipe: Recipe;
  selected: boolean;
  onSelect: () => void;
}) {
  const imageSrc = recipeImageSrc(recipe);
  const totalTime =
    (recipe.prepTime ?? recipe.prepTimeMinutes ?? 0) +
    (recipe.cookTime ?? recipe.cookTimeMinutes ?? 0);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-transparent hover:bg-muted/60'
      )}
    >
      <RecipeThumb src={imageSrc} className="h-10 w-10" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{recipe.title}</div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {recipe.servings ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {recipe.servings}
            </span>
          ) : null}
          {totalTime > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {totalTime}m
            </span>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          'ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/30'
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </div>
    </button>
  );
}

function ServingsStepper({
  value,
  onChange,
  editsServings,
  baseServings,
  computedMultiplier,
}: {
  value: number;
  onChange: (n: number) => void;
  editsServings: boolean;
  baseServings: number | null;
  computedMultiplier: number;
}) {
  const step = editsServings ? 1 : 0.5;
  const minValue = editsServings
    ? Math.max(1, Math.round((baseServings ?? 1) * 0.5))
    : 0.5;
  const maxValue = editsServings ? (baseServings ?? 1) * 10 : 10;

  const adjust = (delta: number) => {
    const next = Math.max(
      minValue,
      Math.min(maxValue, Number((value + delta).toFixed(2)))
    );
    onChange(next);
  };

  const scaled = Math.abs(computedMultiplier - 1) > 1e-4;

  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
      <div>
        <div className="text-sm font-medium">
          {editsServings ? 'Servings' : 'Servings multiplier'}
        </div>
        {editsServings && scaled && (
          <div className="text-xs text-muted-foreground">
            {formatMultiplier(computedMultiplier)}× recipe
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => adjust(-step)}
          disabled={value <= minValue}
          aria-label="Decrease servings"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center font-medium tabular-nums">
          {editsServings ? formatServings(value) : `${value}×`}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => adjust(step)}
          disabled={value >= maxValue}
          aria-label="Increase servings"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function RecipeThumb({ src, className }: { src?: string; className?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn('shrink-0 rounded-md object-cover bg-muted', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'shrink-0 rounded-md bg-muted flex items-center justify-center',
        className
      )}
    >
      <ChefHat className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}
