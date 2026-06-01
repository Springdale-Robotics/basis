import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Clock,
  Users,
  Edit,
  Trash2,
  PlayCircle,
  Plus,
  Minus,
  Download,
  Link2,
  Link2Off,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { getItemIcon } from '@/lib/inventory-constants';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { RecipeImageInput } from '@/components/recipes/RecipeImageInput';
import type { RecipeImageChange } from '@/components/recipes/RecipeForm';
import { EditGate } from '@/components/permissions';
import { AddToMealPlanDialog } from './AddToMealPlanDialog';
import { ShoppingCart } from 'lucide-react';
import { recipesApi } from '@/api/recipes';
import { inventoryApi } from '@/api/inventory';
import { useState, useMemo } from 'react';
import { toast } from '@/hooks/useToast';
import { useRecipeWithIngredients } from '@/hooks/useRecipeWithIngredients';
import {
  getIngredientDisplayName,
  getStockSummary,
  roundQuantity,
  scaleQuantity,
} from '@/lib/recipe-display';
import type { Recipe, RecipeIngredient, RecipeInstruction } from '@/types/models';

/**
 * Editable shape held by inline-edit mode. Mirrors the persistable subset of
 * Recipe — fields that can't be changed inline (image, tags) go through the
 * RecipeForm modal.
 */
interface RecipeDraft {
  title: string;
  description: string;
  prepTimeMinutes: string;
  cookTimeMinutes: string;
  servings: string;
  tags: string[];
  ingredients: Array<Pick<RecipeIngredient, 'id' | 'name' | 'amount' | 'unit' | 'notes' | 'inventoryItemId' | 'linkedItemName'>>;
  instructions: Array<{ step: number; text: string }>;
}

function makeDraft(recipe: Recipe): RecipeDraft {
  return {
    title: recipe.title,
    description: recipe.description ?? '',
    prepTimeMinutes: recipe.prepTimeMinutes != null ? String(recipe.prepTimeMinutes) : '',
    cookTimeMinutes: recipe.cookTimeMinutes != null ? String(recipe.cookTimeMinutes) : '',
    servings: recipe.servings != null ? String(recipe.servings) : '',
    tags: recipe.tags ?? [],
    ingredients: (recipe.ingredients ?? []).map((ing) => ({
      id: ing.id,
      name: ing.name,
      amount: ing.amount,
      unit: ing.unit,
      notes: ing.notes,
      inventoryItemId: ing.inventoryItemId,
      linkedItemName: ing.linkedItemName,
    })),
    instructions: (recipe.instructions ?? []).map((inst: RecipeInstruction, idx) => ({
      step: inst.step ?? idx + 1,
      text: inst.text,
    })),
  };
}

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addToMealPlanOpen, setAddToMealPlanOpen] = useState(false);
  const [scaledServings, setScaledServings] = useState<number | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const editMode = draft !== null;

  // Inline image editing (was previously only possible via the modal editor).
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  // Free-text tag entry box (Enter / comma commits).
  const [tagInput, setTagInput] = useState('');
  // Natural-language "quick add" ingredient line (Enter parses + adds a row).
  const [newIngredientLine, setNewIngredientLine] = useState('');

  const { recipe, isLoading } = useRecipeWithIngredients(id);

  // Fetch stock data for ingredient availability
  const { data: stockData } = useQuery({
    queryKey: ['inventory', 'stock'],
    queryFn: inventoryApi.getStock,
    enabled: !!recipe,
  });

  // Fetch all inventory items for linking
  const { data: allItemsData } = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => inventoryApi.getItems({}),
    enabled: !!recipe,
  });

  const existingItemOptions: ComboboxOption[] = useMemo(() =>
    (allItemsData?.items || []).map(item => ({
      value: item.id,
      label: item.name,
      icon: <span>{getItemIcon(item)}</span>,
    })),
    [allItemsData]
  );

  const stockedItemIds = useMemo(() => {
    const ids = new Set<string>();
    if (stockData?.stock) {
      for (const entry of stockData.stock) {
        const itemId = entry.itemId || entry.inventoryItemId;
        if (itemId && parseFloat(String(entry.quantity)) > 0) {
          ids.add(itemId);
        }
      }
    }
    return ids;
  }, [stockData]);

  const deleteMutation = useMutation({
    mutationFn: () => recipesApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['tag-suggestions'] });
      navigate('/recipes');
    },
  });

  // Inline-edit save — the single editor now. Persists everything the recipe
  // has (including image + tags, which used to require the modal).
  const inlineSaveMutation = useMutation({
    mutationFn: async (d: RecipeDraft) => {
      const prep = d.prepTimeMinutes.trim() === '' ? undefined : Number(d.prepTimeMinutes);
      const cook = d.cookTimeMinutes.trim() === '' ? undefined : Number(d.cookTimeMinutes);
      const servings = d.servings.trim() === '' ? undefined : Number(d.servings);
      await recipesApi.update(id!, {
        title: d.title.trim() || 'Untitled Recipe',
        description: d.description.trim() || undefined,
        servings: servings && servings > 0 ? servings : undefined,
        prepTimeMinutes: prep && prep > 0 ? prep : undefined,
        cookTimeMinutes: cook && cook > 0 ? cook : undefined,
        ingredients: d.ingredients
          .filter((ing) => ing.name.trim())
          .map((ing) => ({
            name: ing.name.trim(),
            quantity: ing.amount || undefined,
            unit: ing.unit || undefined,
            notes: ing.notes || undefined,
            inventoryItemId: ing.inventoryItemId || undefined,
          })),
        instructions: d.instructions
          .filter((inst) => inst.text.trim())
          .map((inst, idx) => ({ step: idx + 1, text: inst.text.trim() })),
        tags: d.tags,
      });

      // Image changes — editable inline now (previously modal-only).
      const imageChange = getImageChange();
      if (imageChange.type === 'file' && imageChange.file) {
        await recipesApi.uploadImage(id!, imageChange.file);
      } else if (imageChange.type === 'url' && imageChange.url) {
        await recipesApi.uploadImageFromUrl(id!, imageChange.url);
      } else if (imageChange.type === 'remove') {
        await recipesApi.deleteImage(id!);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes', id] });
      queryClient.invalidateQueries({ queryKey: ['tag-suggestions'] });
      resetEditState();
      toast({ title: 'Saved' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save changes',
        variant: 'destructive',
      });
    },
  });

  const existingImageSrc = recipe?.imageData
    ? `data:${recipe.imageMimeType};base64,${recipe.imageData}`
    : recipe?.imageUrl || null;

  const getImageChange = (): RecipeImageChange => {
    if (imageRemoved) return { type: 'remove' };
    if (pendingImageFile) return { type: 'file', file: pendingImageFile };
    if (pendingImageUrl) return { type: 'url', url: pendingImageUrl };
    return { type: 'none' };
  };

  const resetImageState = () => {
    setPendingImageFile(null);
    setPendingImageUrl(null);
    setImageRemoved(false);
    setTagInput('');
  };

  const resetEditState = () => {
    setDraft(null);
    resetImageState();
  };

  const enterEditMode = () => {
    if (recipe) {
      setDraft(makeDraft(recipe));
      resetImageState();
    }
  };
  const cancelEdit = () => resetEditState();
  const saveEdit = () => { if (draft) inlineSaveMutation.mutate(draft); };

  const patchDraft = (patch: Partial<RecipeDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  // Inline tag editing.
  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag || !draft) return;
    if (!draft.tags.includes(tag)) patchDraft({ tags: [...draft.tags, tag] });
    setTagInput('');
  };
  const removeTag = (tag: string) => {
    if (draft) patchDraft({ tags: draft.tags.filter((t) => t !== tag) });
  };

  // Natural-language quick-add: type "2 cups flour", we parse it into a row.
  const quickAddIngredient = async (line: string) => {
    const text = line.trim();
    if (!text || !draft) return;
    let parsed: { name?: string; quantity?: number; unit?: string; notes?: string } | undefined;
    try {
      const res = await recipesApi.parseIngredientLines([text]);
      parsed = res.ingredients?.[0];
    } catch {
      // Parser unavailable — fall back to using the raw text as the name.
    }
    patchDraft({
      ingredients: [
        ...draft.ingredients,
        {
          id: `new-${Date.now()}`,
          name: parsed?.name || text,
          amount: parsed?.quantity ?? 0,
          unit: parsed?.unit ?? '',
          notes: parsed?.notes,
          inventoryItemId: undefined,
          linkedItemName: undefined,
        },
      ],
    });
  };

  const addAllToShoppingListMutation = useMutation({
    mutationFn: async () => {
      if (!recipe) return { added: 0 };
      const ingredients = recipe.ingredients ?? [];
      await Promise.all(
        ingredients.map((ing) =>
          inventoryApi.addToShoppingList(
            ing.inventoryItemId
              ? {
                  itemId: ing.inventoryItemId,
                  quantity: ing.amount || undefined,
                  unit: ing.unit || undefined,
                }
              : {
                  customName: getIngredientDisplayName(ing),
                  quantity: ing.amount || undefined,
                  unit: ing.unit || undefined,
                },
          ),
        ),
      );
      return { added: ingredients.length };
    },
    onSuccess: ({ added }) => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'shopping-list'] });
      toast({ title: 'Added to shopping list', description: `${added} ingredients added` });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add to shopping list',
        variant: 'destructive',
      });
    },
  });

  const handleExportRecipe = async () => {
    if (!recipe) return;

    // Fetch inventory items to get catalog data for linked ingredients
    const inventoryItems = await inventoryApi.getItems();
    const itemsMap = new Map(inventoryItems.items.map(i => [i.id, i]));

    const exportData = {
      version: '1.0',
      type: 'recipe',
      exportedAt: new Date().toISOString(),
      recipe: {
        title: recipe.title,
        description: recipe.description,
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        tags: recipe.tags,
        sourceUrl: recipe.sourceUrl,
        imageUrl: recipe.imageUrl,
        ingredients: recipe.ingredients.map(ing => {
          const linkedItem = ing.inventoryItemId ? itemsMap.get(ing.inventoryItemId) : null;
          return {
            name: getIngredientDisplayName(ing),
            quantity: ing.amount,
            unit: ing.unit || '',
            notes: ing.notes,
            catalogItem: linkedItem ? {
              name: linkedItem.name,
              category: linkedItem.category,
              defaultUnit: linkedItem.defaultUnit,
              density: linkedItem.density,
            } : undefined,
          };
        }),
        instructions: recipe.instructions,
        timers: recipe.timers,
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recipe.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.recipe`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!recipe) {
    return <div>Recipe not found</div>;
  }

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" asChild>
          <Link to="/recipes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Recipes
          </Link>
        </Button>
      </div>

      <PageHeader
        title={editMode ? 'Editing recipe' : recipe.title}
        actions={
          <div className="flex gap-2">
            {editMode ? (
              <>
                <Button variant="outline" onClick={cancelEdit} disabled={inlineSaveMutation.isPending}>
                  <X className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
                <Button onClick={saveEdit} disabled={inlineSaveMutation.isPending}>
                  {inlineSaveMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={handleExportRecipe}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
                <EditGate feature="recipes">
                  <Button variant="outline" onClick={enterEditMode}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </EditGate>
                <Button asChild>
                  <Link to={`/recipes/${id}/cook`}>
                    <PlayCircle className="mr-2 h-4 w-4" />
                    Start Cooking
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Image — editable inline (prefer imageData over imageUrl) */}
          {editMode ? (
            <RecipeImageInput
              currentImage={imageRemoved ? undefined : (existingImageSrc || undefined)}
              onFileSelect={(file) => { setPendingImageFile(file); setPendingImageUrl(null); setImageRemoved(false); }}
              onUrlFetch={(url) => { setPendingImageUrl(url); setPendingImageFile(null); setImageRemoved(false); }}
              onRemove={() => { setPendingImageFile(null); setPendingImageUrl(null); setImageRemoved(true); }}
              disabled={inlineSaveMutation.isPending}
            />
          ) : (
            (recipe.imageData || recipe.imageUrl) && (
              <div className="aspect-video overflow-hidden rounded-lg bg-muted">
                <img
                  src={
                    recipe.imageData
                      ? `data:${recipe.imageMimeType};base64,${recipe.imageData}`
                      : recipe.imageUrl
                  }
                  alt={recipe.title}
                  className="h-full w-full object-cover"
                />
              </div>
            )
          )}

          {/* Title (edit mode) */}
          {editMode && draft && (
            <div className="space-y-2">
              <Label htmlFor="inline-title">Title</Label>
              <Input
                id="inline-title"
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                className="text-xl font-semibold"
              />
            </div>
          )}

          {/* Description */}
          {editMode && draft ? (
            <div className="space-y-2">
              <Label htmlFor="inline-description">Description</Label>
              <Textarea
                id="inline-description"
                value={draft.description}
                onChange={(e) => patchDraft({ description: e.target.value })}
                placeholder="Optional description"
                rows={3}
              />
            </div>
          ) : (
            recipe.description && (
              <p className="text-muted-foreground">{recipe.description}</p>
            )
          )}

          {/* Info row — editable in edit mode */}
          {editMode && draft ? (
            <div className="grid grid-cols-3 gap-3 max-w-md">
              <div>
                <Label htmlFor="inline-prep" className="text-xs">Prep (min)</Label>
                <Input
                  id="inline-prep"
                  type="number"
                  min={0}
                  value={draft.prepTimeMinutes}
                  onChange={(e) => patchDraft({ prepTimeMinutes: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="inline-cook" className="text-xs">Cook (min)</Label>
                <Input
                  id="inline-cook"
                  type="number"
                  min={0}
                  value={draft.cookTimeMinutes}
                  onChange={(e) => patchDraft({ cookTimeMinutes: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="inline-servings" className="text-xs">Servings</Label>
                <Input
                  id="inline-servings"
                  type="number"
                  min={1}
                  value={draft.servings}
                  onChange={(e) => patchDraft({ servings: e.target.value })}
                />
              </div>
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-4">
            {recipe.prepTimeMinutes && (
              <div className="flex items-center gap-1 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Prep: {recipe.prepTimeMinutes} min</span>
              </div>
            )}
            {recipe.cookTimeMinutes && (
              <div className="flex items-center gap-1 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Cook: {recipe.cookTimeMinutes} min</span>
              </div>
            )}
            {(() => {
              const displayedServings = scaledServings ?? recipe.servings ?? 1;
              return (
                <div className="flex items-center gap-1 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setScaledServings(Math.max(1, displayedServings - 1))}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="font-medium min-w-[2ch] text-center">{displayedServings}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setScaledServings(displayedServings + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <span>servings</span>
                    {scaledServings !== null && scaledServings !== recipe.servings && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground ml-1"
                        onClick={() => setScaledServings(null)}
                      >
                        (reset)
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          )}

          {/* Tags — editable inline */}
          {editMode && draft ? (
            <div className="space-y-2">
              <Label className="text-xs">Tags</Label>
              <div className="flex flex-wrap items-center gap-2">
                {draft.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  placeholder="Add tag…"
                  className="h-8 w-32"
                />
              </div>
            </div>
          ) : (
            recipe.tags && recipe.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {recipe.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )
          )}

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              {editMode && draft ? (
                <div className="space-y-3">
                  {draft.instructions.map((inst, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground mt-1">
                        {i + 1}
                      </span>
                      <Textarea
                        value={inst.text}
                        rows={2}
                        onChange={(e) => {
                          const next = draft.instructions.slice();
                          next[i] = { ...next[i], text: e.target.value };
                          patchDraft({ instructions: next });
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => {
                          const next = draft.instructions.filter((_, idx) => idx !== i);
                          patchDraft({ instructions: next });
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => patchDraft({
                      instructions: [...draft.instructions, { step: draft.instructions.length + 1, text: '' }],
                    })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add step
                  </Button>
                </div>
              ) : (
                <ol className="space-y-4">
                  {(recipe.instructions ?? []).map((instruction, i) => (
                    <li key={i} className="flex gap-4">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground">
                        {instruction.step}
                      </span>
                      <p className="pt-0.5">{instruction.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Ingredients */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Ingredients</CardTitle>
                {recipe.ingredients && recipe.ingredients.length > 0 && (() => {
                  const summary = getStockSummary(recipe.ingredients, stockedItemIds);
                  if (summary.totalLinked === 0) return null;
                  const unlinked = summary.totalIngredients - summary.totalLinked;
                  return (
                    <span className="text-xs text-muted-foreground">
                      {summary.haveLinked}/{summary.totalLinked} linked in stock
                      {unlinked > 0 && ` (${unlinked} unlinked)`}
                    </span>
                  );
                })()}
              </div>
            </CardHeader>
            <CardContent>
              {editMode && draft ? (
                <div className="space-y-3">
                  {draft.ingredients.map((ing, i) => (
                    <div key={ing.id ?? i} className="space-y-1">
                      <div className="grid grid-cols-[5rem_5rem_1fr_2rem] gap-1 items-start">
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          value={ing.amount || ''}
                          placeholder="amt"
                          onChange={(e) => {
                            const next = draft.ingredients.slice();
                            next[i] = { ...next[i], amount: Number(e.target.value) || 0 };
                            patchDraft({ ingredients: next });
                          }}
                        />
                        <Input
                          value={ing.unit ?? ''}
                          placeholder="unit"
                          onChange={(e) => {
                            const next = draft.ingredients.slice();
                            next[i] = { ...next[i], unit: e.target.value };
                            patchDraft({ ingredients: next });
                          }}
                        />
                        <Input
                          value={ing.name ?? ''}
                          placeholder="ingredient"
                          onChange={(e) => {
                            const next = draft.ingredients.slice();
                            // Editing the name breaks the inventory link — clear it
                            // so the name and link can't silently drift apart.
                            const stillMatchesLink = e.target.value === next[i].linkedItemName;
                            next[i] = {
                              ...next[i],
                              name: e.target.value,
                              ...(stillMatchesLink ? {} : { inventoryItemId: undefined, linkedItemName: undefined }),
                            };
                            patchDraft({ ingredients: next });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              patchDraft({
                                ingredients: [...draft.ingredients, { id: `new-${Date.now()}`, name: '', amount: 0, unit: '', notes: undefined, inventoryItemId: undefined, linkedItemName: undefined }],
                              });
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => patchDraft({
                            ingredients: draft.ingredients.filter((_, idx) => idx !== i),
                          })}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 pl-1">
                        <Input
                          value={ing.notes ?? ''}
                          placeholder="notes (optional)"
                          className="h-7 text-xs"
                          onChange={(e) => {
                            const next = draft.ingredients.slice();
                            next[i] = { ...next[i], notes: e.target.value || undefined };
                            patchDraft({ ingredients: next });
                          }}
                        />
                        {ing.inventoryItemId && (
                          <span className="flex items-center gap-1 text-xs text-green-600 shrink-0">
                            <Link2 className="h-3 w-3" />
                            {ing.linkedItemName || 'linked'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  <Input
                    placeholder={'Add ingredient — e.g. "2 cups flour"'}
                    value={newIngredientLine}
                    onChange={(e) => setNewIngredientLine(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const line = newIngredientLine;
                        setNewIngredientLine('');
                        void quickAddIngredient(line);
                      }
                    }}
                  />
                </div>
              ) : (
              <ul className="space-y-2">
                {(recipe.ingredients ?? []).map((ingredient) => {
                  const scaledAmount = roundQuantity(
                    scaleQuantity(ingredient.amount, recipe.servings, scaledServings ?? recipe.servings),
                  );
                  const hasItem = ingredient.inventoryItemId
                    ? stockedItemIds.has(ingredient.inventoryItemId)
                    : null;
                  return (
                  <li key={ingredient.id} className="flex items-center gap-2">
                    {hasItem !== null && (
                      <span className={`h-2 w-2 rounded-full shrink-0 ${hasItem ? 'bg-green-500' : 'bg-red-500'}`} />
                    )}
                    <span className="font-medium shrink-0">
                      {scaledAmount} {ingredient.unit}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block">{getIngredientDisplayName(ingredient)}</span>
                      {ingredient.notes && (
                        <span className="block text-xs text-muted-foreground">{ingredient.notes}</span>
                      )}
                    </span>
                    {ingredient.optional && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        optional
                      </Badge>
                    )}
                    {ingredient.linkedItemName ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                            <Link2 className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2 text-xs" side="left">
                          Linked to: <span className="font-medium">{ingredient.linkedItemName}</span>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="text-destructive/60 hover:text-destructive transition-colors shrink-0">
                            <Link2Off className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-3" side="left">
                          <p className="text-xs font-medium mb-2">Link to catalog item</p>
                          <Combobox
                            options={existingItemOptions}
                            value=""
                            onValueChange={async (itemId) => {
                              if (!itemId || !id) return;
                              try {
                                await recipesApi.linkIngredient(id, ingredient.id, itemId);
                                queryClient.invalidateQueries({ queryKey: ['recipes', id] });
                              } catch (err) {
                                console.error('Failed to link:', err);
                              }
                            }}
                            placeholder="Search items..."
                            searchPlaceholder="Type to search..."
                            emptyText="No items found"
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </li>
                  );
                })}
              </ul>
              )}
            </CardContent>
          </Card>

          {/* Timers */}
          {recipe.timers && recipe.timers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Timers</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {recipe.timers.map((timer) => (
                    <li key={timer.id} className="flex items-center justify-between">
                      <span>{timer.name}</span>
                      <Badge variant="secondary">
                        {Math.floor(timer.durationSeconds / 60)} min
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Actions (hidden while editing — focus on the form) */}
          {!editMode && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setAddToMealPlanOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add to Meal Plan
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => addAllToShoppingListMutation.mutate()}
                disabled={addAllToShoppingListMutation.isPending || !recipe.ingredients?.length}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Add to Shopping List
              </Button>
            </CardContent>
          </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Recipe"
        description="Are you sure you want to delete this recipe? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleteMutation.mutate()}
      />

      <AddToMealPlanDialog
        open={addToMealPlanOpen}
        onOpenChange={setAddToMealPlanOpen}
        recipeId={id!}
        recipeTitle={recipe.title}
      />
    </div>
  );
}
