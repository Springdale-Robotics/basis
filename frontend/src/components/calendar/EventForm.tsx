import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { eventSchema, type EventFormData } from '@/types/forms';
import type { CalendarEvent, Calendar } from '@/types/models';

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

const recurrenceOptions = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
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
          recurrence: typeof event.recurrence === 'string' ? event.recurrence : 'none',
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

  // Handle format conversion when toggling all-day switch
  useEffect(() => {
    if (startTime && endTime) {
      if (allDay) {
        // Converting to date-only format (yyyy-MM-dd)
        if (startTime.includes('T')) {
          setValue('startTime', startTime.split('T')[0]);
        }
        if (endTime.includes('T')) {
          setValue('endTime', endTime.split('T')[0]);
        }
      } else {
        // Converting to datetime-local format (yyyy-MM-dd'T'HH:mm)
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
          recurrence: typeof event.recurrence === 'string' ? event.recurrence : 'none',
        });
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
      }
    }
  }, [open, event, defaultDate, calendars, reset]);

  const handleFormSubmit = (data: EventFormData) => {
    onSubmit(data);
    reset();
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
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
                          style={{ backgroundColor: calendar.color }}
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

          <div className="space-y-2">
            <Label htmlFor="recurrence">Repeat</Label>
            <Select
              value={recurrence}
              onValueChange={(value) => setValue('recurrence', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Does not repeat" />
              </SelectTrigger>
              <SelectContent>
                {recurrenceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
