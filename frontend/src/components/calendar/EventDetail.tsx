import { format } from 'date-fns';
import { Calendar, Clock, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

interface EventDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  calendar?: CalendarType;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}

export function EventDetail({
  open,
  onOpenChange,
  event,
  calendar,
  onEdit,
  onDelete,
  isDeleting,
}: EventDetailProps) {
  if (!event) return null;

  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  const isSameDay = startDate.toDateString() === endDate.toDateString();

  const formatEventTime = () => {
    if (event.allDay) {
      if (isSameDay) {
        return format(startDate, 'EEEE, MMMM d, yyyy');
      }
      return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
    }

    if (isSameDay) {
      return (
        <>
          <div>{format(startDate, 'EEEE, MMMM d, yyyy')}</div>
          <div className="text-muted-foreground">
            {format(startDate, 'h:mm a')} - {format(endDate, 'h:mm a')}
          </div>
        </>
      );
    }

    return (
      <>
        <div>{format(startDate, 'MMM d, h:mm a')} -</div>
        <div>{format(endDate, 'MMM d, h:mm a, yyyy')}</div>
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] p-0 gap-0">
        {/* Header with colored bar */}
        <div
          className="h-2 rounded-t-lg"
          style={{ backgroundColor: calendar?.color || '#6366f1' }}
        />

        <div className="p-6">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-xl font-semibold text-left">
              {event.title}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Date and time */}
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="text-sm">
                {formatEventTime()}
              </div>
            </div>

            {/* Calendar */}
            {calendar && (
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: calendar.color }}
                  />
                  <span className="text-sm">{calendar.name}</span>
                </div>
              </div>
            )}

            {/* Location */}
            {event.location && (
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                <span className="text-sm">{event.location}</span>
              </div>
            )}

            {/* Description */}
            {event.description && (
              <div className="pt-2 border-t">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-6 mt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
            <Button size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
