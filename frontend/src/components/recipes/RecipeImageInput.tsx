import { useState, useCallback } from 'react';
import { Upload, Link2, X, ImageIcon, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/useToast';
import { filesMediaApi } from '@/api/media';
import { FileSourcePicker } from '@/components/shared/FileSourcePicker';
import { PhotoPickerDialog } from './PhotoPickerDialog';

// Mirror the server's limits (recipe-image.service.ts) so we reject locally
// with a clear message instead of letting the user fill out the whole form
// and only fail on submit.
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Returns an error message if the file is invalid, or null if it's fine. */
function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'Image is too large. Maximum size is 10MB.';
  }
  return null;
}

interface RecipeImageInputProps {
  /** Current image as base64 data URI or external URL */
  currentImage?: string;
  /** Callback when a file is selected for upload */
  onFileSelect: (file: File) => void;
  /** Callback to fetch image from URL */
  onUrlFetch: (url: string) => void;
  /** Callback when an existing Files/Photos item is chosen (passes its id). */
  onPhotoSelect?: (fileId: string) => void;
  /** Callback to remove the current image */
  onRemove: () => void;
  /** Whether image is being processed */
  isProcessing?: boolean;
  /** Whether the component is disabled */
  disabled?: boolean;
}

export function RecipeImageInput({
  currentImage,
  onFileSelect,
  onUrlFetch,
  onPhotoSelect,
  onRemove,
  isProcessing = false,
  disabled = false,
}: RecipeImageInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  const handlePhotoChosen = (fileId: string) => {
    if (!onPhotoSelect) return;
    // Show the picked photo's thumbnail as an immediate preview; the recipe
    // save copies + processes the real image server-side.
    setPreviewImage(filesMediaApi.getThumbnailUrl(fileId, 'lg'));
    onPhotoSelect(fileId);
  };

  const displayImage = previewImage || currentImage;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isProcessing) {
      setIsDragging(true);
    }
  }, [disabled, isProcessing]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled || isProcessing) return;

    const file = e.dataTransfer.files[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) {
      toast({ title: 'Invalid image', description: error, variant: 'destructive' });
      return;
    }
    // Show preview
    const reader = new FileReader();
    reader.onload = () => setPreviewImage(reader.result as string);
    reader.readAsDataURL(file);
    onFileSelect(file);
  }, [disabled, isProcessing, onFileSelect]);

  // Receives plain File objects from FileSourcePicker (device or library).
  const handlePickerSelect = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const error = validateImageFile(file);
    if (error) {
      toast({ title: 'Invalid image', description: error, variant: 'destructive' });
      return;
    }
    // Show preview
    const reader = new FileReader();
    reader.onload = () => setPreviewImage(reader.result as string);
    reader.readAsDataURL(file);
    onFileSelect(file);
  };

  const handleUrlSubmit = () => {
    if (urlValue.trim()) {
      onUrlFetch(urlValue.trim());
      setUrlValue('');
      setShowUrlInput(false);
    }
  };

  const handleRemove = () => {
    setPreviewImage(null);
    onRemove();
  };

  // Opens the source picker (library vs. device) instead of jumping straight
  // to the native file input. Drag-and-drop remains the device shortcut.
  const handleBrowseClick = () => {
    setShowSourcePicker(true);
  };

  return (
    <div className="space-y-3">
      {/* Image preview or drop zone */}
      {displayImage ? (
        <div className="relative group">
          <div className="aspect-video rounded-lg overflow-hidden bg-muted border">
            <img
              src={displayImage}
              alt="Recipe preview"
              className={cn(
                'w-full h-full object-cover',
                isProcessing && 'opacity-50'
              )}
            />
            {isProcessing && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                <LoadingSpinner size="lg" className="text-primary" />
              </div>
            )}
          </div>
          {!isProcessing && !disabled && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleRemove}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            'aspect-video rounded-lg border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-3 cursor-pointer',
            isDragging && 'border-primary bg-primary/5',
            !isDragging && 'border-muted-foreground/25 hover:border-muted-foreground/50',
            (disabled || isProcessing) && 'opacity-50 cursor-not-allowed'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={!disabled && !isProcessing ? handleBrowseClick : undefined}
        >
          {isProcessing ? (
            <>
              <LoadingSpinner className="h-10 w-10" />
              <p className="text-sm text-muted-foreground">Processing image...</p>
            </>
          ) : (
            <>
              <ImageIcon className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop image here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">JPEG, PNG, WebP, or GIF (max 10MB)</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Source picker: library on the home server, or this device */}
      <FileSourcePicker
        open={showSourcePicker}
        onOpenChange={setShowSourcePicker}
        onSelect={handlePickerSelect}
        accept="image/jpeg,image/png,image/webp,image/gif"
        title="Add recipe image"
        description="JPEG, PNG, WebP, or GIF (max 10MB)."
      />

      {/* Action buttons */}
      {!displayImage && !isProcessing && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBrowseClick}
            disabled={disabled}
            className="flex-1"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowUrlInput(!showUrlInput)}
            disabled={disabled}
            className="flex-1"
          >
            <Link2 className="h-4 w-4 mr-2" />
            From URL
          </Button>
          {onPhotoSelect && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPhotoPicker(true)}
              disabled={disabled}
              className="flex-1"
            >
              <Images className="h-4 w-4 mr-2" />
              From Photos
            </Button>
          )}
        </div>
      )}

      {/* Replace image button when image exists */}
      {displayImage && !isProcessing && !disabled && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBrowseClick}
            className="flex-1"
          >
            <Upload className="h-4 w-4 mr-2" />
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="flex-1"
          >
            <Link2 className="h-4 w-4 mr-2" />
            From URL
          </Button>
          {onPhotoSelect && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPhotoPicker(true)}
              className="flex-1"
            >
              <Images className="h-4 w-4 mr-2" />
              From Photos
            </Button>
          )}
        </div>
      )}

      {/* URL input — single block for both the empty and replace states */}
      {showUrlInput && !isProcessing && (
        <div className="flex gap-2">
          <Input
            placeholder="https://example.com/image.jpg"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleUrlSubmit())}
            disabled={disabled || isProcessing}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleUrlSubmit}
            disabled={disabled || isProcessing || !urlValue.trim()}
          >
            Fetch
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowUrlInput(false);
              setUrlValue('');
            }}
            disabled={disabled || isProcessing}
          >
            Cancel
          </Button>
        </div>
      )}

      {onPhotoSelect && (
        <PhotoPickerDialog
          open={showPhotoPicker}
          onOpenChange={setShowPhotoPicker}
          onSelect={handlePhotoChosen}
        />
      )}
    </div>
  );
}
