import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Calendar, ChefHat, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { calendarsApi } from '@/api/calendars';
import { recipesApi } from '@/api/recipes';
import { useAuth } from '@/hooks/useAuth';
import { formatTime } from '@/lib/utils';

function greetingFor(date: Date) {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function TodayHero() {
  const { user } = useAuth();
  const now = new Date();
  const firstName = user?.displayName?.split(' ')[0] || 'there';

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: eventsData } = useQuery({
    queryKey: ['events', 'today', todayStart.toISOString()],
    queryFn: () =>
      calendarsApi.getEvents({
        start: todayStart.toISOString(),
        end: todayEnd.toISOString(),
      }),
  });

  const todayDateString = `${todayStart.getFullYear()}-${String(todayStart.getMonth() + 1).padStart(2, '0')}-${String(todayStart.getDate()).padStart(2, '0')}`;
  const { data: mealPlans } = useQuery({
    queryKey: ['meal-plans', todayDateString],
    queryFn: () => recipesApi.getMealPlans({ start: todayDateString, end: todayDateString }),
  });

  const dinner = mealPlans?.mealPlans?.find((m) => m.mealType === 'dinner');
  const lunch = mealPlans?.mealPlans?.find((m) => m.mealType === 'lunch');
  const breakfast = mealPlans?.mealPlans?.find((m) => m.mealType === 'breakfast');

  const hour = now.getHours();
  const featuredMeal =
    hour < 10 ? breakfast || lunch || dinner :
    hour < 14 ? lunch || dinner || breakfast :
    dinner || lunch || breakfast;

  const nextEvent = (eventsData?.events ?? [])
    .filter((e) => new Date(e.endTime).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/15 via-background to-accent/10 p-6 md:p-8 mb-6">
      <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-accent/10 blur-3xl" aria-hidden />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{formatLongDate(now)}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">
            {greetingFor(now)}, {firstName}
          </h1>
        </div>
        <Button asChild size="lg" className="rounded-full shadow-sm">
          <Link to="/calendar">
            <Plus className="mr-2 h-4 w-4" />
            Add Event
          </Link>
        </Button>
      </div>

      <div className="relative mt-6 grid gap-3 md:grid-cols-2">
        {featuredMeal?.recipe ? (
          <Link
            to={`/recipes/${featuredMeal.recipeId}/cook`}
            className="group flex items-center gap-4 rounded-xl bg-background/70 p-3 backdrop-blur hover:bg-background transition-colors"
          >
            {featuredMeal.recipe.imageUrl ? (
              <img
                src={featuredMeal.recipe.imageUrl}
                alt=""
                className="h-16 w-16 rounded-lg object-cover shrink-0"
              />
            ) : (
              <div className="h-16 w-16 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
                <ChefHat className="h-7 w-7 text-success" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {featuredMeal.mealType === 'breakfast' ? 'Breakfast' :
                 featuredMeal.mealType === 'lunch' ? 'Lunch' :
                 featuredMeal.mealType === 'dinner' ? 'Tonight' : 'Snack'}
              </div>
              <div className="text-base font-semibold truncate group-hover:text-primary transition-colors">
                {featuredMeal.recipe.title}
              </div>
            </div>
          </Link>
        ) : (
          <Link
            to="/meal-plan"
            className="flex items-center gap-4 rounded-xl bg-background/70 p-3 backdrop-blur hover:bg-background transition-colors"
          >
            <div className="h-16 w-16 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
              <ChefHat className="h-7 w-7 text-success" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mealtime
              </div>
              <div className="text-base font-semibold text-muted-foreground">
                Nothing planned yet — pick something
              </div>
            </div>
          </Link>
        )}

        {nextEvent ? (
          <Link
            to="/calendar"
            className="group flex items-center gap-4 rounded-xl bg-background/70 p-3 backdrop-blur hover:bg-background transition-colors"
          >
            <div
              className="h-16 w-16 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${nextEvent.color || 'hsl(var(--info))'}25` }}
            >
              <Calendar
                className="h-7 w-7"
                style={{ color: nextEvent.color || 'hsl(var(--info))' }}
              />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {nextEvent.allDay ? 'Today' : `Next up · ${formatTime(nextEvent.startTime)}`}
              </div>
              <div className="text-base font-semibold truncate group-hover:text-primary transition-colors">
                {nextEvent.title}
              </div>
            </div>
          </Link>
        ) : (
          <Link
            to="/calendar"
            className="flex items-center gap-4 rounded-xl bg-background/70 p-3 backdrop-blur hover:bg-background transition-colors"
          >
            <div className="h-16 w-16 rounded-lg bg-info/15 flex items-center justify-center shrink-0">
              <Calendar className="h-7 w-7 text-info" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Today
              </div>
              <div className="text-base font-semibold text-muted-foreground">
                A clear day on the calendar
              </div>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
