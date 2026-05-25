import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ShoppingCart,
  Coffee,
  Sandwich,
  UtensilsCrossed,
  Cookie,
  ChefHat,
  Check,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { recipesApi } from '@/api/recipes';
import { cn } from '@/lib/utils';
import { formatMultiplier, formatServings } from '@/lib/servings';
import { GenerateShoppingListDialog } from './GenerateShoppingListDialog';
import { AddMealDialog } from './AddMealDialog';
import { MealActionDialog } from './MealActionDialog';
import type { MealPlan, Recipe } from '@/types/models';

const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type MealType = (typeof mealTypes)[number];

const mealMeta: Record<
  MealType,
  { label: string; icon: typeof Coffee; tint: string }
> = {
  breakfast: { label: 'Breakfast', icon: Coffee, tint: 'text-amber-500' },
  lunch: { label: 'Lunch', icon: Sandwich, tint: 'text-orange-500' },
  dinner: { label: 'Dinner', icon: UtensilsCrossed, tint: 'text-rose-500' },
  snack: { label: 'Snack', icon: Cookie, tint: 'text-violet-500' },
};

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function recipeImageSrc(recipe: Recipe | undefined): string | undefined {
  if (!recipe) return undefined;
  if (recipe.imageData) {
    return `data:${recipe.imageMimeType};base64,${recipe.imageData}`;
  }
  return recipe.imageUrl;
}

export function MealPlanPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [shoppingListDialogOpen, setShoppingListDialogOpen] = useState(false);
  const [addMealDialogOpen, setAddMealDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedMealType, setSelectedMealType] = useState<MealType>('breakfast');
  const [activeMeal, setActiveMeal] = useState<MealPlan | null>(null);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const weekStartStr = formatLocalDate(weekStart);
  const weekEndStr = formatLocalDate(weekEnd);

  const { data: mealPlans, isLoading } = useQuery({
    queryKey: ['meal-plans', weekStartStr, weekEndStr],
    queryFn: () =>
      recipesApi.getMealPlans({ start: weekStartStr, end: weekEndStr }),
  });

  const navigatePrev = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const navigateNext = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const goToCurrentWeek = () => setWeekStart(startOfWeek(new Date()));

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [weekStart]
  );

  const mealPlansList = mealPlans?.mealPlans || [];

  const getMealsForDay = (date: Date, mealType: MealType): MealPlan[] => {
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

  const todayStr = formatLocalDate(new Date());
  const totalMealsThisWeek = mealPlansList.length;

  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })} – ${weekEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  const existingMeals =
    selectedDate ? getMealsForDay(selectedDate, selectedMealType) : [];

  return (
    <div className="flex flex-col h-full min-w-0">
      <PageHeader
        title="Meal Plan"
        description="Plan your week — drop in recipes and generate a shopping list."
        actions={
          <Button
            onClick={() => setShoppingListDialogOpen(true)}
            disabled={totalMealsThisWeek === 0}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Generate Shopping List
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border bg-card">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-r-none h-9 px-2.5"
            onClick={navigatePrev}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="rounded-l-none h-9 px-2.5"
            onClick={navigateNext}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
          Today
        </Button>
        <div className="ml-1 text-sm font-semibold tracking-tight">
          {weekLabel}
        </div>
        {totalMealsThisWeek > 0 && (
          <div className="ml-auto text-xs text-muted-foreground">
            {totalMealsThisWeek} meal{totalMealsThisWeek === 1 ? '' : 's'} planned
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 min-w-0 overflow-auto rounded-lg border bg-card">
        <div
          className="min-w-[880px] grid h-full"
          style={{
            gridTemplateColumns: '92px repeat(7, minmax(0, 1fr))',
            gridTemplateRows: 'auto repeat(4, minmax(150px, 1fr))',
          }}
        >
          {/* Header row */}
          <div className="border-b border-r bg-muted/40" />
          {days.map((day) => {
            const isToday = formatLocalDate(day) === todayStr;
            return (
              <div
                key={formatLocalDate(day)}
                className={cn(
                  'border-b last:border-r-0 border-r p-2 text-center bg-muted/40',
                  isToday && 'bg-primary/5'
                )}
              >
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div className="mt-1 flex items-center justify-center">
                  <span
                    className={cn(
                      'inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2 text-sm font-semibold',
                      isToday
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground'
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Meal rows */}
          {mealTypes.map((mealType, rowIdx) => {
            const meta = mealMeta[mealType];
            const Icon = meta.icon;
            const isLastRow = rowIdx === mealTypes.length - 1;
            return (
              <div key={mealType} className="contents">
                {/* Row label */}
                <div
                  className={cn(
                    'flex items-center gap-2 border-r bg-muted/20 px-3',
                    !isLastRow && 'border-b'
                  )}
                >
                  <Icon className={cn('h-4 w-4', meta.tint)} />
                  <span className="text-sm font-medium">{meta.label}</span>
                </div>

                {/* Day cells */}
                {days.map((day) => {
                  const meals = getMealsForDay(day, mealType);
                  const isToday = formatLocalDate(day) === todayStr;
                  const compact = meals.length >= 3;
                  return (
                    <div
                      key={`${formatLocalDate(day)}-${mealType}`}
                      className={cn(
                        'group relative flex flex-col gap-1.5 p-1.5 border-r last:border-r-0',
                        !isLastRow && 'border-b',
                        isToday ? 'bg-primary/[0.03]' : 'bg-card'
                      )}
                    >
                      {isLoading ? (
                        <Skeleton className="h-full w-full opacity-40" />
                      ) : meals.length > 0 ? (
                        <>
                          <div
                            className={cn(
                              'flex flex-1 min-h-0 flex-col',
                              compact ? 'gap-1' : 'gap-1.5'
                            )}
                          >
                            {meals.map((meal) => (
                              <MealChip
                                key={meal.id}
                                meal={meal}
                                compact={compact}
                                onOpen={() => setActiveMeal(meal)}
                              />
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCellClick(day, mealType)}
                            className={cn(
                              'flex items-center gap-1 self-end rounded text-[11px] text-muted-foreground opacity-0 transition-opacity',
                              'hover:text-primary group-hover:opacity-100',
                              'focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40'
                            )}
                            aria-label="Add another recipe"
                          >
                            <Plus className="h-3 w-3" />
                            Add
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCellClick(day, mealType)}
                          className={cn(
                            'flex h-full w-full items-center justify-center text-muted-foreground/60 transition-colors',
                            'hover:bg-muted/40 hover:text-primary',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset'
                          )}
                          aria-label={`Add ${mealType} for ${day.toLocaleDateString()}`}
                        >
                          <Plus className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

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

      {activeMeal && (
        <MealActionDialog
          open={!!activeMeal}
          onOpenChange={(o) => {
            if (!o) setActiveMeal(null);
          }}
          meal={
            // Use the freshest copy from the query cache so servings updates
            // applied via the dialog re-render immediately.
            mealPlansList.find((m) => m.id === activeMeal.id) ?? activeMeal
          }
        />
      )}
    </div>
  );
}

function MealChip({
  meal,
  compact,
  onOpen,
}: {
  meal: MealPlan;
  compact: boolean;
  onOpen: () => void;
}) {
  const imageSrc = recipeImageSrc(meal.recipe);
  const cooked = !!meal.cookedAt;
  const multiplier = meal.servingsMultiplier
    ? Number(meal.servingsMultiplier)
    : 1;
  const baseServings = meal.recipe?.servings ?? null;
  const effectiveServings =
    baseServings != null ? baseServings * multiplier : null;
  const scaled = Math.abs(multiplier - 1) > 1e-4;

  const servingsLabel =
    effectiveServings != null ? formatServings(effectiveServings) : null;
  const ariaServings =
    effectiveServings != null
      ? `${servingsLabel} servings${scaled ? ` (${formatMultiplier(multiplier)}× recipe)` : ''}`
      : undefined;

  const titleAttr = [
    meal.recipe?.title,
    ariaServings,
  ]
    .filter(Boolean)
    .join(' — ');

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen();
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={titleAttr}
        className={cn(
          'flex items-center gap-1.5 rounded border bg-card px-1.5 py-1 text-left transition-all',
          'hover:border-primary/40 hover:shadow-sm hover:bg-accent/30',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          cooked && 'opacity-70'
        )}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className="h-6 w-6 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10">
            <ChefHat className="h-3 w-3 text-primary" />
          </div>
        )}
        <div
          className={cn(
            'flex-1 min-w-0 truncate text-xs font-medium leading-tight',
            cooked && 'line-through text-muted-foreground'
          )}
        >
          {meal.recipe?.title}
        </div>
        {servingsLabel && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground',
              scaled && 'text-primary'
            )}
          >
            <Users className="h-3 w-3" />
            {servingsLabel}
          </span>
        )}
        {cooked && <Check className="h-3 w-3 shrink-0 text-emerald-600" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={titleAttr}
      className={cn(
        'group/chip flex flex-col overflow-hidden rounded-md border bg-card text-left transition-all',
        'hover:border-primary/40 hover:shadow-sm',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        cooked && 'opacity-70'
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/5">
            <ChefHat className="h-5 w-5 text-primary/60" />
          </div>
        )}
        {cooked && (
          <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
            <Check className="h-2.5 w-2.5" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-1.5 py-1">
        <div
          className={cn(
            'text-xs font-medium leading-snug line-clamp-2 overflow-hidden',
            cooked && 'line-through text-muted-foreground'
          )}
        >
          {meal.recipe?.title}
        </div>
        {servingsLabel && (
          <div
            className={cn(
              'flex items-center gap-1 text-[10px] leading-tight text-muted-foreground',
              scaled && 'text-primary'
            )}
          >
            <Users className="h-3 w-3" />
            <span className="tabular-nums">{servingsLabel} servings</span>
            {scaled && (
              <span className="text-muted-foreground/70">· {formatMultiplier(multiplier)}×</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
