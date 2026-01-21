import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useState } from 'react';

export type RecurrenceDeleteScope = 'single' | 'all' | 'following';

interface DeleteRecurringEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scope: RecurrenceDeleteScope) => void;
  eventTitle?: string;
}

export function DeleteRecurringEventDialog({
  open,
  onOpenChange,
  onConfirm,
  eventTitle,
}: DeleteRecurringEventDialogProps) {
  const [scope, setScope] = useState<RecurrenceDeleteScope>('single');

  const handleConfirm = () => {
    onConfirm(scope);
    setScope('single'); // Reset for next use
  };

  const handleCancel = () => {
    onOpenChange(false);
    setScope('single'); // Reset for next use
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete recurring event</AlertDialogTitle>
          <AlertDialogDescription>
            {eventTitle ? `"${eventTitle}" is a recurring event. ` : 'This is a recurring event. '}
            Would you like to delete only this event, all events in the series, or this and following events?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup
          value={scope}
          onValueChange={(value: string) => setScope(value as RecurrenceDeleteScope)}
          className="py-4 space-y-3"
        >
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="single" id="delete-single" className="mt-0.5" />
            <div>
              <Label htmlFor="delete-single" className="font-medium">This event only</Label>
              <p className="text-sm text-muted-foreground">
                Only this occurrence will be deleted
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <RadioGroupItem value="following" id="delete-following" className="mt-0.5" />
            <div>
              <Label htmlFor="delete-following" className="font-medium">This and following events</Label>
              <p className="text-sm text-muted-foreground">
                This event and all future occurrences will be deleted
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <RadioGroupItem value="all" id="delete-all" className="mt-0.5" />
            <div>
              <Label htmlFor="delete-all" className="font-medium">All events</Label>
              <p className="text-sm text-muted-foreground">
                All occurrences of this recurring event will be deleted
              </p>
            </div>
          </div>
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteRecurringEventDialog;
