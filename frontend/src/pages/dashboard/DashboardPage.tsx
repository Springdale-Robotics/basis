import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Calendar,
  ChefHat,
  AlertTriangle,
  CheckSquare,
  Bell,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { calendarsApi } from '@/api/calendars';
import { recipesApi } from '@/api/recipes';
import { inventoryApi } from '@/api/inventory';
import { tasksApi } from '@/api/tasks';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatTime } from '@/lib/utils';

export function DashboardPage() {
  const { user } = useAuth();

  // Fetch today's events
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', 'today', todayStart.toISOString()],
    queryFn: () => calendarsApi.getEvents({
      start: todayStart.toISOString(),
      end: todayEnd.toISOString()
    }),
  });

  // Fetch today's meal plans
  const todayDateString = todayStart.toISOString().split('T')[0];
  const { data: mealPlans, isLoading: mealsLoading } = useQuery({
    queryKey: ['meal-plans', todayDateString],
    queryFn: () => recipesApi.getMealPlans({ start: todayDateString, end: todayDateString }),
  });

  // Fetch expiring items
  const { data: expiringItems, isLoading: expiringLoading } = useQuery({
    queryKey: ['inventory', 'expiring'],
    queryFn: () => inventoryApi.getExpiringItems(7),
  });

  // Fetch pending tasks
  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'pending'],
    queryFn: () => tasksApi.list({ status: 'pending', limit: 5 }),
  });

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.displayName?.split(' ')[0] || 'User'}`}
        description={formatDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          <Button asChild>
            <Link to="/calendar">
              <Plus className="mr-2 h-4 w-4" />
              Add Event
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Today's Events */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Events</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {eventsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : !eventsData?.events?.length ? (
              <p className="text-sm text-muted-foreground">No events today</p>
            ) : (
              <div className="space-y-2">
                {eventsData.events.slice(0, 3).map((event) => (
                  <div key={event.id} className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    <span className="text-sm font-medium">{event.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(event.startTime)}
                    </span>
                  </div>
                ))}
                {(eventsData?.events.length ?? 0) > 3 && (
                  <Link to="/calendar" className="text-xs text-primary hover:underline">
                    +{(eventsData?.events.length ?? 0) - 3} more
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Meals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Meals</CardTitle>
            <ChefHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {mealsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : !mealPlans?.mealPlans?.length ? (
              <div>
                <p className="text-sm text-muted-foreground">No meals planned</p>
                <Button variant="link" className="h-auto p-0 text-xs" asChild>
                  <Link to="/meal-plan">Plan meals</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {mealPlans.mealPlans.map((meal) => (
                  <div key={meal.id} className="flex items-center justify-between">
                    <div>
                      <Badge variant="outline" className="text-xs capitalize">
                        {meal.mealType}
                      </Badge>
                      <p className="text-sm font-medium">{meal.recipe?.title}</p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/recipes/${meal.recipeId}/cook`}>Cook</Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expiring Soon */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {expiringLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : !expiringItems?.expiring?.length ? (
              <p className="text-sm text-muted-foreground">No items expiring soon</p>
            ) : (
              <div className="space-y-2">
                {expiringItems.expiring.slice(0, 3).map((stockEntry) => (
                  <div key={stockEntry.id} className="flex items-center justify-between">
                    <span className="text-sm">{stockEntry.item?.name || 'Unknown'}</span>
                    <Badge variant="destructive" className="text-xs">
                      {stockEntry.expiryDate
                        ? formatDate(stockEntry.expiryDate, { month: 'short', day: 'numeric' })
                        : 'Soon'}
                    </Badge>
                  </div>
                ))}
                {expiringItems.expiring.length > 3 && (
                  <Link to="/inventory" className="text-xs text-primary hover:underline">
                    +{expiringItems.expiring.length - 3} more
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Tasks */}
        <Card className="md:col-span-2 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
              <CardDescription>Your tasks that need attention</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/tasks">
                View All
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {tasksLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !tasksData?.tasks?.length ? (
              <p className="text-sm text-muted-foreground">No pending tasks</p>
            ) : (
              <div className="space-y-2">
                {tasksData.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <CheckSquare className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{task.title}</p>
                        {task.dueDate && (
                          <p className="text-xs text-muted-foreground">
                            Due {formatDate(task.dueDate)}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={
                        task.priority === 'high'
                          ? 'destructive'
                          : task.priority === 'medium'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {task.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
