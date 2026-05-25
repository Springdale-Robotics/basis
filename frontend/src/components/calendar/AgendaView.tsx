import { useMemo } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { resolveEventColor, isSameDay, startOfDay } from './calendar-utils';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

interface AgendaViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  colorPalette: string;
  onEventClick: (event: CalendarEvent) => void;
}

// Group events by day across the visible window. For each event that spans
// multiple days, list it once per day it touches.
export function AgendaView({
  currentDate,
  events,
  calendars,
  colorPalette,
  onEventClick,
}: AgendaViewProps) {
  const today = startOfDay(new Date());

  const grouped = useMemo(() => {
    const map = new Map<string, { date: Date; events: CalendarEvent[] }>();
    for (const event of events) {
      const start = startOfDay(new Date(event.startTime));
      const end = startOfDay(new Date(event.endTime));
      // Iterate each day in the event's span.
      const cursor = new Date(start);
      while (cursor.getTime() <= end.getTime()) {
        const key = cursor.toISOString();
        if (!map.has(key)) map.set(key, { date: new Date(cursor), events: [] });
        map.get(key)!.events.push(event);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return Array.from(map.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((g) => ({
        ...g,
        events: g.events.sort(
          (a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        ),
      }));
  }, [events]);

  if (grouped.length === 0) {
    return (
      <div className="rounded-xl bg-card border border-border p-12 text-center text-muted-foreground">
        No events in this period
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card border border-border divide-y divide-border">
      {grouped.map(({ date, events: dayEvents }) => {
        const isToday = isSameDay(date, today);
        const isFocused = isSameDay(date, currentDate);
        return (
          <div key={date.toISOString()} className="grid grid-cols-[140px_1fr] gap-4 p-4">
            <div className="text-right">
              <div
                className={cn(
                  'text-2xl font-semibold',
                  isToday ? 'text-primary' : 'text-foreground',
                  isFocused && !isToday && 'text-primary/80',
                )}
              >
                {format(date, 'd')}
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {format(date, 'EEE')}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(date, 'MMM yyyy')}
              </div>
            </div>
            <div className="space-y-2">
              {dayEvents.map((event) => {
                const color = resolveEventColor(event, calendars, colorPalette);
                return (
                  <button
                    key={event.id + date.toISOString()}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="w-full text-left flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-accent"
                  >
                    <div
                      className="w-1 self-stretch rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">
                        {event.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {event.allDay
                          ? 'All day'
                          : `${format(new Date(event.startTime), 'h:mm a')} – ${format(new Date(event.endTime), 'h:mm a')}`}
                        {event.location && ` · ${event.location}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
