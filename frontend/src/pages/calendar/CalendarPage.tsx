import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight, Keyboard, PanelLeftClose, PanelLeft, Camera, Share2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EventForm } from '@/components/calendar/EventForm';
import { EventDetail } from '@/components/calendar/EventDetail';
import { CalendarForm, type CalendarAccessPreset } from '@/components/calendar/CalendarForm';
import { AccessTooltip } from '@/components/calendar/CalendarSidebar';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import { AgendaView } from '@/components/calendar/AgendaView';
import { useAuth } from '@/hooks/useAuth';
import { EditRecurringEventDialog, type RecurrenceEditScope } from '@/components/calendar/EditRecurringEventDialog';
import { DeleteRecurringEventDialog, type RecurrenceDeleteScope } from '@/components/calendar/DeleteRecurringEventDialog';
import { CalendarSearch, CalendarSearchRef } from '@/components/calendar/CalendarSearch';
import { EditGate } from '@/components/permissions';
import { ImageParseDialog } from '@/components/image-parse';
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
import { useTheme } from '@/hooks/useTheme';
import { getColorForIndex } from '@/lib/theme-presets';
import type { EventFormData } from '@/types/forms';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

type ViewMode = 'month' | 'week' | 'day' | 'agenda';

export function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [calendarFormOpen, setCalendarFormOpen] = useState(false);
  const [calendarFormTab, setCalendarFormTab] = useState<'general' | 'sharing' | 'public'>('general');
  const [selectedCalendar, setSelectedCalendar] = useState<CalendarType | null>(null);
  const [visibleCalendars, setVisibleCalendars] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [defaultEventDate, setDefaultEventDate] = useState<Date | undefined>(undefined);
  const [editRecurringDialogOpen, setEditRecurringDialogOpen] = useState(false);
  const [deleteRecurringDialogOpen, setDeleteRecurringDialogOpen] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<EventFormData | null>(null);
  const [imageParseOpen, setImageParseOpen] = useState(false);
  const queryClient = useQueryClient();
  const searchRef = useRef<CalendarSearchRef>(null);
  const { colorPalette } = useTheme();
  const { user } = useAuth();

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
    mutationFn: async (data: {
      name: string;
      colorIndex: number;
      type: 'individual' | 'group';
      accessPreset?: CalendarAccessPreset;
    }) => {
      const result = await calendarsApi.create({
        name: data.name,
        colorIndex: data.colorIndex,
        type: data.type,
      });
      // Apply the access preset, if any. 'everyone' is the default (no rules
      // means everyone gets edit), so we skip the API call there.
      const preset = data.accessPreset ?? 'everyone';
      const calendarId = result.calendar.id;
      if (preset === 'admins_only') {
        await calendarsApi.upsertAccessRule(calendarId, {
          principalType: 'role',
          principalId: 'admin',
          permissionLevel: 'edit',
        });
      } else if (preset === 'kids_only') {
        await calendarsApi.upsertAccessRule(calendarId, {
          principalType: 'role',
          principalId: 'kid',
          permissionLevel: 'edit',
        });
      } else if (preset === 'just_me' && user?.id) {
        await calendarsApi.upsertAccessRule(calendarId, {
          principalType: 'user',
          principalId: user.id,
          permissionLevel: 'edit',
        });
      }
      return { result, openCustom: preset === 'custom' };
    },
    onSuccess: ({ result, openCustom }) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-access', result.calendar.id] });
      setVisibleCalendars((prev) => [...prev, result.calendar.id]);
      setCalendarFormOpen(false);
      if (openCustom) {
        // Open the just-created calendar in edit mode so the user can finish
        // configuring access via the share dialog.
        setSelectedCalendar(result.calendar);
        setCalendarFormOpen(true);
      } else {
        setSelectedCalendar(null);
      }
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
    mutationFn: (data: { id: string; name: string; colorIndex: number }) =>
      calendarsApi.update(data.id, { name: data.name, colorIndex: data.colorIndex }),
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
    setCalendarFormTab('general');
    setCalendarFormOpen(true);
  };

  const handleEditCalendar = (calendar: CalendarType) => {
    setSelectedCalendar(calendar);
    setCalendarFormTab('general');
    setCalendarFormOpen(true);
  };

  const handleShareCalendar = (calendar: CalendarType) => {
    setSelectedCalendar(calendar);
    setCalendarFormTab('sharing');
    setCalendarFormOpen(true);
  };

  const handleCalendarFormSubmit = (data: {
    name: string;
    colorIndex: number;
    type: 'individual' | 'group';
    accessPreset?: CalendarAccessPreset;
  }) => {
    if (selectedCalendar) {
      updateCalendarMutation.mutate({ id: selectedCalendar.id, name: data.name, colorIndex: data.colorIndex });
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

  // Drag-and-drop: move event to a new start time (preserves duration).
  const moveEventMutation = useMutation({
    mutationFn: async ({ event, newStart }: { event: CalendarEvent; newStart: Date }) => {
      const isVirtual = event.isVirtualInstance;
      const master = isVirtual ? event.masterEvent : event;
      const eventId = master?.id || event.id;
      const calendarId = master?.calendarId || event.calendarId;
      const oldStart = new Date(event.startTime).getTime();
      const oldEnd = new Date(event.endTime).getTime();
      const duration = oldEnd - oldStart;
      const newEnd = new Date(newStart.getTime() + duration);
      // For recurring events, only adjust this instance via an exception so we
      // don't reshuffle the whole series.
      if (master?.recurrenceRule) {
        return calendarsApi.createException(calendarId, eventId, {
          originalStartTime: event.startTime,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        });
      }
      return calendarsApi.updateEvent(calendarId, eventId, {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (error) => {
      toast({
        title: 'Failed to move event',
        description: error instanceof Error ? error.message : 'An error occurred',
        variant: 'destructive',
      });
    },
  });

  // For month-view drops we land the event on a new day, preserving the
  // event's existing time-of-day (so a 3 PM meeting stays at 3 PM).
  const handleEventDropDay = (event: CalendarEvent, newDay: Date) => {
    const oldStart = new Date(event.startTime);
    const newStart = new Date(newDay);
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
    moveEventMutation.mutate({ event, newStart });
  };

  const handleEventDropTime = (event: CalendarEvent, newStart: Date) => {
    moveEventMutation.mutate({ event, newStart });
  };

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

  // Helper to resolve calendar color from colorIndex with fallback to hex color
  const getCalendarColor = (calendar: CalendarType): string => {
    // Use colorIndex if available, otherwise fall back to color hex
    if (calendar.colorIndex !== undefined && calendar.colorIndex >= 0) {
      return getColorForIndex(colorPalette, calendar.colorIndex);
    }
    return calendar.color || '#4A90D9';
  };

  // Filter events by visible calendars
  const filteredEvents = (events?.events || []).filter((event) =>
    visibleCalendars.includes(event.calendarId)
  );

  const navigatePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') newDate.setMonth(newDate.getMonth() - 1);
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() - 7);
    else if (viewMode === 'day') newDate.setDate(newDate.getDate() - 1);
    else newDate.setMonth(newDate.getMonth() - 1); // agenda: one month back
    setCurrentDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') newDate.setMonth(newDate.getMonth() + 1);
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() + 7);
    else if (viewMode === 'day') newDate.setDate(newDate.getDate() + 1);
    else newDate.setMonth(newDate.getMonth() + 1); // agenda: one month forward
    setCurrentDate(newDate);
  };

  const goToToday = () => setCurrentDate(new Date());

  // Period label adapts to the active view.
  const periodLabel = (() => {
    if (viewMode === 'day') {
      return currentDate.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    if (viewMode === 'week') {
      const ws = new Date(currentDate);
      ws.setDate(currentDate.getDate() - currentDate.getDay());
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      const sameYear = ws.getFullYear() === we.getFullYear();
      const startMonthDay = ws.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      if (sameMonth) {
        return `${startMonthDay} – ${we.getDate()}, ${we.getFullYear()}`;
      }
      const endMonthDay = we.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      if (sameYear) {
        return `${startMonthDay} – ${endMonthDay}, ${we.getFullYear()}`;
      }
      return `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} – ${we.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return currentDate.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  })();

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
    onAgendaView: () => setViewMode('agenda'),
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
              <EditGate feature="calendars">
                <Button onClick={handleCreateCalendar} className="w-full mb-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Calendar
                </Button>
              </EditGate>

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
                        myCalendars.map((calendar) => {
                          const calColor = getCalendarColor(calendar);
                          return (
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
                                  borderColor: calColor,
                                  backgroundColor: visibleCalendars.includes(calendar.id)
                                    ? calColor
                                    : 'transparent',
                                }}
                              />
                              <AccessTooltip calendarId={calendar.id}>
                                <span
                                  className={cn(
                                    'text-sm font-medium truncate cursor-default',
                                    !visibleCalendars.includes(calendar.id) && 'text-muted-foreground'
                                  )}
                                >
                                  {calendar.name}
                                </span>
                              </AccessTooltip>
                            </div>
                            <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleShareCalendar(calendar)}
                                title="Share / access"
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleEditCalendar(calendar)}
                                title="Edit calendar"
                              >
                                <Settings className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          );
                        })
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
                          {syncedCalendars.map((calendar) => {
                            const calColor = getCalendarColor(calendar);
                            return (
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
                                    borderColor: calColor,
                                    backgroundColor: visibleCalendars.includes(calendar.id)
                                      ? calColor
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
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>

              <div className="mt-3 border-t pt-3">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                >
                  <Link to="/settings/calendars">
                    <Settings className="mr-2 h-3.5 w-3.5" />
                    Calendar settings
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <PageHeader
          title="Calendar"
          prefix={
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
          }
          actions={
            <div className="flex gap-2">
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
              <EditGate feature="calendars">
                <Button variant="outline" onClick={() => setImageParseOpen(true)}>
                  <Camera className="mr-2 h-4 w-4" />
                  Scan
                </Button>
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Event
                </Button>
              </EditGate>
            </div>
          }
        />

        <Card className="border-0 shadow-none bg-transparent">
          <CardContent className="p-0">
          {/* Calendar controls - Skylight style */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-card rounded-full shadow-sm border border-border p-1">
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
                {periodLabel}
              </span>
            </div>

            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList className="bg-card shadow-sm border border-border rounded-full p-1">
                <TabsTrigger value="month" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Month
                </TabsTrigger>
                <TabsTrigger value="week" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Week
                </TabsTrigger>
                <TabsTrigger value="day" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Day
                </TabsTrigger>
                <TabsTrigger value="agenda" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Agenda
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
              colorPalette={colorPalette}
              onEventClick={handleEventClick}
              onSlotDoubleClick={handleSlotDoubleClick}
              onEventDrop={handleEventDropDay}
            />
          ) : viewMode === 'week' ? (
            <WeekView
              currentDate={currentDate}
              events={filteredEvents}
              calendars={calendars}
              colorPalette={colorPalette}
              onEventClick={handleEventClick}
              onSlotDoubleClick={handleSlotDoubleClick}
              onEventDrop={handleEventDropTime}
            />
          ) : viewMode === 'day' ? (
            <DayView
              currentDate={currentDate}
              events={filteredEvents}
              calendars={calendars}
              colorPalette={colorPalette}
              onEventClick={handleEventClick}
              onSlotDoubleClick={handleSlotDoubleClick}
              onEventDrop={handleEventDropTime}
            />
          ) : (
            <AgendaView
              currentDate={currentDate}
              events={filteredEvents}
              calendars={calendars}
              colorPalette={colorPalette}
              onEventClick={handleEventClick}
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
        initialTab={calendarFormTab}
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

      <ImageParseDialog
        open={imageParseOpen}
        onOpenChange={setImageParseOpen}
        defaultType="calendar_event"
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['events'] });
        }}
      />
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
  } else if (view === 'agenda') {
    // Show a month's worth of events starting from currentDate.
    // Nothing to adjust.
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
  } else if (view === 'agenda') {
    d.setMonth(d.getMonth() + 1);
  }
  d.setHours(23, 59, 59, 999);
  return d;
}
