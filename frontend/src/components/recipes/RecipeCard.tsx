import { Clock, Users, ChefHat } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Recipe } from '@/types/models';

interface RecipeCardProps {
  recipe: Recipe;
  onClick: () => void;
  onAddToMealPlan?: () => void;
}

export function RecipeCard({ recipe, onClick }: RecipeCardProps) {
  const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      {recipe.imageUrl ? (
        <div className="aspect-video relative overflow-hidden bg-muted">
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="object-cover w-full h-full"
          />
        </div>
      ) : (
        <div className="aspect-video bg-muted flex items-center justify-center">
          <ChefHat className="h-12 w-12 text-muted-foreground" />
        </div>
      )}
      <CardContent className="p-4">
        <h3 className="font-semibold text-lg mb-2 line-clamp-2">{recipe.title}</h3>
        {recipe.description && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
            {recipe.description}
          </p>
        )}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          {totalTime > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>{totalTime} min</span>
            </div>
          )}
          {recipe.servings && (
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{recipe.servings} servings</span>
            </div>
          )}
        </div>
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {recipe.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{recipe.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RecipeListItemProps {
  recipe: Recipe;
  onClick: () => void;
}

export function RecipeListItem({ recipe, onClick }: RecipeListItemProps) {
  const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);

  return (
    <div
      className="flex gap-4 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      {recipe.imageUrl ? (
        <div className="w-24 h-24 shrink-0 rounded-md overflow-hidden bg-muted">
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="object-cover w-full h-full"
          />
        </div>
      ) : (
        <div className="w-24 h-24 shrink-0 rounded-md bg-muted flex items-center justify-center">
          <ChefHat className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold mb-1">{recipe.title}</h3>
        {recipe.description && (
          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
            {recipe.description}
          </p>
        )}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {totalTime > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>{totalTime} min</span>
            </div>
          )}
          {recipe.servings && (
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              <span>{recipe.servings}</span>
            </div>
          )}
        </div>
      </div>
      {recipe.tags && recipe.tags.length > 0 && (
        <div className="hidden md:flex flex-wrap gap-1 items-start">
          {recipe.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
