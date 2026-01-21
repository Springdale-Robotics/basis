import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useScreensaver } from '@/hooks/useScreensaver';

interface ScreensaverOverlayProps {
  photos?: string[];
  showCalendar?: boolean;
  slideInterval?: number;
  enabled?: boolean;
  timeoutMinutes?: number;
}

export function ScreensaverOverlay({
  photos = [],
  showCalendar = true,
  slideInterval = 10000,
  enabled = true,
  timeoutMinutes = 5,
}: ScreensaverOverlayProps) {
  const { isActive, deactivate } = useScreensaver({ enabled, timeoutMinutes });
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (!isActive) return;

    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timeInterval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive || photos.length <= 1) return;

    const photoInterval = setInterval(() => {
      setCurrentPhotoIndex((prev) => (prev + 1) % photos.length);
    }, slideInterval);

    return () => clearInterval(photoInterval);
  }, [isActive, photos.length, slideInterval]);

  const handleInteraction = useCallback(() => {
    deactivate();
  }, [deactivate]);

  if (!isActive) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black cursor-pointer"
      onClick={handleInteraction}
      onTouchStart={handleInteraction}
      onKeyDown={handleInteraction}
      tabIndex={0}
    >
      {/* Photo slideshow */}
      {photos.length > 0 ? (
        <div className="absolute inset-0">
          {photos.map((photo, index) => (
            <img
              key={photo}
              src={photo}
              alt=""
              className={cn(
                'absolute inset-0 w-full h-full object-cover transition-opacity duration-1000',
                index === currentPhotoIndex ? 'opacity-100' : 'opacity-0'
              )}
            />
          ))}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800" />
      )}

      {/* Clock and date */}
      <div className="absolute bottom-0 left-0 right-0 p-8">
        <div className="text-white">
          <div className="text-8xl font-light tracking-tight mb-2">
            {format(currentTime, 'h:mm')}
            <span className="text-4xl ml-2 opacity-80">
              {format(currentTime, 'a')}
            </span>
          </div>
          <div className="text-2xl opacity-80">
            {format(currentTime, 'EEEE, MMMM d')}
          </div>
        </div>

        {showCalendar && (
          <div className="mt-6 text-white/70 text-lg">
            <p>Touch anywhere to wake</p>
          </div>
        )}
      </div>

      {/* Photo indicator dots */}
      {photos.length > 1 && (
        <div className="absolute bottom-8 right-8 flex gap-2">
          {photos.map((_, index) => (
            <div
              key={index}
              className={cn(
                'w-2 h-2 rounded-full transition-colors',
                index === currentPhotoIndex ? 'bg-white' : 'bg-white/40'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
