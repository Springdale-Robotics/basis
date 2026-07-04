import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { moviesApi } from '@/api/media';
import { cn } from '@/lib/utils';

const REPORT_INTERVAL_MS = 10_000;
/** Watched past this fraction counts as completed. */
const COMPLETED_THRESHOLD = 0.95;

interface VideoPlayerProps {
  /** File to stream (movie file or episode file). */
  fileId: string;
  /** Resume position in seconds (from existing watch progress). */
  startAt?: number;
  className?: string;
}

/**
 * Streams a movie/episode file and reports watch progress: throttled
 * updates while playing (every 10s), a final report on unmount or file
 * change, and a completed flag near the end. Continue-watching queries
 * are invalidated when the player goes away so the shelf stays fresh.
 */
export function VideoPlayer({ fileId, startAt = 0, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReportRef = useRef(0);
  const queryClient = useQueryClient();

  const report = (position: number, duration: number, completed?: boolean) => {
    if (position <= 0 && !completed) return;
    moviesApi
      .updateProgress(fileId, {
        positionSeconds: Math.floor(position),
        durationSeconds: duration > 0 ? Math.floor(duration) : undefined,
        completed:
          completed ??
          (duration > 0 && position / duration >= COMPLETED_THRESHOLD),
      })
      .catch(() => {
        // Progress reporting is best-effort; never interrupt playback.
      });
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || video.paused) return;
    const now = Date.now();
    if (now - lastReportRef.current < REPORT_INTERVAL_MS) return;
    lastReportRef.current = now;
    report(video.currentTime, video.duration || 0);
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    // Resume, unless we were basically at the end already.
    if (startAt > 0 && (!video.duration || startAt < video.duration - 5)) {
      video.currentTime = startAt;
    }
  };

  const handleEnded = () => {
    const video = videoRef.current;
    if (!video) return;
    report(video.duration || 0, video.duration || 0, true);
  };

  // Final progress report when the player unmounts or switches files.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video && video.currentTime > 0) {
        report(video.currentTime, video.duration || 0);
      }
      queryClient.invalidateQueries({ queryKey: ['continue-watching'] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  return (
    <video
      ref={videoRef}
      key={fileId}
      src={moviesApi.getStreamUrl(fileId)}
      className={cn('w-full rounded-lg bg-black', className)}
      controls
      autoPlay
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onEnded={handleEnded}
    />
  );
}
