import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Loader2, ChevronDown, ChevronUp, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { eventSchema, type EventFormData } from '@/types/forms';
import type { CalendarEvent, Calendar } from '@/types/models';
import { useTheme } from '@/hooks/useTheme';
import { getColorForIndex, type ColorPalette } from '@/lib/theme-presets';
import {
  RecurrenceEditor,
  type RecurrenceOptions,
  getRecurrenceSummary,
  optionsToRRule,
  parseRRule,
} from './RecurrenceEditor';

interface EventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: CalendarEvent | null;
  calendars: Calendar[];
  defaultDate?: Date;
  onSubmit: (data: EventFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
}

const quickRecurrenceOptions = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'weekdays', label: 'Every weekday (Mon-Fri)' },
  { value: 'custom', label: 'Custom...' },
];

export function EventForm({
  open,
  onOpenChange,
  event,
  calendars,
  defaultDate,
  onSubmit,
  onDelete,
  isSubmitting,
}: EventFormProps) {
  const isEditing = !!event;
  const [showCustomRecurrence, setShowCustomRecurrence] = useState(false);
  const [recurrenceOptions, setRecurrenceOptions] = useState<RecurrenceOptions>({
    frequency: 'none',
    interval: 1,
    endType: 'never',
  });
  const { colorPalette } = useTheme();

  // Helper to get calendar color from colorIndex
  const getCalendarColor = (calendar: Calendar): string => {
    if (calendar.colorIndex !== undefined && calendar.colorIndex >= 0) {
      return getColorForIndex(colorPalette as ColorPalette, calendar.colorIndex);
    }
    return calendar.color || '#4A90D9';
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<EventFormData>({
    resolver: zodResolver(eventSchema),
    defaultValues: event
      ? {
          title: event.title,
          description: event.description || '',
          startTime: format(new Date(event.startTime), "yyyy-MM-dd'T'HH:mm"),
          endTime: format(new Date(event.endTime), "yyyy-MM-dd'T'HH:mm"),
          allDay: event.allDay,
          calendarId: event.calendarId,
          location: event.location || '',
          recurrence: event.recurrenceRule || 'none',
        }
      : {
          title: '',
          description: '',
          startTime: defaultDate
            ? format(defaultDate, "yyyy-MM-dd'T'HH:mm")
            : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
          endTime: defaultDate
            ? format(new Date(defaultDate.getTime() + 3600000), "yyyy-MM-dd'T'HH:mm")
            : format(new Date(Date.now() + 3600000), "yyyy-MM-dd'T'HH:mm"),
          allDay: false,
          calendarId: calendars[0]?.id || '',
          location: '',
          recurrence: 'none',
        },
  });

  const allDay = watch('allDay');
  const calendarId = watch('calendarId');
  const recurrence = watch('recurrence');
  const startTime = watch('startTime');
  const endTime = watch('endTime');

  // Parse start date for recurrence options
  const startDate = useMemo(() => {
    return startTime ? new Date(startTime) : new Date();
  }, [startTime]);

  // Initialize recurrence options from event
  useEffect(() => {
    if (event?.recurrenceRule) {
      const parsed = parseRRule(event.recurrenceRule);
      setRecurrenceOptions(parsed);
      // Check if it's a custom rule (has complex options)
      const isCustom = parsed.frequency !== 'none' && (
        (parsed.byDay && parsed.byDay.length > 1) ||
        parsed.endType !== 'never' ||
        (parsed.interval && parsed.interval > 1) ||
        parsed.monthlyType === 'dayOfWeek'
      );
      setShowCustomRecurrence(isCustom);
    }
  }, [event?.recurrenceRule]);

  // Handle format conversion when toggling all-day switch
  useEffect(() => {
    if (startTime && endTime) {
      if (allDay) {
        if (startTime.includes('T')) {
          setValue('startTime', startTime.split('T')[0]);
        }
        if (endTime.includes('T')) {
          setValue('endTime', endTime.split('T')[0]);
        }
      } else {
        if (!startTime.includes('T')) {
          setValue('startTime', `${startTime}T09:00`);
        }
        if (!endTime.includes('T')) {
          setValue('endTime', `${endTime}T10:00`);
        }
      }
    }
  }, [allDay, setValue]);

  // Reset form when event changes or dialog opens
  useEffect(() => {
    if (open) {
      if (event) {
        const dateFormat = event.allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm";
        reset({
          title: event.title,
          description: event.description || '',
          startTime: format(new Date(event.startTime), dateFormat),
          endTime: format(new Date(event.endTime), dateFormat),
          allDay: event.allDay,
          calendarId: event.calendarId,
          location: event.location || '',
          recurrence: event.recurrenceRule || 'none',
        });
        const parsed = parseRRule(event.recurrenceRule);
        setRecurrenceOptions(parsed);
      } else {
        reset({
          title: '',
          description: '',
          startTime: defaultDate
            ? format(defaultDate, "yyyy-MM-dd'T'HH:mm")
            : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
          endTime: defaultDate
            ? format(new Date(defaultDate.getTime() + 3600000), "yyyy-MM-dd'T'HH:mm")
            : format(new Date(Date.now() + 3600000), "yyyy-MM-dd'T'HH:mm"),
          allDay: false,
          calendarId: calendars[0]?.id || '',
          location: '',
          recurrence: 'none',
        });
        setRecurrenceOptions({
          frequency: 'none',
          interval: 1,
          endType: 'never',
        });
        setShowCustomRecurrence(false);
      }
    }
  }, [open, event, defaultDate, calendars, reset]);

  // Handle quick recurrence selection
  const handleQuickRecurrenceChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomRecurrence(true);
      // Initialize with weekly if currently none
      if (recurrenceOptions.frequency === 'none') {
        const dayIndex = startDate.getDay();
        const dayMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        setRecurrenceOptions({
          frequency: 'weekly',
          interval: 1,
          endType: 'never',
          byDay: [dayMap[dayIndex]],
        });
      }
      return;
    }

    setShowCustomRecurrence(false);

    if (value === 'none') {
      setRecurrenceOptions({ frequency: 'none', interval: 1, endType: 'never' });
      setValue('recurrence', 'none');
    } else if (value === 'weekdays') {
      setRecurrenceOptions({
        frequency: 'weekly',
        interval: 1,
        endType: 'never',
        byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
      });
      setValue('recurrence', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    } else {
      // Simple presets
      const presetOptions: RecurrenceOptions = {
        frequency: value as 'daily' | 'weekly' | 'monthly' | 'yearly',
        interval: value === 'biweekly' ? 2 : 1,
        endType: 'never',
      };
      if (value === 'biweekly') {
        presetOptions.frequency = 'weekly';
      }
      setRecurrenceOptions(presetOptions);
      setValue('recurrence', value);
    }
  };

  // Update form value when recurrence options change
  useEffect(() => {
    if (showCustomRecurrence) {
      const rrule = optionsToRRule(recurrenceOptions, startDate);
      setValue('recurrence', rrule || 'none');
    }
  }, [recurrenceOptions, showCustomRecurrence, startDate, setValue]);

  // Get display value for recurrence dropdown
  const recurrenceDisplayValue = useMemo(() => {
    if (recurrence === 'none' || !recurrence) return 'none';
    if (showCustomRecurrence || recurrence.includes('FREQ=')) {
      return 'custom';
    }
    // Map preset values
    if (['daily', 'weekly', 'biweekly', 'monthly', 'yearly'].includes(recurrence)) {
      return recurrence;
    }
    return 'custom';
  }, [recurrence, showCustomRecurrence]);

  const handleFormSubmit = (data: EventFormData) => {
    // Convert recurrence to RRULE format if needed
    const finalData = { ...data };

    // For all-day events, add noon time to avoid timezone boundary issues
    // (Date-only strings like '2024-01-15' are interpreted as UTC midnight,
    // which shifts to the previous day for negative UTC offsets)
    if (data.allDay) {
      if (!data.startTime.includes('T')) {
        finalData.startTime = `${data.startTime}T12:00`;
      }
      if (!data.endTime.includes('T')) {
        finalData.endTime = `${data.endTime}T12:00`;
      }
    }

    if (showCustomRecurrence) {
      finalData.recurrence = optionsToRRule(recurrenceOptions, startDate) || 'none';
    } else if (data.recurrence && !data.recurrence.includes('FREQ=') && data.recurrence !== 'none') {
      // Convert preset to RRULE
      const presetMap: Record<string, string> = {
        'daily': 'FREQ=DAILY',
        'weekly': 'FREQ=WEEKLY',
        'biweekly': 'FREQ=WEEKLY;INTERVAL=2',
        'monthly': 'FREQ=MONTHLY',
        'yearly': 'FREQ=YEARLY',
      };
      finalData.recurrence = presetMap[data.recurrence] || data.recurrence;
    }
    onSubmit(finalData);
    reset();
  };

  const handleClose = () => {
    reset();
    setShowCustomRecurrence(false);
    onOpenChange(false);
  };

  // Determine if this is a recurring event being edited
  const isRecurringEvent = isEditing && event?.recurrenceRule;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Event' : 'New Event'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Add title"
              {...register('title')}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="calendarId">Calendar</Label>
            <Select
              value={calendarId}
              onValueChange={(value) => setValue('calendarId', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select calendar" />
              </SelectTrigger>
              <SelectContent>
                {calendars
                  .filter((cal) => !cal.isReadOnly)
                  .map((calendar) => (
                    <SelectItem key={calendar.id} value={calendar.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: getCalendarColor(calendar) }}
                        />
                        {calendar.name}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="allDay"
              checked={allDay}
              onCheckedChange={(checked) => setValue('allDay', checked)}
            />
            <Label htmlFor="allDay">All day</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start</Label>
              <Input
                id="startTime"
                type={allDay ? 'date' : 'datetime-local'}
                {...register('startTime')}
              />
              {errors.startTime && (
                <p className="text-sm text-destructive">
                  {errors.startTime.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End</Label>
              <Input
                id="endTime"
                type={allDay ? 'date' : 'datetime-local'}
                {...register('endTime')}
              />
              {errors.endTime && (
                <p className="text-sm text-destructive">
                  {errors.endTime.message}
                </p>
              )}
            </div>
          </div>

          {/* Recurrence Section */}
          <Collapsible open={showCustomRecurrence} onOpenChange={setShowCustomRecurrence}>
            <div className="space-y-2">
              <Label htmlFor="recurrence">Repeat</Label>
              <div className="flex gap-2">
                <Select
                  value={recurrenceDisplayValue}
                  onValueChange={handleQuickRecurrenceChange}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Does not repeat" />
                  </SelectTrigger>
                  <SelectContent>
                    {quickRecurrenceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {recurrenceDisplayValue !== 'none' && (
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline" size="icon">
                      {showCustomRecurrence ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                )}
              </div>

              {/* Recurrence summary */}
              {recurrenceOptions.frequency !== 'none' && !showCustomRecurrence && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Repeat className="h-4 w-4" />
                  {getRecurrenceSummary(recurrenceOptions, startDate)}
                </div>
              )}
            </div>

            <CollapsibleContent className="pt-4">
              <div className="border rounded-lg p-4 bg-muted/30">
                <RecurrenceEditor
                  value={recurrenceOptions}
                  onChange={setRecurrenceOptions}
                  startDate={startDate}
                />
              </div>
              {/* Summary in custom mode */}
              {recurrenceOptions.frequency !== 'none' && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Repeat className="h-4 w-4" />
                  {getRecurrenceSummary(recurrenceOptions, startDate)}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              placeholder="Add location"
              {...register('location')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Add description"
              {...register('description')}
            />
          </div>

          <DialogFooter className="flex justify-between">
            {isEditing && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={onDelete}
                disabled={isSubmitting}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isEditing ? 'Save' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
