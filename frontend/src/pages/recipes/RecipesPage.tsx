import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Grid, List, Search, Clock, Users, Upload, Camera, ChefHat } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { RecipeForm, type RecipeImageChange } from '@/components/recipes/RecipeForm';
import { ImportRecipeDialog } from './ImportRecipeDialog';
import { ImageParseDialog } from '@/components/image-parse';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import type { Recipe } from '@/types/models';
import type { RecipeFormData } from '@/types/forms';
import { toast } from '@/hooks/useToast';

type ViewMode = 'grid' | 'list';

export function RecipesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [canMakeFilter, setCanMakeFilter] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [imageParseOpen, setImageParseOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['recipes', search],
    queryFn: () => recipesApi.list({ search: search || undefined }),
  });

  const { data: availabilityData } = useQuery({
    queryKey: ['recipes', 'availability'],
    queryFn: recipesApi.getAvailability,
  });

  const createMutation = useMutation({
    mutationFn: async ({ formData, imageChange }: { formData: RecipeFormData; imageChange: RecipeImageChange }) => {
      const prepTime = formData.prepTime || formData.prepTimeMinutes;
      const cookTime = formData.cookTime || formData.cookTimeMinutes;

      // Create the recipe first
      const result = await recipesApi.create({
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

      // Upload image if provided
      const recipeId = result.recipe.id;
      if (imageChange.type === 'file' && imageChange.file) {
        await recipesApi.uploadImage(recipeId, imageChange.file);
      } else if (imageChange.type === 'url' && imageChange.url) {
        await recipesApi.uploadImageFromUrl(recipeId, imageChange.url);
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['tag-suggestions'] });
      setFormOpen(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create recipe',
        variant: 'destructive',
      });
    },
  });

  const allRecipes = data?.recipes || [];
  const recipes = canMakeFilter
    ? allRecipes.filter(r => {
        const avail = availabilityData?.availability?.[r.id];
        if (!avail || avail.total === 0) return false;
        return avail.have / avail.total >= 0.8;
      })
    : allRecipes;

  return (
    <div>
      <PageHeader
        title="Recipes"
        description="Your recipe collection"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImageParseOpen(true)}>
              <Camera className="mr-2 h-4 w-4" />
              Scan Image
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Recipe
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={canMakeFilter ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCanMakeFilter(!canMakeFilter)}
          >
            <ChefHat className="mr-1.5 h-4 w-4" />
            Can make now
          </Button>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="grid">
              <Grid className="h-4 w-4" />
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="h-4 w-4" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        </div>
      </div>

      {/* Recipe list */}
      {isLoading ? (
        <div className={cn('grid gap-4', viewMode === 'grid' ? 'sm:grid-cols-2 lg:grid-cols-3' : '')}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={viewMode === 'grid' ? 'h-64' : 'h-24'} />
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <EmptyState
          title="No recipes yet"
          description="Add your first recipe to get started"
          action={
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Recipe
            </Button>
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {recipes.map((recipe) => (
            <RecipeListItem key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}

      <RecipeForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={(formData, imageChange) => createMutation.mutate({ formData, imageChange })}
        isSubmitting={createMutation.isPending}
      />

      <ImportRecipeDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={(recipeId) => navigate(`/recipes/${recipeId}`)}
      />

      <ImageParseDialog
        open={imageParseOpen}
        onOpenChange={setImageParseOpen}
        defaultType="recipe"
        onSuccess={(type, createdIds) => {
          if (createdIds.length > 0) {
            navigate(`/recipes/${createdIds[0]}`);
          }
        }}
      />
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  // Prefer imageData over imageUrl for backward compatibility
  const imageSrc = recipe.imageData
    ? `data:${recipe.imageMimeType};base64,${recipe.imageData}`
    : recipe.imageUrl;

  return (
    <Link to={`/recipes/${recipe.id}`}>
      <Card className="overflow-hidden transition-shadow hover:shadow-md">
        {imageSrc ? (
          <div className="aspect-video bg-muted">
            <img
              src={imageSrc}
              alt={recipe.title}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-video flex items-center justify-center bg-muted">
            <span className="text-4xl">🍳</span>
          </div>
        )}
        <CardContent className="p-4">
          <h3 className="font-semibold line-clamp-1">{recipe.title}</h3>
          {recipe.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {recipe.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
            {recipe.totalTimeMinutes && (
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{recipe.totalTimeMinutes} min</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{recipe.servings}</span>
            </div>
          </div>
          {recipe.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {recipe.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function RecipeListItem({ recipe }: { recipe: Recipe }) {
  // Prefer imageData over imageUrl for backward compatibility
  const imageSrc = recipe.imageData
    ? `data:${recipe.imageMimeType};base64,${recipe.imageData}`
    : recipe.imageUrl;

  return (
    <Link to={`/recipes/${recipe.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center gap-4 p-4">
          {imageSrc ? (
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
              <img
                src={imageSrc}
                alt={recipe.title}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
              <span className="text-2xl">🍳</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{recipe.title}</h3>
            {recipe.description && (
              <p className="text-sm text-muted-foreground line-clamp-1">
                {recipe.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {recipe.totalTimeMinutes && (
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{recipe.totalTimeMinutes} min</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{recipe.servings}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
