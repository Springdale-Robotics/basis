import { useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types/models';

type ViewType = 'month' | 'week' | 'day';

interface CalendarViewProps {
  events: CalendarEvent[];
  view: ViewType;
  onViewChange: (view: ViewType) => void;
  onEventClick: (event: CalendarEvent) => void;
  onDateClick: (date: Date) => void;
  visibleCalendars: string[];
}

export function CalendarView({
  events,
  view,
  onViewChange,
  onEventClick,
  onDateClick,
  visibleCalendars,
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const navigatePrev = () => {
    if (view === 'month') {
      setCurrentDate(subMonths(currentDate, 1));
    } else if (view === 'week') {
      setCurrentDate(subWeeks(currentDate, 1));
    } else {
      setCurrentDate(subDays(currentDate, 1));
    }
  };

  const navigateNext = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, 1));
    } else if (view === 'week') {
      setCurrentDate(addWeeks(currentDate, 1));
    } else {
      setCurrentDate(addDays(currentDate, 1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const filteredEvents = events.filter((event) =>
    visibleCalendars.includes(event.calendarId)
  );

  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter((event) =>
      isSameDay(new Date(event.startTime), date)
    );
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-7 border-b">
          {weekDays.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-sm font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1">
          {days.map((day) => {
            const dayEvents = getEventsForDate(day);
            const isToday = isSameDay(day, new Date());
            const isCurrentMonth = isSameMonth(day, currentDate);

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'min-h-24 border-b border-r p-1 cursor-pointer hover:bg-muted/50 transition-colors',
                  !isCurrentMonth && 'bg-muted/20'
                )}
                onClick={() => onDateClick(day)}
              >
                <div
                  className={cn(
                    'text-sm mb-1',
                    isToday &&
                      'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center',
                    !isCurrentMonth && 'text-muted-foreground'
                  )}
                >
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      className="text-xs px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80"
                      style={{
                        backgroundColor: event.color || '#3b82f6',
                        color: '#fff',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(event);
                      }}
                    >
                      {event.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-xs text-muted-foreground px-1">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const days = eachDayOfInterval({
      start: weekStart,
      end: endOfWeek(currentDate),
    });

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-7 border-b">
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className="py-2 text-center">
                <div className="text-sm text-muted-foreground">
                  {format(day, 'EEE')}
                </div>
                <div
                  className={cn(
                    'text-lg font-medium',
                    isToday && 'text-primary'
                  )}
                >
                  {format(day, 'd')}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-7 flex-1 overflow-y-auto">
          {days.map((day) => {
            const dayEvents = getEventsForDate(day);
            return (
              <div
                key={day.toISOString()}
                className="border-r min-h-[500px] p-1 cursor-pointer hover:bg-muted/30"
                onClick={() => onDateClick(day)}
              >
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="text-xs px-2 py-1 rounded mb-1 cursor-pointer hover:opacity-80"
                    style={{
                      backgroundColor: event.color || '#3b82f6',
                      color: '#fff',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                  >
                    <div className="font-medium">{event.title}</div>
                    <div className="opacity-80">
                      {format(new Date(event.startTime), 'h:mm a')}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const dayEvents = getEventsForDate(currentDate);
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
      <div className="flex flex-col h-full overflow-y-auto">
        {hours.map((hour) => {
          const hourEvents = dayEvents.filter((event) => {
            const eventHour = new Date(event.startTime).getHours();
            return eventHour === hour;
          });

          return (
            <div
              key={hour}
              className="flex border-b min-h-16 cursor-pointer hover:bg-muted/30"
              onClick={() => {
                const date = new Date(currentDate);
                date.setHours(hour);
                onDateClick(date);
              }}
            >
              <div className="w-16 py-2 text-xs text-muted-foreground text-right pr-2 border-r shrink-0">
                {format(new Date().setHours(hour), 'h a')}
              </div>
              <div className="flex-1 p-1">
                {hourEvents.map((event) => (
                  <div
                    key={event.id}
                    className="text-sm px-2 py-1 rounded cursor-pointer hover:opacity-80"
                    style={{
                      backgroundColor: event.color || '#3b82f6',
                      color: '#fff',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(event);
                    }}
                  >
                    <div className="font-medium">{event.title}</div>
                    <div className="text-xs opacity-80">
                      {format(new Date(event.startTime), 'h:mm a')} -{' '}
                      {format(new Date(event.endTime), 'h:mm a')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" onClick={navigatePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={navigateNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold">
            {view === 'month' && format(currentDate, 'MMMM yyyy')}
            {view === 'week' &&
              `${format(startOfWeek(currentDate), 'MMM d')} - ${format(endOfWeek(currentDate), 'MMM d, yyyy')}`}
            {view === 'day' && format(currentDate, 'EEEE, MMMM d, yyyy')}
          </h2>
        </div>
        <div className="flex items-center gap-1 border rounded-md p-0.5">
          {(['month', 'week', 'day'] as const).map((v) => (
            <Button
              key={v}
              variant={view === v ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewChange(v)}
              className="capitalize"
            >
              {v}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex-1 border rounded-lg overflow-hidden">
        {view === 'month' && renderMonthView()}
        {view === 'week' && renderWeekView()}
        {view === 'day' && renderDayView()}
      </div>
    </div>
  );
}
