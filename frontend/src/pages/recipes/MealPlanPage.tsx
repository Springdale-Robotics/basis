import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import { GenerateShoppingListDialog } from './GenerateShoppingListDialog';

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export function MealPlanPage() {
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day;
    return new Date(today.setDate(diff));
  });
  const [shoppingListDialogOpen, setShoppingListDialogOpen] = useState(false);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const { data: mealPlans, isLoading } = useQuery({
    queryKey: ['meal-plans', weekStart.toISOString(), weekEnd.toISOString()],
    queryFn: () =>
      recipesApi.getMealPlans({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
      }),
  });

  const navigatePrev = () => {
    const newDate = new Date(weekStart);
    newDate.setDate(newDate.getDate() - 7);
    setWeekStart(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(weekStart);
    newDate.setDate(newDate.getDate() + 7);
    setWeekStart(newDate);
  };

  const goToCurrentWeek = () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day;
    setWeekStart(new Date(today.setDate(diff)));
  };

  // Generate days of the week
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    return date;
  });

  const mealPlansList = mealPlans?.mealPlans || [];

  const getMealsForDay = (date: Date, mealType: string) => {
    return mealPlansList.filter(
      (meal) =>
        new Date(meal.date).toDateString() === date.toDateString() &&
        meal.mealType === mealType
    );
  };

  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${weekEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <div>
      <PageHeader
        title="Meal Plan"
        description="Plan your meals for the week"
        actions={
          <Button onClick={() => setShoppingListDialogOpen(true)}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Generate Shopping List
          </Button>
        }
      />

      {/* Navigation */}
      <div className="mb-6 flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={navigatePrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={navigateNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={goToCurrentWeek}>
          Today
        </Button>
        <span className="ml-2 font-semibold">{weekLabel}</span>
      </div>

      {/* Meal plan grid */}
      {isLoading ? (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 28 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {/* Header */}
            <div className="mb-2 grid grid-cols-8 gap-2">
              <div />
              {days.map((day) => {
                const isToday = day.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'text-center font-medium',
                      isToday && 'text-primary'
                    )}
                  >
                    <div className="text-xs text-muted-foreground">
                      {day.toLocaleDateString(undefined, { weekday: 'short' })}
                    </div>
                    <div className={cn(isToday && 'rounded-full bg-primary text-primary-foreground inline-flex h-6 w-6 items-center justify-center')}>
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Meal rows */}
            {mealTypes.map((mealType) => (
              <div key={mealType} className="mb-2 grid grid-cols-8 gap-2">
                <div className="flex items-center">
                  <Badge variant="outline" className="capitalize">
                    {mealType}
                  </Badge>
                </div>
                {days.map((day) => {
                  const meals = getMealsForDay(day, mealType);
                  return (
                    <Card
                      key={`${day.toISOString()}-${mealType}`}
                      className="min-h-20 cursor-pointer transition-colors hover:bg-muted/50"
                    >
                      <CardContent className="p-2">
                        {meals.length > 0 ? (
                          meals.map((meal) => (
                            <div
                              key={meal.id}
                              className="rounded bg-primary/10 p-1 text-xs"
                            >
                              {meal.recipe?.title}
                            </div>
                          ))
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Plus className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <GenerateShoppingListDialog
        open={shoppingListDialogOpen}
        onOpenChange={setShoppingListDialogOpen}
        startDate={weekStart}
        endDate={weekEnd}
      />
    </div>
  );
}
