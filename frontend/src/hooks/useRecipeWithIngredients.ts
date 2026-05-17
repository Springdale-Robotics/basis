import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { recipesApi } from '@/api/recipes';
import type { Recipe, RecipeIngredient } from '@/types/models';

export interface UseRecipeWithIngredientsResult {
  recipe: Recipe | undefined;
  isLoading: boolean;
}

export function useRecipeWithIngredients(id: string | undefined): UseRecipeWithIngredientsResult {
  const { data, isLoading } = useQuery({
    queryKey: ['recipes', id],
    queryFn: () => recipesApi.get(id!),
    enabled: !!id,
  });

  const recipe = useMemo<Recipe | undefined>(() => {
    if (!data?.recipe) return undefined;
    const merged: Recipe = {
      ...data.recipe,
      ingredients: (data.ingredients || []).map<RecipeIngredient>((ing, idx) => {
        const extra = ing as unknown as {
          id?: string;
          amount?: number;
          optional?: boolean;
          groupName?: string | null;
        };
        const amount = typeof ing.quantity === 'string'
          ? parseFloat(ing.quantity)
          : Number(ing.quantity ?? extra.amount ?? 0);
        return {
          id: extra.id || `ing-${idx}`,
          inventoryItemId: ing.inventoryItemId,
          name: ing.name,
          linkedItemName: ing.linkedItemName ?? null,
          amount: Number.isFinite(amount) ? amount : 0,
          unit: ing.unit || '',
          notes: ing.notes,
          optional: extra.optional ?? false,
          groupName: extra.groupName ?? null,
        };
      }),
    };
    return merged;
  }, [data]);

  return { recipe, isLoading };
}
