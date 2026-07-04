import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface MediaLightboxProps {
  /** Accessible title for the dialog (e.g. the filename). */
  title: string;
  onClose: () => void;
  /** Navigate to the previous item; the button is hidden when omitted. */
  onPrev?: () => void;
  /** Navigate to the next item; the button is hidden when omitted. */
  onNext?: () => void;
  /** Content for the bottom info bar. */
  info?: ReactNode;
  /** The media itself (img or video element). */
  children: ReactNode;
}

/**
 * Full-screen media viewer for the photos/videos pages, built on the Radix
 * Dialog primitive for focus trapping, scroll locking, and Escape-to-close.
 * Render it conditionally; it is always open while mounted.
 */
export function MediaLightbox({
  title,
  onClose,
  onPrev,
  onNext,
  info,
  children,
}: MediaLightboxProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onPrev?.();
    if (e.key === 'ArrowRight') onNext?.();
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onKeyDown={handleKeyDown}
          onClick={(e) => {
            // Close when clicking the backdrop, not the media/chrome.
            if (e.target === e.currentTarget) onClose();
          }}
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>

          {/* Close button */}
          <DialogPrimitive.Close className="absolute right-4 top-4 z-10 text-white hover:text-gray-300">
            <X className="h-8 w-8" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          {/* Navigation */}
          {onPrev && (
            <button
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={onPrev}
            >
              <ChevronLeft className="h-8 w-8" />
              <span className="sr-only">Previous</span>
            </button>
          )}

          {onNext && (
            <button
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={onNext}
            >
              <ChevronRight className="h-8 w-8" />
              <span className="sr-only">Next</span>
            </button>
          )}

          {/* Media content */}
          {children}

          {/* Info bar */}
          {info && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-4 text-white">
              {info}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
