import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { storageAreaFormSchema, type StorageAreaFormData } from '@/types/forms';
import type { StorageArea } from '@/types/models';

interface AreaFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area?: StorageArea | null;
  onSubmit: (data: StorageAreaFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
}

const iconOptions = ['🏠', '🍳', '❄️', '🚿', '🛏️', '🧹', '📦', '🗄️', '🚗', '🌳'];

export function AreaForm({
  open,
  onOpenChange,
  area,
  onSubmit,
  onDelete,
  isSubmitting,
}: AreaFormProps) {
  const isEditing = !!area;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<StorageAreaFormData>({
    resolver: zodResolver(storageAreaFormSchema),
    defaultValues: area
      ? {
          name: area.name,
          icon: area.icon || '📦',
        }
      : {
          name: '',
          icon: '📦',
        },
  });

  const icon = watch('icon');

  // Reset form when area changes or dialog opens
  useEffect(() => {
    if (open) {
      reset(
        area
          ? { name: area.name, icon: area.icon || '📦' }
          : { name: '', icon: '📦' }
      );
    }
  }, [open, area, reset]);

  const handleFormSubmit = (data: StorageAreaFormData) => {
    onSubmit(data);
    reset();
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Storage Area' : 'Add Storage Area'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Kitchen Pantry"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {iconOptions.map((emoji) => (
                <Button
                  key={emoji}
                  type="button"
                  variant={icon === emoji ? 'default' : 'outline'}
                  size="icon"
                  onClick={() => setValue('icon', emoji)}
                >
                  {emoji}
                </Button>
              ))}
            </div>
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
                {isEditing ? 'Save' : 'Add Area'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
