import { format } from 'date-fns';
import { CalendarDays, Plus } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { resolveEventColor, eventTouchesDay } from './calendar-utils';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

interface DayPeekSheetProps {
  /** The day being peeked at; `null` keeps the sheet closed. */
  day: Date | null;
  events: CalendarEvent[];
  calendars: CalendarType[];
  colorPalette: string;
  onOpenChange: (open: boolean) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** Leave the overview behind for the full day. */
  onOpenDay: (day: Date) => void;
  onAddEvent: (day: Date) => void;
}

/**
 * The compact month grid shows only that a day is busy, not what is on it.
 * This is where "what, exactly?" gets answered — a tap away, without leaving
 * the month. Anything more than a glance is what `onOpenDay` is for.
 */
export function DayPeekSheet({
  day,
  events,
  calendars,
  colorPalette,
  onOpenChange,
  onEventClick,
  onOpenDay,
  onAddEvent,
}: DayPeekSheetProps) {
  const dayEvents = day
    ? events
        .filter((event) => eventTouchesDay(event, day))
        .sort(
          (a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        )
    : [];

  return (
    <Sheet open={day !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>{day ? format(day, 'EEEE, MMMM d') : ''}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {dayEvents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <CalendarDays className="h-8 w-8 opacity-50" />
              <span>Nothing planned</span>
            </div>
          ) : (
            dayEvents.map((event) => {
              const color = resolveEventColor(event, calendars, colorPalette);
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onEventClick(event)}
                  className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span
                    aria-hidden
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {event.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {event.allDay
                        ? 'All day'
                        : format(new Date(event.startTime), 'h:mm a')}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {day && (
          <div className="mt-4 flex gap-2 border-t pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenDay(day)}
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              Open day
            </Button>
            <Button className="flex-1" onClick={() => onAddEvent(day)}>
              <Plus className="mr-2 h-4 w-4" />
              Add event
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
