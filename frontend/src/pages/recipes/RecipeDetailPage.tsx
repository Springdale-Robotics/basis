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
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { RecipeForm } from '@/components/recipes/RecipeForm';
import { recipesApi } from '@/api/recipes';
import { useState, useMemo } from 'react';
import type { RecipeFormData } from '@/types/forms';

export function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['recipes', id],
    queryFn: () => recipesApi.get(id!),
    enabled: !!id,
  });

  // Merge ingredients from separate API response into recipe object
  // Memoize to prevent useEffect in RecipeForm from resetting on every render
  const recipe = useMemo(() => {
    if (!data?.recipe) return undefined;
    return {
      ...data.recipe,
      ingredients: (data.ingredients || []).map((ing) => ({
        id: (ing as any).id || crypto.randomUUID(),
        name: ing.name,
        amount: Number(ing.quantity) || 0,
        unit: ing.unit || '',
        notes: ing.notes,
        optional: false,
        inventoryItemId: ing.inventoryItemId,
      })),
    };
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: (formData: RecipeFormData) => {
      const prepTime = formData.prepTime || formData.prepTimeMinutes;
      const cookTime = formData.cookTime || formData.cookTimeMinutes;
      return recipesApi.update(id!, {
        title: formData.title,
        description: formData.description || undefined,
        servings: formData.servings || undefined,
        prepTimeMinutes: prepTime && prepTime > 0 ? prepTime : undefined,
        cookTimeMinutes: cookTime && cookTime > 0 ? cookTime : undefined,
        ingredients: formData.ingredients
          .filter((ing) => ing.name)
          .map((ing) => ({
            name: ing.name,
            quantity: ing.amount || undefined,
            unit: ing.unit || undefined,
            notes: ing.notes || undefined,
            inventoryItemId: ing.inventoryItemId || undefined,
          })),
        instructions: formData.instructions.filter((inst) => inst.text),
        tags: formData.tags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes', id] });
      queryClient.invalidateQueries({ queryKey: ['tag-suggestions'] });
      setEditFormOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => recipesApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['tag-suggestions'] });
      navigate('/recipes');
    },
  });

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
        title={recipe.title}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditFormOpen(true)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
            <Button asChild>
              <Link to={`/recipes/${id}/cook`}>
                <PlayCircle className="mr-2 h-4 w-4" />
                Start Cooking
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Image */}
          {recipe.imageUrl && (
            <div className="aspect-video overflow-hidden rounded-lg bg-muted">
              <img
                src={recipe.imageUrl}
                alt={recipe.title}
                className="h-full w-full object-cover"
              />
            </div>
          )}

          {/* Description */}
          {recipe.description && (
            <p className="text-muted-foreground">{recipe.description}</p>
          )}

          {/* Info badges */}
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
            <div className="flex items-center gap-1 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{recipe.servings} servings</span>
            </div>
          </div>

          {/* Tags */}
          {recipe.tags && recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {recipe.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Ingredients */}
          <Card>
            <CardHeader>
              <CardTitle>Ingredients</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {(recipe.ingredients ?? []).map((ingredient) => (
                  <li key={ingredient.id} className="flex items-center gap-2">
                    <span className="font-medium">
                      {ingredient.amount} {ingredient.unit}
                    </span>
                    <span>{ingredient.name}</span>
                    {ingredient.optional && (
                      <Badge variant="outline" className="text-xs">
                        optional
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
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

          {/* Actions */}
          <Card>
            <CardContent className="p-4">
              <Button className="w-full" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add to Meal Plan
              </Button>
            </CardContent>
          </Card>
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

      <RecipeForm
        open={editFormOpen}
        onOpenChange={setEditFormOpen}
        recipe={recipe}
        onSubmit={(formData) => updateMutation.mutate(formData)}
        isSubmitting={updateMutation.isPending}
      />
    </div>
  );
}
