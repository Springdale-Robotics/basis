import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import { GenerateShoppingListDialog } from './GenerateShoppingListDialog';
import { AddMealDialog } from './AddMealDialog';
import type { MealPlan } from '@/types/models';

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type MealType = (typeof mealTypes)[number];

// Format date in local timezone (YYYY-MM-DD)
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function MealPlanPage() {
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day;
    return new Date(today.setDate(diff));
  });
  const [shoppingListDialogOpen, setShoppingListDialogOpen] = useState(false);
  const [addMealDialogOpen, setAddMealDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('breakfast');

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const weekStartStr = formatLocalDate(weekStart);
  const weekEndStr = formatLocalDate(weekEnd);

  const { data: mealPlans, isLoading } = useQuery({
    queryKey: ['meal-plans', weekStartStr, weekEndStr],
    queryFn: () =>
      recipesApi.getMealPlans({
        start: weekStartStr,
        end: weekEndStr,
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

  const getMealsForDay = (date: Date, mealType: string): MealPlan[] => {
    const dateStr = formatLocalDate(date);
    return mealPlansList.filter(
      (meal) => meal.plannedDate === dateStr && meal.mealType === mealType
    );
  };

  const handleCellClick = (date: Date, mealType: MealType) => {
    setSelectedDate(date);
    setSelectedMealType(mealType);
    setAddMealDialogOpen(true);
  };

  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${weekEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  // Get existing meals for the selected date/mealType
  const existingMeals = selectedDate
    ? getMealsForDay(selectedDate, selectedMealType)
    : [];

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
                const isToday = formatLocalDate(day) === formatLocalDate(new Date());
                return (
                  <div
                    key={formatLocalDate(day)}
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
                      key={`${formatLocalDate(day)}-${mealType}`}
                      className="min-h-20 cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => handleCellClick(day, mealType)}
                    >
                      <CardContent className="p-2">
                        {meals.length > 0 ? (
                          <div className="space-y-1">
                            {meals.map((meal) => (
                              <div
                                key={meal.id}
                                className="rounded bg-primary/10 p-1 text-xs truncate"
                              >
                                {meal.recipe?.title}
                                {meal.servingsMultiplier && Number(meal.servingsMultiplier) !== 1 && (
                                  <span className="ml-1 text-muted-foreground">
                                    ({meal.servingsMultiplier}x)
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
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

      {selectedDate && (
        <AddMealDialog
          open={addMealDialogOpen}
          onOpenChange={setAddMealDialogOpen}
          date={selectedDate}
          mealType={selectedMealType}
          existingMeals={existingMeals}
        />
      )}
    </div>
  );
}
