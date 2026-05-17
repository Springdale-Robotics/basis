import type { RecipeIngredient } from '@/types/models';

export function scaleQuantity(
  amount: number,
  fromServings: number | null | undefined,
  toServings: number | null | undefined,
): number {
  if (!fromServings || !toServings) return amount;
  return amount * (toServings / fromServings);
}

export function roundQuantity(amount: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(amount * factor) / factor;
}

export function getIngredientDisplayName(ing: Pick<RecipeIngredient, 'name' | 'linkedItemName'>): string {
  return ing.name || ing.linkedItemName || '';
}

export interface StockSummary {
  haveLinked: number;
  totalLinked: number;
  totalIngredients: number;
}

export function getStockSummary(
  ingredients: Pick<RecipeIngredient, 'inventoryItemId'>[],
  stockedItemIds: Set<string>,
): StockSummary {
  const linked = ingredients.filter((i) => i.inventoryItemId);
  const have = linked.filter((i) => stockedItemIds.has(i.inventoryItemId!));
  return {
    haveLinked: have.length,
    totalLinked: linked.length,
    totalIngredients: ingredients.length,
  };
}
