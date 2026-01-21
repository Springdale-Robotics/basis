import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Calendar } from '@/types/models';

interface CalendarFormData {
  name: string;
  color: string;
  type: 'individual' | 'group';
}

interface CalendarFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendar?: Calendar | null;
  onSubmit: (data: CalendarFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
  isDeleting?: boolean;
}

const colorOptions = [
  { value: '#f66951', label: 'Coral' },
  { value: '#4A90D9', label: 'Blue' },
  { value: '#50C878', label: 'Green' },
  { value: '#FFD700', label: 'Yellow' },
  { value: '#9B59B6', label: 'Purple' },
  { value: '#E91E63', label: 'Pink' },
  { value: '#00BCD4', label: 'Teal' },
  { value: '#FF9800', label: 'Orange' },
];

export function CalendarForm({
  open,
  onOpenChange,
  calendar,
  onSubmit,
  onDelete,
  isSubmitting,
  isDeleting,
}: CalendarFormProps) {
  const isEditing = !!calendar;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CalendarFormData>({
    defaultValues: calendar
      ? {
          name: calendar.name,
          color: calendar.color,
          type: calendar.type === 'synced' ? 'group' : calendar.type,
        }
      : {
          name: '',
          color: '#f66951',
          type: 'group',
        },
  });

  const selectedColor = watch('color');
  const selectedType = watch('type');

  useEffect(() => {
    if (open) {
      if (calendar) {
        reset({
          name: calendar.name,
          color: calendar.color,
          type: calendar.type === 'synced' ? 'group' : calendar.type,
        });
      } else {
        reset({
          name: '',
          color: '#f66951',
          type: 'group',
        });
      }
    }
  }, [open, calendar, reset]);

  const handleFormSubmit = (data: CalendarFormData) => {
    onSubmit(data);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Calendar' : 'New Calendar'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Calendar name"
              {...register('name', { required: 'Name is required' })}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <Select
              value={selectedColor}
              onValueChange={(value) => setValue('color', value)}
            >
              <SelectTrigger>
                <SelectValue>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: selectedColor }}
                    />
                    {colorOptions.find((c) => c.value === selectedColor)?.label || 'Select color'}
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {colorOptions.map((color) => (
                  <SelectItem key={color.value} value={color.value}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: color.value }}
                      />
                      {color.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={selectedType}
                onValueChange={(value) => setValue('type', value as 'individual' | 'group')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Shared (Group)</SelectItem>
                  <SelectItem value="individual">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter className="flex justify-between">
            {isEditing && onDelete && !calendar?.isSynced && (
              <Button
                type="button"
                variant="destructive"
                onClick={onDelete}
                disabled={isSubmitting || isDeleting}
              >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || isDeleting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Save' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
