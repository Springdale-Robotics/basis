import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Search } from 'lucide-react';
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
import { searchEmojis } from '@/lib/emoji-picker-data';
import { cn } from '@/lib/utils';

interface AreaFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area?: StorageArea | null;
  onSubmit: (data: StorageAreaFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
}

export function AreaForm({
  open,
  onOpenChange,
  area,
  onSubmit,
  onDelete,
  isSubmitting,
}: AreaFormProps) {
  const isEditing = !!area;
  const [iconSearch, setIconSearch] = useState('');

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
      ? { name: area.name, icon: area.icon || '📦' }
      : { name: '', icon: '📦' },
  });

  const icon = watch('icon');
  const name = watch('name');

  useEffect(() => {
    if (open) {
      reset(
        area
          ? { name: area.name, icon: area.icon || '📦' }
          : { name: '', icon: '📦' }
      );
      setIconSearch('');
    }
  }, [open, area, reset]);

  // Default icon search to the area name
  const effectiveSearch = iconSearch || name || '';
  const matchingEmojis = useMemo(() => searchEmojis(effectiveSearch, 36), [effectiveSearch]);

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
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Storage Area' : 'Add Storage Area'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="area-name">Name</Label>
            <div className="flex items-center gap-2">
              <span className="text-2xl w-10 h-10 flex items-center justify-center rounded-md border bg-muted/50">
                {icon}
              </span>
              <Input
                id="area-name"
                placeholder="e.g., Kitchen Pantry"
                {...register('name')}
                className="flex-1"
              />
            </div>
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search icons..."
                value={iconSearch}
                onChange={(e) => setIconSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="grid grid-cols-9 gap-1 max-h-[180px] overflow-y-auto rounded-md border p-2">
              {matchingEmojis.length > 0 ? (
                matchingEmojis.map((entry, i) => (
                  <button
                    key={`${entry.emoji}-${i}`}
                    type="button"
                    className={cn(
                      'h-8 w-8 flex items-center justify-center rounded text-lg hover:bg-muted transition-colors',
                      icon === entry.emoji && 'bg-primary/15 ring-1 ring-primary'
                    )}
                    onClick={() => setValue('icon', entry.emoji)}
                    title={entry.name}
                  >
                    {entry.emoji}
                  </button>
                ))
              ) : (
                <p className="col-span-9 text-center text-xs text-muted-foreground py-4">
                  No matching icons
                </p>
              )}
            </div>
            {!iconSearch && name && (
              <p className="text-xs text-muted-foreground">
                Showing icons matching "{name}"
              </p>
            )}
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
