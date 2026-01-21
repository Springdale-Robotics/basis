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

export type RecurrenceEditScope = 'single' | 'all' | 'following';

interface EditRecurringEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scope: RecurrenceEditScope) => void;
  eventTitle?: string;
}

export function EditRecurringEventDialog({
  open,
  onOpenChange,
  onConfirm,
  eventTitle,
}: EditRecurringEventDialogProps) {
  const [scope, setScope] = useState<RecurrenceEditScope>('single');

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
          <AlertDialogTitle>Edit recurring event</AlertDialogTitle>
          <AlertDialogDescription>
            {eventTitle ? `"${eventTitle}" is a recurring event. ` : 'This is a recurring event. '}
            Would you like to edit only this event, all events in the series, or this and following events?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup
          value={scope}
          onValueChange={(value: string) => setScope(value as RecurrenceEditScope)}
          className="py-4 space-y-3"
        >
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="single" id="edit-single" className="mt-0.5" />
            <div>
              <Label htmlFor="edit-single" className="font-medium">This event only</Label>
              <p className="text-sm text-muted-foreground">
                Only this occurrence will be changed
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <RadioGroupItem value="following" id="edit-following" className="mt-0.5" />
            <div>
              <Label htmlFor="edit-following" className="font-medium">This and following events</Label>
              <p className="text-sm text-muted-foreground">
                Changes will apply to this event and all future occurrences
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <RadioGroupItem value="all" id="edit-all" className="mt-0.5" />
            <div>
              <Label htmlFor="edit-all" className="font-medium">All events</Label>
              <p className="text-sm text-muted-foreground">
                All occurrences of this recurring event will be changed
              </p>
            </div>
          </div>
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default EditRecurringEventDialog;
