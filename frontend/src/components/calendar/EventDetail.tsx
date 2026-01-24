import { format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Clock,
  MapPin,
  Pencil,
  Trash2,
  Users,
  User,
  Check,
  X,
  HelpCircle,
  Bell,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { calendarsApi } from '@/api/calendars';
import type { CalendarEvent, Calendar as CalendarType, RsvpStatus, EventAttendee } from '@/types/models';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/utils';

interface EventDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  calendar?: CalendarType;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
}

const rsvpStatusLabels: Record<RsvpStatus, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: 'Pending', icon: <HelpCircle className="h-3 w-3" />, color: 'bg-muted text-muted-foreground' },
  accepted: { label: 'Going', icon: <Check className="h-3 w-3" />, color: 'bg-success-muted text-success-muted-foreground' },
  declined: { label: 'Not going', icon: <X className="h-3 w-3" />, color: 'bg-error-muted text-error-muted-foreground' },
  maybe: { label: 'Maybe', icon: <HelpCircle className="h-3 w-3" />, color: 'bg-warning-muted text-warning-muted-foreground' },
};

function formatReminderTime(minutes: number): string {
  if (minutes === 0) return 'At time of event';
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours > 1 ? 's' : ''} before`;
  }
  const days = Math.floor(minutes / 1440);
  return `${days} day${days > 1 ? 's' : ''} before`;
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
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch event details with attendees
  const { data: eventDetails } = useQuery({
    queryKey: ['eventDetails', event?.calendarId, event?.id],
    queryFn: () => calendarsApi.getEventDetails(event!.calendarId, event!.id),
    enabled: open && !!event,
  });

  const rsvpMutation = useMutation({
    mutationFn: ({ attendeeId, status }: { attendeeId: string; status: RsvpStatus }) =>
      calendarsApi.updateRsvp(event!.calendarId, event!.id, attendeeId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventDetails', event?.calendarId, event?.id] });
    },
  });

  if (!event) return null;

  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const isSameDay = startDate.toDateString() === endDate.toDateString();

  const details = eventDetails?.event;
  const attendees = details?.attendees || [];
  const reminders = details?.reminders || [];
  const creator = details?.creator;

  // Find current user's attendance record
  const myAttendance = attendees.find((a: EventAttendee) => a.userId === user?.id);

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

  const handleRsvpChange = (status: RsvpStatus) => {
    if (myAttendance) {
      rsvpMutation.mutate({ attendeeId: myAttendance.id, status });
    }
  };

  const getAttendeeInitials = (attendee: EventAttendee) => {
    if (attendee.user?.displayName) {
      return attendee.user.displayName.charAt(0).toUpperCase();
    }
    if (attendee.displayName) {
      return attendee.displayName.charAt(0).toUpperCase();
    }
    if (attendee.email) {
      return attendee.email.charAt(0).toUpperCase();
    }
    return '?';
  };

  const getAttendeeName = (attendee: EventAttendee) => {
    return attendee.user?.displayName || attendee.displayName || attendee.email || 'Unknown';
  };

  // Count attendees by status
  const attendeeCounts = attendees.reduce(
    (acc: Record<RsvpStatus, number>, a: EventAttendee) => {
      acc[a.rsvpStatus] = (acc[a.rsvpStatus] || 0) + 1;
      return acc;
    },
    { pending: 0, accepted: 0, declined: 0, maybe: 0 }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] p-0 gap-0 max-h-[90vh] overflow-y-auto">
        {/* Header with colored bar */}
        <div
          className="h-2 rounded-t-lg"
          style={{ backgroundColor: event.color || calendar?.color || '#6366f1' }}
        />

        <div className="p-6">
          <DialogHeader className="pb-4">
            <DialogTitle className="text-xl font-semibold text-left">
              {event.title}
            </DialogTitle>
            {creator && (
              <p className="text-sm text-muted-foreground">
                Created by {creator.displayName}
              </p>
            )}
          </DialogHeader>

          <div className="space-y-4">
            {/* Date and time */}
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="text-sm">{formatEventTime()}</div>
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

            {/* Attendees section */}
            {attendees.length > 0 && (
              <div className="pt-2 border-t">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {attendees.length} guest{attendees.length !== 1 ? 's' : ''}
                  </span>
                  {attendeeCounts.accepted > 0 && (
                    <Badge variant="secondary" className="bg-success-muted text-success-muted-foreground text-xs">
                      {attendeeCounts.accepted} going
                    </Badge>
                  )}
                </div>

                {/* My RSVP */}
                {myAttendance && (
                  <div className="mb-3 p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium mb-2">Your response</div>
                    <Select
                      value={myAttendance.rsvpStatus}
                      onValueChange={(value) => handleRsvpChange(value as RsvpStatus)}
                      disabled={rsvpMutation.isPending}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="accepted">
                          <div className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-success" />
                            Going
                          </div>
                        </SelectItem>
                        <SelectItem value="maybe">
                          <div className="flex items-center gap-2">
                            <HelpCircle className="h-4 w-4 text-warning" />
                            Maybe
                          </div>
                        </SelectItem>
                        <SelectItem value="declined">
                          <div className="flex items-center gap-2">
                            <X className="h-4 w-4 text-error" />
                            Not going
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Attendee list */}
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {attendees.map((attendee: EventAttendee) => (
                    <div key={attendee.id} className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={attendee.user?.avatarUrl} />
                        <AvatarFallback className="text-xs">
                          {getAttendeeInitials(attendee)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm flex-1 truncate">
                        {getAttendeeName(attendee)}
                        {attendee.isOrganizer && (
                          <span className="text-muted-foreground ml-1">(organizer)</span>
                        )}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn('text-xs', rsvpStatusLabels[attendee.rsvpStatus].color)}
                      >
                        {rsvpStatusLabels[attendee.rsvpStatus].label}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reminders */}
            {reminders.length > 0 && (
              <div className="pt-2 border-t">
                <div className="flex items-center gap-2 mb-2">
                  <Bell className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Reminders</span>
                </div>
                <div className="space-y-1">
                  {reminders.map((reminder: { id: string; minutesBefore: number; reminderType: string }) => (
                    <div key={reminder.id} className="text-sm text-muted-foreground pl-7">
                      {formatReminderTime(reminder.minutesBefore)}
                    </div>
                  ))}
                </div>
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
            {!calendar?.isReadOnly && (
              <>
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
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
