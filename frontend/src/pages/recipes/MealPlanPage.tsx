import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, ShoppingCart } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
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
    <div className="flex flex-col h-full">
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
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={navigatePrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={navigateNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
          Today
        </Button>
        <span className="ml-2 text-sm font-semibold">{weekLabel}</span>
      </div>

      {/* Meal plan grid */}
      {isLoading ? (
        <div className="grid grid-cols-8 gap-px bg-border flex-1">
          {Array.from({ length: 40 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto flex-1">
          <div className="min-w-[800px] h-full flex flex-col border rounded-md overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-8 bg-muted/50 border-b">
              <div className="p-2 text-xs font-medium text-muted-foreground border-r" />
              {days.map((day, i) => {
                const isToday = formatLocalDate(day) === formatLocalDate(new Date());
                return (
                  <div
                    key={formatLocalDate(day)}
                    className={cn(
                      'p-2 text-center border-r last:border-r-0',
                      isToday && 'bg-primary/10'
                    )}
                  >
                    <div className="text-xs text-muted-foreground">
                      {day.toLocaleDateString(undefined, { weekday: 'short' })}
                    </div>
                    <div
                      className={cn(
                        'text-sm font-medium',
                        isToday && 'text-primary'
                      )}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Meal rows */}
            {mealTypes.map((mealType, rowIndex) => (
              <div
                key={mealType}
                className={cn(
                  'grid grid-cols-8 flex-1',
                  rowIndex < mealTypes.length - 1 && 'border-b'
                )}
              >
                {/* Meal type label */}
                <div className="p-2 flex items-center border-r bg-muted/30">
                  <span className="text-xs font-medium text-muted-foreground capitalize">
                    {mealType}
                  </span>
                </div>

                {/* Day cells */}
                {days.map((day, dayIndex) => {
                  const meals = getMealsForDay(day, mealType);
                  const isToday = formatLocalDate(day) === formatLocalDate(new Date());
                  return (
                    <div
                      key={`${formatLocalDate(day)}-${mealType}`}
                      className={cn(
                        'p-1 cursor-pointer transition-colors hover:bg-muted/50 border-r last:border-r-0 min-h-[60px]',
                        isToday && 'bg-primary/5'
                      )}
                      onClick={() => handleCellClick(day, mealType)}
                    >
                      {meals.length > 0 ? (
                        <div className="space-y-0.5">
                          {meals.map((meal) => (
                            <div
                              key={meal.id}
                              className={cn(
                                'rounded-sm px-1.5 py-0.5 text-xs truncate',
                                meal.cookedAt
                                  ? 'bg-green-500/15 text-green-700 line-through opacity-70'
                                  : 'bg-primary/15'
                              )}
                            >
                              {meal.cookedAt && <span className="mr-0.5">✓</span>}
                              {meal.recipe?.title}
                              {meal.servingsMultiplier && Number(meal.servingsMultiplier) !== 1 && (
                                <span className="ml-1 opacity-60">
                                  {meal.servingsMultiplier}x
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <Plus className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
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
