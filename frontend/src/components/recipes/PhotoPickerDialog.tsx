import { useQuery } from '@tanstack/react-query';
import { ImageIcon, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { photosApi, filesMediaApi } from '@/api/media';
import { cn } from '@/lib/utils';

interface PhotoPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen file/photo id. */
  onSelect: (fileId: string) => void;
}

/**
 * Picks an existing photo from the Files/Photos library to use as a recipe
 * image. The selected photo's id is handed back; the recipe save copies and
 * processes it server-side (POST /recipes/:id/image/from-file).
 */
export function PhotoPickerDialog({ open, onOpenChange, onSelect }: PhotoPickerDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['photos', 'picker'],
    queryFn: () => photosApi.list({ limit: 200 }),
    enabled: open,
  });

  const photos = data?.photos ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose from Photos</DialogTitle>
          <DialogDescription>
            Pick a photo from your library to use as this recipe's image.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <ImageIcon className="mb-2 h-10 w-10 opacity-50" />
              <p className="text-sm">No photos yet</p>
              <p className="text-xs">Upload photos in the Photos section first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => {
                    onSelect(photo.id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-md border bg-muted',
                    'transition hover:ring-2 hover:ring-primary focus:outline-none focus:ring-2 focus:ring-primary'
                  )}
                  title={photo.filename}
                >
                  <img
                    src={filesMediaApi.getThumbnailUrl(photo.id, 'md')}
                    alt={photo.filename}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
