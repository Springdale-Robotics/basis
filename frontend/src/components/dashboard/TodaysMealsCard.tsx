import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChefHat } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { recipesApi } from '@/api/recipes';

const MEAL_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export function TodaysMealsCard() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayDateString = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;

  const { data: mealPlans, isLoading: mealsLoading } = useQuery({
    queryKey: ['meal-plans', todayDateString],
    queryFn: () => recipesApi.getMealPlans({ start: todayDateString, end: todayDateString }),
  });

  return (
    <Card className="bg-success-muted/30 border-success/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold">Today's Meals</CardTitle>
        <ChefHat className="h-5 w-5 text-success" />
      </CardHeader>
      <CardContent>
        {mealsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-3/4" />
          </div>
        ) : !mealPlans?.mealPlans?.length ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">No meals planned yet</p>
            <Button variant="link" className="h-auto p-0 text-sm" asChild>
              <Link to="/meal-plan">Plan something tasty →</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((mealType) => {
              const mealsOfType = mealPlans.mealPlans.filter((m) => m.mealType === mealType);
              if (mealsOfType.length === 0) return null;
              return (
                <div key={mealType} className="space-y-1.5">
                  <div className="text-xs font-semibold text-muted-foreground tracking-wide">
                    {MEAL_LABEL[mealType]}
                  </div>
                  {mealsOfType.map((meal) => (
                    <div
                      key={meal.id}
                      className="flex items-center gap-3 rounded-lg bg-background/70 p-2"
                    >
                      {meal.recipe?.imageUrl ? (
                        <img
                          src={meal.recipe.imageUrl}
                          alt=""
                          className="h-12 w-12 rounded-md object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-md bg-success/10 flex items-center justify-center shrink-0">
                          <ChefHat className="h-5 w-5 text-success" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{meal.recipe?.title}</div>
                      </div>
                      <Button variant="outline" size="sm" asChild className="shrink-0">
                        <Link to={`/recipes/${meal.recipeId}/cook`}>Cook</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
