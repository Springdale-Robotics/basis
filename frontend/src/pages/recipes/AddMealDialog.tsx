import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Check, Loader2, UtensilsCrossed, Trash2, Minus } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import { Recipe, MealPlan } from '@/types/models';

interface AddMealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  existingMeals?: MealPlan[];
}

// Format date in local timezone (YYYY-MM-DD)
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const [servingsMultiplier, setServingsMultiplier] = useState(1);

  const queryClient = useQueryClient();

  const { data: recipesData, isLoading } = useQuery({
    queryKey: ['recipes', search],
    queryFn: () => recipesApi.list({ search: search || undefined }),
    enabled: open,
  });

  const addMealMutation = useMutation({
    mutationFn: async (recipeId: string) => {
      const plannedDate = formatLocalDate(date);
      return recipesApi.createMealPlan({
        recipeId,
        plannedDate,
        mealType,
        servingsMultiplier: servingsMultiplier !== 1 ? servingsMultiplier : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
      setSelectedRecipe(null);
      setServingsMultiplier(1);
    },
    onError: (error: any) => {
      // Handle duplicate error gracefully
      console.error('Failed to add meal:', error);
    },
  });

  const removeMealMutation = useMutation({
    mutationFn: (mealPlanId: string) => recipesApi.deleteMealPlan(mealPlanId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meal-plans'] });
    },
  });

  const handleClose = () => {
    setSearch('');
    setSelectedRecipe(null);
    setServingsMultiplier(1);
    onOpenChange(false);
  };

  const handleAddRecipe = () => {
    if (selectedRecipe) {
      addMealMutation.mutate(selectedRecipe);
    }
  };

  const recipes = recipesData?.recipes || [];
  const existingRecipeIds = new Set(existingMeals.map((m) => m.recipeId));

  // Filter out recipes that are already planned
  const availableRecipes = recipes.filter((r) => !existingRecipeIds.has(r.id));

  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5" />
            {mealType.charAt(0).toUpperCase() + mealType.slice(1)}
          </DialogTitle>
          <DialogDescription>{dateLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Existing meals */}
          {existingMeals.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Planned recipes</div>
              {existingMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{meal.recipe?.title}</div>
                    {meal.servingsMultiplier && Number(meal.servingsMultiplier) !== 1 && (
                      <div className="text-xs text-muted-foreground">
                        {meal.servingsMultiplier}x servings
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => removeMealMutation.mutate(meal.id)}
                    disabled={removeMealMutation.isPending}
                  >
                    {removeMealMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
              <Separator className="my-4" />
            </div>
          )}

          {/* Add new recipe */}
          <div className="text-sm font-medium">Add a recipe</div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search recipes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-[200px] pr-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableRecipes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <UtensilsCrossed className="h-12 w-12 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {search
                    ? 'No recipes found'
                    : recipes.length === 0
                    ? 'No recipes yet. Add some recipes first!'
                    : 'All recipes already planned for this meal'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {availableRecipes.map((recipe: Recipe) => {
                  const isSelected = selectedRecipe === recipe.id;
                  return (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => setSelectedRecipe(isSelected ? null : recipe.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50'
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{recipe.title}</div>
                        {recipe.servings && (
                          <div className="text-xs text-muted-foreground">
                            {recipe.servings} servings
                          </div>
                        )}
                      </div>
                      <div
                        className={cn(
                          'ml-2 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Servings multiplier */}
          {selectedRecipe && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">Servings multiplier</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setServingsMultiplier(Math.max(0.5, servingsMultiplier - 0.5))}
                  disabled={servingsMultiplier <= 0.5}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center font-medium">{servingsMultiplier}x</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setServingsMultiplier(Math.min(10, servingsMultiplier + 0.5))}
                  disabled={servingsMultiplier >= 10}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Done
          </Button>
          <Button
            onClick={handleAddRecipe}
            disabled={!selectedRecipe || addMealMutation.isPending}
          >
            {addMealMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add Recipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
