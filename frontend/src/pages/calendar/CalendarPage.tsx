import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EventForm } from '@/components/calendar/EventForm';
import { EventDetail } from '@/components/calendar/EventDetail';
import { calendarsApi } from '@/api/calendars';
import { cn } from '@/lib/utils';
import type { EventFormData } from '@/types/forms';
import type { CalendarEvent } from '@/types/models';

type ViewMode = 'month' | 'week' | 'day';

export function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const queryClient = useQueryClient();

  const startDate = getStartDate(currentDate, viewMode);
  const endDate = getEndDate(currentDate, viewMode);

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', startDate.toISOString(), endDate.toISOString()],
    queryFn: () =>
      calendarsApi.getEvents({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      }),
  });

  const { data: calendarsData } = useQuery({
    queryKey: ['calendars'],
    queryFn: calendarsApi.list,
  });

  // Convert recurrence to iCal RRULE format
  const recurrenceToRRule = (recurrence: string): string | undefined => {
    const map: Record<string, string> = {
      'daily': 'FREQ=DAILY',
      'weekly': 'FREQ=WEEKLY',
      'biweekly': 'FREQ=WEEKLY;INTERVAL=2',
      'monthly': 'FREQ=MONTHLY',
      'yearly': 'FREQ=YEARLY',
    };
    return map[recurrence];
  };

  const createMutation = useMutation({
    mutationFn: (data: EventFormData) => calendarsApi.createEvent({
      calendarId: data.calendarId,
      title: data.title,
      description: data.description,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay,
      recurrenceRule: recurrenceToRRule(data.recurrence),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setFormOpen(false);
      setSelectedEvent(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: EventFormData) => {
      if (!selectedEvent) throw new Error('No event selected');
      return calendarsApi.updateEvent(selectedEvent.calendarId, selectedEvent.id, {
        title: data.title,
        description: data.description,
        startTime: data.startTime,
        endTime: data.endTime,
        allDay: data.allDay,
        recurrenceRule: recurrenceToRRule(data.recurrence),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setFormOpen(false);
      setSelectedEvent(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!selectedEvent) throw new Error('No event selected');
      return calendarsApi.deleteEvent(selectedEvent.calendarId, selectedEvent.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setFormOpen(false);
      setDetailOpen(false);
      setSelectedEvent(null);
    },
  });

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setDetailOpen(true);
  };

  const handleEditFromDetail = () => {
    setDetailOpen(false);
    setFormOpen(true);
  };

  const handleDetailClose = (open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setSelectedEvent(null);
    }
  };

  const handleFormSubmit = (data: EventFormData) => {
    if (selectedEvent) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setSelectedEvent(null);
    }
  };

  const calendars = calendarsData?.calendars || [];

  const navigatePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') newDate.setMonth(newDate.getMonth() - 1);
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() - 7);
    else newDate.setDate(newDate.getDate() - 1);
    setCurrentDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') newDate.setMonth(newDate.getMonth() + 1);
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() + 7);
    else newDate.setDate(newDate.getDate() + 1);
    setCurrentDate(newDate);
  };

  const goToToday = () => setCurrentDate(new Date());

  const monthLabel = currentDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div>
      <PageHeader
        title="Calendar"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Event
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          {/* Calendar controls */}
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={navigatePrev}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={navigateNext}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={goToToday}>
                Today
              </Button>
              <span className="ml-2 text-lg font-semibold">{monthLabel}</span>
            </div>

            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="day">Day</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Calendar grid */}
          {isLoading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : viewMode === 'month' ? (
            <MonthView
              currentDate={currentDate}
              events={events?.events || []}
              onEventClick={handleEventClick}
            />
          ) : viewMode === 'week' ? (
            <WeekView
              currentDate={currentDate}
              events={events?.events || []}
              onEventClick={handleEventClick}
            />
          ) : (
            <DayView
              currentDate={currentDate}
              events={events?.events || []}
              onEventClick={handleEventClick}
            />
          )}
        </CardContent>
      </Card>

      <EventDetail
        open={detailOpen}
        onOpenChange={handleDetailClose}
        event={selectedEvent}
        calendar={calendars.find((c) => c.id === selectedEvent?.calendarId)}
        onEdit={handleEditFromDetail}
        onDelete={() => deleteMutation.mutate()}
        isDeleting={deleteMutation.isPending}
      />

      <EventForm
        open={formOpen}
        onOpenChange={handleFormClose}
        event={selectedEvent}
        calendars={calendars}
        defaultDate={currentDate}
        onSubmit={handleFormSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function MonthView({
  currentDate,
  events,
  onEventClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate();
  const firstDayOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay();

  const days = [];

  // Previous month days
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push({ day: null, isCurrentMonth: false });
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ day: i, isCurrentMonth: true });
  }

  // Fill remaining cells
  while (days.length < 35) {
    days.push({ day: null, isCurrentMonth: false });
  }

  const today = new Date();
  const isToday = (day: number | null) =>
    day !== null &&
    today.getDate() === day &&
    today.getMonth() === currentDate.getMonth() &&
    today.getFullYear() === currentDate.getFullYear();

  const getEventsForDay = (day: number | null) => {
    if (day === null) return [];
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    return events.filter((event) => {
      const eventDate = new Date(event.startTime);
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });
  };

  return (
    <div>
      {/* Day headers */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(({ day, isCurrentMonth }, i) => {
          const dayEvents = getEventsForDay(day);
          return (
            <div
              key={i}
              className={cn(
                'min-h-24 rounded-md border p-1',
                isCurrentMonth ? 'bg-card' : 'bg-muted/30',
                isToday(day) && 'border-primary'
              )}
            >
              {day !== null && (
                <>
                  <span
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-full text-sm',
                      isToday(day) && 'bg-primary text-primary-foreground'
                    )}
                  >
                    {day}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 2).map((event) => (
                      <div
                        key={event.id}
                        className="truncate rounded bg-primary/10 px-1 py-0.5 text-xs cursor-pointer hover:bg-primary/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                      >
                        {event.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="px-1 text-xs text-muted-foreground">
                        +{dayEvents.length - 2} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  currentDate,
  events,
  onEventClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    return date;
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const today = new Date();
  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const getEventsForDay = (date: Date) => {
    return events.filter((event) => {
      const eventDate = new Date(event.startTime);
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const getAllDayEventsForDay = (date: Date) => {
    return getEventsForDay(date).filter((event) => event.allDay);
  };

  const getTimedEventsForDay = (date: Date) => {
    return getEventsForDay(date).filter((event) => !event.allDay);
  };

  const hasAnyAllDayEvents = days.some((date) => getAllDayEventsForDay(date).length > 0);

  const formatHour = (hour: number) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  return (
    <div className="overflow-auto">
      {/* Day headers */}
      <div className="grid grid-cols-8 gap-px bg-muted sticky top-0 z-10">
        <div className="bg-card p-2" /> {/* Empty corner */}
        {days.map((date, i) => (
          <div
            key={i}
            className={cn(
              'bg-card p-2 text-center',
              isToday(date) && 'bg-primary/10'
            )}
          >
            <div className="text-xs text-muted-foreground">
              {date.toLocaleDateString(undefined, { weekday: 'short' })}
            </div>
            <div
              className={cn(
                'text-lg font-semibold',
                isToday(date) && 'text-primary'
              )}
            >
              {date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* All-day events row */}
      {hasAnyAllDayEvents && (
        <div className="grid grid-cols-8 gap-px bg-muted border-b">
          <div className="bg-card p-1 text-xs text-muted-foreground text-right pr-2">
            All day
          </div>
          {days.map((date, dayIndex) => {
            const allDayEvents = getAllDayEventsForDay(date);
            return (
              <div
                key={dayIndex}
                className={cn(
                  'bg-card min-h-8 p-0.5',
                  isToday(date) && 'bg-primary/5'
                )}
              >
                {allDayEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded bg-primary/20 px-1 py-0.5 text-xs cursor-pointer hover:bg-primary/30 truncate mb-0.5"
                    onClick={() => onEventClick(event)}
                  >
                    {event.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Time grid */}
      <div className="grid grid-cols-8 gap-px bg-muted">
        {hours.map((hour) => (
          <React.Fragment key={hour}>
            {/* Time label */}
            <div className="bg-card p-1 text-xs text-muted-foreground text-right pr-2">
              {formatHour(hour)}
            </div>
            {/* Day columns */}
            {days.map((date, dayIndex) => {
              const dayEvents = getTimedEventsForDay(date).filter((event) => {
                const eventHour = new Date(event.startTime).getHours();
                return eventHour === hour;
              });
              return (
                <div
                  key={dayIndex}
                  className={cn(
                    'bg-card min-h-12 border-t relative',
                    isToday(date) && 'bg-primary/5'
                  )}
                >
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="absolute inset-x-0 mx-0.5 rounded bg-primary/20 px-1 py-0.5 text-xs cursor-pointer hover:bg-primary/30 truncate"
                      onClick={() => onEventClick(event)}
                    >
                      {event.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function DayView({
  currentDate,
  events,
  onEventClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const today = new Date();
  const isToday =
    currentDate.getDate() === today.getDate() &&
    currentDate.getMonth() === today.getMonth() &&
    currentDate.getFullYear() === today.getFullYear();

  const dayEvents = events.filter((event) => {
    const eventDate = new Date(event.startTime);
    return (
      eventDate.getDate() === currentDate.getDate() &&
      eventDate.getMonth() === currentDate.getMonth() &&
      eventDate.getFullYear() === currentDate.getFullYear()
    );
  });

  const allDayEvents = dayEvents.filter((event) => event.allDay);
  const timedEvents = dayEvents.filter((event) => !event.allDay);

  const formatHour = (hour: number) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  const getEventsForHour = (hour: number) => {
    return timedEvents.filter((event) => {
      const eventHour = new Date(event.startTime).getHours();
      return eventHour === hour;
    });
  };

  return (
    <div className="overflow-auto">
      {/* Day header */}
      <div className={cn('p-4 text-center border-b', isToday && 'bg-primary/10')}>
        <div className="text-sm text-muted-foreground">
          {currentDate.toLocaleDateString(undefined, { weekday: 'long' })}
        </div>
        <div className={cn('text-2xl font-semibold', isToday && 'text-primary')}>
          {currentDate.getDate()}
        </div>
        <div className="text-sm text-muted-foreground">
          {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="border-b p-2 bg-muted/30">
          <div className="flex">
            <div className="w-20 p-2 text-sm text-muted-foreground text-right border-r">
              All day
            </div>
            <div className="flex-1 p-1 space-y-1">
              {allDayEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded bg-primary/20 px-2 py-1 text-sm cursor-pointer hover:bg-primary/30"
                  onClick={() => onEventClick(event)}
                >
                  {event.title}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Time slots */}
      <div className="divide-y">
        {hours.map((hour) => {
          const hourEvents = getEventsForHour(hour);
          return (
            <div key={hour} className="flex min-h-16">
              <div className="w-20 p-2 text-sm text-muted-foreground text-right border-r">
                {formatHour(hour)}
              </div>
              <div className="flex-1 p-1 relative">
                {hourEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded bg-primary/20 px-2 py-1 text-sm cursor-pointer hover:bg-primary/30 mb-1"
                    onClick={() => onEventClick(event)}
                  >
                    <div className="font-medium">{event.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(event.startTime).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {' - '}
                      {new Date(event.endTime).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getStartDate(date: Date, view: ViewMode): Date {
  const d = new Date(date);
  if (view === 'month') {
    d.setDate(1);
    d.setDate(d.getDate() - d.getDay());
  } else if (view === 'week') {
    d.setDate(d.getDate() - d.getDay());
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndDate(date: Date, view: ViewMode): Date {
  const d = new Date(date);
  if (view === 'month') {
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setDate(d.getDate() + (6 - d.getDay()));
  } else if (view === 'week') {
    d.setDate(d.getDate() + (6 - d.getDay()));
  }
  d.setHours(23, 59, 59, 999);
  return d;
}
