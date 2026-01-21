import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight, Keyboard, CalendarDays, PanelLeftClose, PanelLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EventForm } from '@/components/calendar/EventForm';
import { EventDetail } from '@/components/calendar/EventDetail';
import { CalendarForm } from '@/components/calendar/CalendarForm';
import { EditRecurringEventDialog, type RecurrenceEditScope } from '@/components/calendar/EditRecurringEventDialog';
import { DeleteRecurringEventDialog, type RecurrenceDeleteScope } from '@/components/calendar/DeleteRecurringEventDialog';
import { CalendarSearch, CalendarSearchRef } from '@/components/calendar/CalendarSearch';
import { useCalendarShortcuts, KEYBOARD_SHORTCUTS } from '@/hooks/useCalendarShortcuts';
import { calendarsApi } from '@/api/calendars';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Settings } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import type { EventFormData } from '@/types/forms';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

type ViewMode = 'month' | 'week' | 'day';

export function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [calendarFormOpen, setCalendarFormOpen] = useState(false);
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarType | null>(null);
  const [visibleCalendars, setVisibleCalendars] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [defaultEventDate, setDefaultEventDate] = useState<Date | undefined>(undefined);
  const [editRecurringDialogOpen, setEditRecurringDialogOpen] = useState(false);
  const [deleteRecurringDialogOpen, setDeleteRecurringDialogOpen] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<EventFormData | null>(null);
  const queryClient = useQueryClient();
  const searchRef = useRef<CalendarSearchRef>(null);

  const startDate = getStartDate(currentDate, viewMode);
  const endDate = getEndDate(currentDate, viewMode);

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', startDate.toISOString(), endDate.toISOString()],
    queryFn: () =>
      calendarsApi.getEvents({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        expandRecurring: true,
      }),
  });

  const { data: calendarsData } = useQuery({
    queryKey: ['calendars'],
    queryFn: calendarsApi.list,
  });

  // Initialize visible calendars when calendars load
  useEffect(() => {
    if (calendarsData?.calendars && visibleCalendars.length === 0) {
      setVisibleCalendars(calendarsData.calendars.map((c) => c.id));
    }
  }, [calendarsData?.calendars]);

  // Calendar CRUD mutations
  const createCalendarMutation = useMutation({
    mutationFn: (data: { name: string; color: string; type: 'individual' | 'group' }) =>
      calendarsApi.create(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      setVisibleCalendars((prev) => [...prev, result.calendar.id]);
      setCalendarFormOpen(false);
      setSelectedCalendar(null);
      toast({ title: 'Calendar created' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to create calendar',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  const updateCalendarMutation = useMutation({
    mutationFn: (data: { id: string; name: string; color: string }) =>
      calendarsApi.update(data.id, { name: data.name, color: data.color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      setCalendarFormOpen(false);
      setSelectedCalendar(null);
      toast({ title: 'Calendar updated' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update calendar',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  const deleteCalendarMutation = useMutation({
    mutationFn: (id: string) => calendarsApi.delete(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setVisibleCalendars((prev) => prev.filter((id) => id !== deletedId));
      setCalendarFormOpen(false);
      setSelectedCalendar(null);
      toast({ title: 'Calendar deleted' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to delete calendar',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  const handleToggleCalendar = (calendarId: string) => {
    setVisibleCalendars((prev) =>
      prev.includes(calendarId)
        ? prev.filter((id) => id !== calendarId)
        : [...prev, calendarId]
    );
  };

  const handleCreateCalendar = () => {
    setSelectedCalendar(null);
    setCalendarFormOpen(true);
  };

  const handleEditCalendar = (calendar: CalendarType) => {
    setSelectedCalendar(calendar);
    setCalendarFormOpen(true);
  };

  const handleCalendarFormSubmit = (data: { name: string; color: string; type: 'individual' | 'group' }) => {
    if (selectedCalendar) {
      updateCalendarMutation.mutate({ id: selectedCalendar.id, name: data.name, color: data.color });
    } else {
      createCalendarMutation.mutate(data);
    }
  };

  // Convert recurrence to iCal RRULE format
  const recurrenceToRRule = (recurrence: string | undefined): string | undefined => {
    if (!recurrence || recurrence === 'none') return undefined;
    // If it's already an RRULE string, return as-is
    if (recurrence.includes('FREQ=')) return recurrence;
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
    onSuccess: async () => {
      // Invalidate and refetch all event queries to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      setFormOpen(false);
      setSelectedEvent(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ data, scope }: { data: EventFormData; scope?: RecurrenceEditScope }) => {
      if (!selectedEvent) throw new Error('No event selected');

      // Determine the actual event to update (master for virtual instances)
      const isVirtual = selectedEvent.isVirtualInstance;
      const masterEvent = isVirtual ? selectedEvent.masterEvent : selectedEvent;
      const eventId = masterEvent?.id || selectedEvent.id;
      const calendarId = masterEvent?.calendarId || selectedEvent.calendarId;

      // For recurring events with scope
      if (scope && masterEvent?.recurrenceRule) {
        if (scope === 'single') {
          // Create an exception for this single instance
          const result = await calendarsApi.createException(calendarId, eventId, {
            originalStartTime: selectedEvent.startTime,
            title: data.title,
            description: data.description,
            location: data.location,
            startTime: data.startTime,
            endTime: data.endTime,
            allDay: data.allDay,
          });
          return { event: result.exception };
        } else if (scope === 'all') {
          // Update master event but preserve original start/end times for the series
          // Only update recurrence rule and non-time fields
          return calendarsApi.updateEvent(calendarId, eventId, {
            title: data.title,
            description: data.description,
            location: data.location,
            allDay: data.allDay,
            recurrenceRule: recurrenceToRRule(data.recurrence),
            scope: 'all',
          });
        } else {
          // 'following' - update this and future events
          return calendarsApi.updateEvent(calendarId, eventId, {
            title: data.title,
            description: data.description,
            location: data.location,
            startTime: data.startTime,
            endTime: data.endTime,
            allDay: data.allDay,
            recurrenceRule: recurrenceToRRule(data.recurrence),
            scope: 'following',
            originalStartTime: selectedEvent.startTime,
          });
        }
      }

      // Non-recurring event or no scope specified
      return calendarsApi.updateEvent(calendarId, eventId, {
        title: data.title,
        description: data.description,
        location: data.location,
        startTime: data.startTime,
        endTime: data.endTime,
        allDay: data.allDay,
        recurrenceRule: recurrenceToRRule(data.recurrence),
      });
    },
    onSuccess: async () => {
      // Invalidate and refetch all event queries to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      setFormOpen(false);
      setSelectedEvent(null);
      setPendingFormData(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (scope?: RecurrenceDeleteScope) => {
      if (!selectedEvent) throw new Error('No event selected');

      // Determine the actual event (master for virtual instances)
      const isVirtual = selectedEvent.isVirtualInstance;
      const masterEvent = isVirtual ? selectedEvent.masterEvent : selectedEvent;
      const eventId = masterEvent?.id || selectedEvent.id;
      const calendarId = masterEvent?.calendarId || selectedEvent.calendarId;

      return calendarsApi.deleteEvent(calendarId, eventId, {
        scope,
        originalStartTime: scope === 'single' || scope === 'following' ? selectedEvent.startTime : undefined,
      });
    },
    onSuccess: async () => {
      // Invalidate and refetch all event queries to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ['events'] });
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
      // Check if this is a recurring event (either master or virtual instance)
      const isRecurring = selectedEvent.recurrenceRule ||
        selectedEvent.isVirtualInstance ||
        selectedEvent.masterEvent?.recurrenceRule;

      if (isRecurring) {
        // Store the form data and show the scope dialog
        setPendingFormData(data);
        setEditRecurringDialogOpen(true);
      } else {
        updateMutation.mutate({ data });
      }
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEditRecurringConfirm = (scope: RecurrenceEditScope) => {
    setEditRecurringDialogOpen(false);
    if (pendingFormData) {
      updateMutation.mutate({ data: pendingFormData, scope });
    }
  };

  const handleDeleteEvent = () => {
    if (!selectedEvent) return;

    // Check if this is a recurring event
    const isRecurring = selectedEvent.recurrenceRule ||
      selectedEvent.isVirtualInstance ||
      selectedEvent.masterEvent?.recurrenceRule;

    if (isRecurring) {
      setDeleteRecurringDialogOpen(true);
    } else {
      deleteMutation.mutate(undefined);
    }
  };

  const handleDeleteRecurringConfirm = (scope: RecurrenceDeleteScope) => {
    setDeleteRecurringDialogOpen(false);
    deleteMutation.mutate(scope);
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setSelectedEvent(null);
      setDefaultEventDate(undefined);
    }
  };

  // Handle double-click on a day or time slot to create a new event
  const handleSlotDoubleClick = (date: Date) => {
    // Round to nearest 30 minutes
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 30) * 30;
    const roundedDate = new Date(date);
    roundedDate.setMinutes(roundedMinutes, 0, 0);

    setDefaultEventDate(roundedDate);
    setSelectedEvent(null);
    setFormOpen(true);
  };

  const calendars = calendarsData?.calendars || [];
  const myCalendars = calendars.filter((cal) => !cal.syncProvider);
  const syncedCalendars = calendars.filter((cal) => cal.syncProvider);

  // Filter events by visible calendars
  const filteredEvents = (events?.events || []).filter((event) =>
    visibleCalendars.includes(event.calendarId)
  );

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

  // Keyboard shortcuts
  useCalendarShortcuts({
    onCreateEvent: () => setFormOpen(true),
    onSearch: () => searchRef.current?.open(),
    onToday: goToToday,
    onPrevious: navigatePrev,
    onNext: navigateNext,
    onMonthView: () => setViewMode('month'),
    onWeekView: () => setViewMode('week'),
    onDayView: () => setViewMode('day'),
    onEscape: () => {
      if (formOpen) setFormOpen(false);
      else if (detailOpen) setDetailOpen(false);
    },
    onEdit: () => {
      if (selectedEvent && detailOpen) {
        setDetailOpen(false);
        setFormOpen(true);
      }
    },
    onDelete: () => {
      if (selectedEvent && detailOpen) {
        handleDeleteEvent();
      }
    },
  });

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-64 shrink-0">
          <Card className="sticky top-4">
            <CardContent className="p-4">
              <Button onClick={handleCreateCalendar} className="w-full mb-4">
                <Plus className="mr-2 h-4 w-4" />
                Create Calendar
              </Button>

              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4">
                  {/* My Calendars */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      My Calendars
                    </h3>
                    <div className="space-y-1">
                      {myCalendars.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">No calendars yet</p>
                      ) : (
                        myCalendars.map((calendar) => (
                          <div
                            key={calendar.id}
                            className="flex items-center justify-between group rounded-lg px-2 py-2 hover:bg-muted transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Checkbox
                                checked={visibleCalendars.includes(calendar.id)}
                                onCheckedChange={() => handleToggleCalendar(calendar.id)}
                                className="shrink-0 rounded-md"
                                style={{
                                  borderColor: calendar.color,
                                  backgroundColor: visibleCalendars.includes(calendar.id)
                                    ? calendar.color
                                    : 'transparent',
                                }}
                              />
                              <span
                                className={cn(
                                  'text-sm font-medium truncate',
                                  !visibleCalendars.includes(calendar.id) && 'text-muted-foreground'
                                )}
                              >
                                {calendar.name}
                              </span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => handleEditCalendar(calendar)}
                            >
                              <Settings className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Synced Calendars */}
                  {syncedCalendars.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                          Synced
                        </h3>
                        <div className="space-y-1">
                          {syncedCalendars.map((calendar) => (
                            <div
                              key={calendar.id}
                              className="flex items-center justify-between group rounded-lg px-2 py-2 hover:bg-muted transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <Checkbox
                                  checked={visibleCalendars.includes(calendar.id)}
                                  onCheckedChange={() => handleToggleCalendar(calendar.id)}
                                  className="shrink-0 rounded-md"
                                  style={{
                                    borderColor: calendar.color,
                                    backgroundColor: visibleCalendars.includes(calendar.id)
                                      ? calendar.color
                                      : 'transparent',
                                  }}
                                />
                                <div className="min-w-0">
                                  <span
                                    className={cn(
                                      'text-sm font-medium truncate block',
                                      !visibleCalendars.includes(calendar.id) && 'text-muted-foreground'
                                    )}
                                  >
                                    {calendar.name}
                                  </span>
                                  {calendar.syncProvider && (
                                    <span className="text-xs text-muted-foreground">
                                      {calendar.syncProvider}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
                                onClick={() => handleEditCalendar(calendar)}
                              >
                                <Settings className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <PageHeader
          title="Calendar"
          actions={
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="rounded-full"
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeft className="h-4 w-4" />
                )}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Keyboard className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="w-64">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Keyboard Shortcuts</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {KEYBOARD_SHORTCUTS.map((shortcut) => (
                          <div key={shortcut.key} className="contents">
                            <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono">
                              {shortcut.key}
                            </kbd>
                            <span className="text-muted-foreground">
                              {shortcut.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <CalendarSearch
                ref={searchRef}
                calendars={calendars}
                onEventSelect={(event) => {
                  setSelectedEvent(event);
                  setDetailOpen(true);
                }}
              />
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Event
              </Button>
            </div>
          }
        />

        <Card className="border-0 shadow-none bg-transparent">
          <CardContent className="p-0">
          {/* Calendar controls - Skylight style */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-white rounded-full shadow-sm p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={navigatePrev}
                  className="rounded-full hover:bg-secondary"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={navigateNext}
                  className="rounded-full hover:bg-secondary"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              <Button
                variant="secondary"
                onClick={goToToday}
                className="rounded-full px-5 font-medium"
              >
                Today
              </Button>
              <span className="ml-2 text-2xl font-semibold text-foreground">
                {monthLabel}
              </span>
            </div>

            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList className="bg-white shadow-sm rounded-full p-1">
                <TabsTrigger value="month" className="rounded-full px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Month
                </TabsTrigger>
                <TabsTrigger value="week" className="rounded-full px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Week
                </TabsTrigger>
                <TabsTrigger value="day" className="rounded-full px-5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Day
                </TabsTrigger>
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
              events={filteredEvents}
              calendars={calendars}
              onEventClick={handleEventClick}
              onSlotDoubleClick={handleSlotDoubleClick}
            />
          ) : viewMode === 'week' ? (
            <WeekView
              currentDate={currentDate}
              events={filteredEvents}
              calendars={calendars}
              onEventClick={handleEventClick}
              onSlotDoubleClick={handleSlotDoubleClick}
            />
          ) : (
            <DayView
              currentDate={currentDate}
              events={filteredEvents}
              calendars={calendars}
              onEventClick={handleEventClick}
              onSlotDoubleClick={handleSlotDoubleClick}
            />
          )}
        </CardContent>
      </Card>
    </div>

      <EventDetail
        open={detailOpen}
        onOpenChange={handleDetailClose}
        event={selectedEvent}
        calendar={calendars.find((c) => c.id === selectedEvent?.calendarId)}
        onEdit={handleEditFromDetail}
        onDelete={handleDeleteEvent}
        isDeleting={deleteMutation.isPending}
      />

      <EventForm
        open={formOpen}
        onOpenChange={handleFormClose}
        event={selectedEvent}
        calendars={calendars}
        defaultDate={defaultEventDate || currentDate}
        onSubmit={handleFormSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />

      <CalendarForm
        open={calendarFormOpen}
        onOpenChange={(open) => {
          setCalendarFormOpen(open);
          if (!open) setSelectedCalendar(null);
        }}
        calendar={selectedCalendar}
        onSubmit={handleCalendarFormSubmit}
        onDelete={() => selectedCalendar && deleteCalendarMutation.mutate(selectedCalendar.id)}
        isSubmitting={createCalendarMutation.isPending || updateCalendarMutation.isPending}
        isDeleting={deleteCalendarMutation.isPending}
      />

      <EditRecurringEventDialog
        open={editRecurringDialogOpen}
        onOpenChange={setEditRecurringDialogOpen}
        onConfirm={handleEditRecurringConfirm}
        eventTitle={selectedEvent?.title}
      />

      <DeleteRecurringEventDialog
        open={deleteRecurringDialogOpen}
        onOpenChange={setDeleteRecurringDialogOpen}
        onConfirm={handleDeleteRecurringConfirm}
        eventTitle={selectedEvent?.title}
      />
    </div>
  );
}

function MonthView({
  currentDate,
  events,
  calendars,
  onEventClick,
  onSlotDoubleClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  onEventClick: (event: CalendarEvent) => void;
  onSlotDoubleClick: (date: Date) => void;
}) {
  const getEventColor = (event: CalendarEvent) => {
    if (event.color) return event.color;
    const calendar = calendars.find((c) => c.id === event.calendarId);
    return calendar?.color || '#f66951'; // Default to Skylight coral
  };
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
      {/* Day headers - Skylight style */}
      <div className="mb-2 grid grid-cols-7 gap-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="py-3 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid - Skylight rounded cells */}
      <div className="grid grid-cols-7 gap-2">
        {days.map(({ day, isCurrentMonth }, i) => {
          const dayEvents = getEventsForDay(day);
          return (
            <div
              key={i}
              className={cn(
                'min-h-28 rounded-2xl p-2 transition-all duration-200 cursor-pointer',
                isCurrentMonth
                  ? 'bg-white hover:bg-secondary/20'
                  : 'bg-secondary/30',
                isToday(day) && 'ring-2 ring-primary ring-offset-2'
              )}
              onDoubleClick={() => {
                if (day !== null && isCurrentMonth) {
                  // Create a date at 9 AM by default for month view
                  const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day, 9, 0, 0);
                  onSlotDoubleClick(clickedDate);
                }
              }}
            >
              {day !== null && (
                <>
                  <span
                    className={cn(
                      'inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                      isToday(day)
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-foreground hover:bg-muted'
                    )}
                  >
                    {day}
                  </span>
                  <div className="mt-2 space-y-1.5">
                    {dayEvents.slice(0, 2).map((event) => {
                      const color = getEventColor(event);
                      return (
                        <div
                          key={event.id}
                          className="truncate rounded-lg px-2 py-1 text-xs font-medium cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-sm"
                          style={{
                            backgroundColor: `${color}25`,
                            color: color,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick(event);
                          }}
                        >
                          {event.title}
                        </div>
                      );
                    })}
                    {dayEvents.length > 2 && (
                      <div className="px-2 text-xs font-medium text-primary cursor-pointer hover:underline">
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
  calendars,
  onEventClick,
  onSlotDoubleClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  onEventClick: (event: CalendarEvent) => void;
  onSlotDoubleClick: (date: Date) => void;
}) {
  const getEventColor = (event: CalendarEvent) => {
    if (event.color) return event.color;
    const calendar = calendars.find((c) => c.id === event.calendarId);
    return calendar?.color || '#f66951'; // Default to Skylight coral
  };
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

  // Get background color based on time of day - subtle night indicator only
  const getTimeSlotBg = (hour: number) => {
    if (hour < 6 || hour >= 21) {
      // Night (before 6 AM or after 9 PM) - subtle gray
      return 'bg-secondary/20';
    }
    return 'bg-white';
  };

  return (
    <div className="overflow-auto rounded-2xl bg-white border border-secondary/30">
      {/* Day headers - Skylight style */}
      <div className="grid grid-cols-8 gap-px bg-secondary/50 sticky top-0 z-10">
        <div className="bg-white p-3" /> {/* Empty corner */}
        {days.map((date, i) => (
          <div
            key={i}
            className={cn(
              'bg-white p-3 text-center transition-colors',
              isToday(date) && 'bg-primary/5'
            )}
          >
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {date.toLocaleDateString(undefined, { weekday: 'short' })}
            </div>
            <div
              className={cn(
                'mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold transition-colors',
                isToday(date)
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground'
              )}
            >
              {date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* All-day events row */}
      {hasAnyAllDayEvents && (
        <div className="grid grid-cols-8 gap-px bg-secondary/50 border-b border-secondary">
          <div className="bg-white p-2 text-xs font-medium text-muted-foreground text-right pr-3">
            All day
          </div>
          {days.map((date, dayIndex) => {
            const allDayEvents = getAllDayEventsForDay(date);
            return (
              <div
                key={dayIndex}
                className={cn(
                  'bg-white min-h-10 p-1',
                  isToday(date) && 'bg-primary/5'
                )}
              >
                {allDayEvents.map((event) => {
                  const color = getEventColor(event);
                  return (
                    <div
                      key={event.id}
                      className="rounded-lg px-2 py-1 text-xs font-medium cursor-pointer transition-all duration-200 hover:scale-[1.02] truncate mb-1"
                      style={{
                        backgroundColor: `${color}25`,
                        color: color,
                      }}
                      onClick={() => onEventClick(event)}
                    >
                      {event.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Time grid */}
      <div className="grid grid-cols-8 gap-px bg-secondary/50">
        {hours.map((hour) => (
          <React.Fragment key={hour}>
            {/* Time label */}
            <div className={cn('p-2 text-xs font-medium text-muted-foreground text-right pr-3', getTimeSlotBg(hour))}>
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
                    'min-h-14 border-t border-secondary/50 relative cursor-pointer hover:bg-secondary/20',
                    isToday(date) ? 'bg-primary/5' : getTimeSlotBg(hour)
                  )}
                  onDoubleClick={(e) => {
                    // Calculate minutes based on click position within the cell
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relativeY = e.clientY - rect.top;
                    const minutes = relativeY < rect.height / 2 ? 0 : 30;
                    const clickedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minutes, 0);
                    onSlotDoubleClick(clickedDate);
                  }}
                >
                  {dayEvents.map((event) => {
                    const color = getEventColor(event);
                    return (
                      <div
                        key={event.id}
                        className="absolute inset-x-1 top-1 rounded-lg px-2 py-1 text-xs font-medium cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-sm truncate"
                        style={{
                          backgroundColor: `${color}25`,
                          color: color,
                        }}
                        onClick={() => onEventClick(event)}
                      >
                        {event.title}
                      </div>
                    );
                  })}
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
  calendars,
  onEventClick,
  onSlotDoubleClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  onEventClick: (event: CalendarEvent) => void;
  onSlotDoubleClick: (date: Date) => void;
}) {
  const getEventColor = (event: CalendarEvent) => {
    if (event.color) return event.color;
    const calendar = calendars.find((c) => c.id === event.calendarId);
    return calendar?.color || '#f66951'; // Default to Skylight coral
  };

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

  // Get background color based on time of day - subtle night indicator only
  const getTimeSlotBg = (hour: number) => {
    if (hour < 6 || hour >= 21) {
      // Night (before 6 AM or after 9 PM) - subtle gray
      return 'bg-secondary/20';
    }
    return 'bg-white';
  };

  return (
    <div className="overflow-auto rounded-2xl bg-white border border-secondary/30">
      {/* Day header - matches Week view style */}
      <div className="flex border-b border-secondary/50">
        <div className="w-24 p-3" /> {/* Empty corner to match time column */}
        <div
          className={cn(
            'flex-1 p-3 text-center transition-colors',
            isToday && 'bg-primary/5'
          )}
        >
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {currentDate.toLocaleDateString(undefined, { weekday: 'short' })}
          </div>
          <div
            className={cn(
              'mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold transition-colors',
              isToday
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-foreground'
            )}
          >
            {currentDate.getDate()}
          </div>
        </div>
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-secondary/50 p-3 bg-secondary/20">
          <div className="flex">
            <div className="w-24 p-2 text-sm font-medium text-muted-foreground text-right pr-4">
              All day
            </div>
            <div className="flex-1 p-1 space-y-2">
              {allDayEvents.map((event) => {
                const color = getEventColor(event);
                return (
                  <div
                    key={event.id}
                    className="rounded-xl px-4 py-2 text-sm font-medium cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-sm"
                    style={{
                      backgroundColor: `${color}25`,
                      color: color,
                    }}
                    onClick={() => onEventClick(event)}
                  >
                    {event.title}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Time slots */}
      <div className="divide-y divide-secondary/50">
        {hours.map((hour) => {
          const hourEvents = getEventsForHour(hour);
          return (
            <div key={hour} className={cn('flex min-h-14', getTimeSlotBg(hour))}>
              <div className="w-24 p-3 text-sm font-medium text-muted-foreground text-right pr-4 border-r border-secondary/50">
                {formatHour(hour)}
              </div>
              <div
                className="flex-1 p-2 relative cursor-pointer hover:bg-secondary/20"
                onDoubleClick={(e) => {
                  // Calculate minutes based on click position within the cell
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relativeY = e.clientY - rect.top;
                  const minutes = relativeY < rect.height / 2 ? 0 : 30;
                  const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour, minutes, 0);
                  onSlotDoubleClick(clickedDate);
                }}
              >
                {hourEvents.map((event) => {
                  const color = getEventColor(event);
                  return (
                    <div
                      key={event.id}
                      className="rounded-xl px-4 py-2 text-sm cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-sm mb-2"
                      style={{
                        backgroundColor: `${color}25`,
                        color: color,
                      }}
                      onClick={() => onEventClick(event)}
                    >
                      <div className="font-semibold">{event.title}</div>
                      <div className="text-xs opacity-80 mt-0.5">
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
                  );
                })}
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
