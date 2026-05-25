import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { calendarsApi } from '@/api/calendars';
import { formatTime } from '@/lib/utils';

export function TodaysEventsCard() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['events', 'today', todayStart.toISOString()],
    queryFn: () =>
      calendarsApi.getEvents({
        start: todayStart.toISOString(),
        end: todayEnd.toISOString(),
      }),
  });

  const { data: calendarsData } = useQuery({
    queryKey: ['calendars'],
    queryFn: calendarsApi.list,
  });

  const calendarColorById = new Map<string, string | undefined>(
    (calendarsData?.calendars ?? []).map((c) => [c.id, c.color ?? undefined])
  );

  return (
    <Card className="bg-info-muted/30 border-info/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold">Today's Events</CardTitle>
        <Calendar className="h-5 w-5 text-info" />
      </CardHeader>
      <CardContent>
        {eventsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : !eventsData?.events?.length ? (
          <p className="text-sm text-muted-foreground">Nothing on the calendar today</p>
        ) : (
          <div className="space-y-2">
            {eventsData.events.slice(0, 3).map((event) => {
              const accent = event.color || calendarColorById.get(event.calendarId) || 'hsl(var(--primary))';
              return (
                <div
                  key={event.id}
                  className="flex items-center gap-3 rounded-lg bg-background/70 p-2 pl-3 border-l-4"
                  style={{ borderLeftColor: accent }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{event.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTime(event.startTime)}
                    </div>
                  </div>
                </div>
              );
            })}
            {(eventsData?.events.length ?? 0) > 3 && (
              <Link to="/calendar" className="text-xs text-primary hover:underline">
                +{(eventsData?.events.length ?? 0) - 3} more
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
