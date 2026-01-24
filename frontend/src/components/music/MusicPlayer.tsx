import { useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  List,
  ChevronUp,
  ChevronDown,
  X,
  Music,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePlayerStore, formatDuration } from '@/stores/playerStore';
import { cn } from '@/lib/utils';

export function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const {
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    shuffled,
    repeatMode,
    isExpanded,
    isQueueVisible,
    setAudioRef,
    playPause,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    setCurrentTime,
    setDuration,
    setIsExpanded,
    setIsQueueVisible,
    playFromQueue,
    removeFromQueue,
    onTrackEnded,
  } = usePlayerStore();

  // Set audio ref on mount
  useEffect(() => {
    if (audioRef.current) {
      setAudioRef(audioRef.current);
    }
    return () => setAudioRef(null);
  }, [setAudioRef]);

  // Update time and duration from audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration || 0);
    const handleEnded = () => onTrackEnded();

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [setCurrentTime, setDuration, onTrackEnded]);

  // Apply volume and mute state
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Don't render if no track
  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" />

      {/* Player bar */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-40 border-t bg-background transition-all',
          isExpanded ? 'h-screen' : 'h-20'
        )}
      >
        {/* Expanded view */}
        {isExpanded && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-lg font-semibold">Now Playing</h2>
              <Button variant="ghost" size="icon" onClick={() => setIsExpanded(false)}>
                <ChevronDown className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center p-8">
              {/* Album art placeholder */}
              <div className="mb-8 flex h-64 w-64 items-center justify-center rounded-lg bg-muted shadow-lg">
                <Music className="h-24 w-24 text-muted-foreground" />
              </div>

              {/* Track info */}
              <h3 className="mb-2 text-2xl font-bold">{currentTrack.title}</h3>
              <p className="text-lg text-muted-foreground">
                {currentTrack.albumArtist || 'Unknown Artist'}
              </p>

              {/* Progress */}
              <div className="mt-8 w-full max-w-md">
                <Slider
                  value={[progress]}
                  max={100}
                  step={0.1}
                  onValueChange={([value]) => seek((value / 100) * duration)}
                  className="mb-2"
                />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{formatDuration(currentTime)}</span>
                  <span>{formatDuration(duration)}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-8 flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleShuffle}
                  className={cn(shuffled && 'text-primary')}
                >
                  <Shuffle className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={previous}>
                  <SkipBack className="h-6 w-6" />
                </Button>
                <Button
                  size="icon"
                  className="h-14 w-14 rounded-full"
                  onClick={playPause}
                >
                  {isPlaying ? (
                    <Pause className="h-7 w-7" />
                  ) : (
                    <Play className="ml-1 h-7 w-7" />
                  )}
                </Button>
                <Button variant="ghost" size="icon" onClick={next}>
                  <SkipForward className="h-6 w-6" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleRepeat}
                  className={cn(repeatMode !== 'off' && 'text-primary')}
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 className="h-5 w-5" />
                  ) : (
                    <Repeat className="h-5 w-5" />
                  )}
                </Button>
              </div>

              {/* Volume */}
              <div className="mt-8 flex w-full max-w-xs items-center gap-2">
                <Button variant="ghost" size="icon" onClick={toggleMute}>
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume * 100]}
                  max={100}
                  onValueChange={([value]) => setVolume(value / 100)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Mini player */}
        {!isExpanded && (
          <div className="flex h-full items-center gap-4 px-4">
            {/* Track info */}
            <div
              className="flex flex-1 cursor-pointer items-center gap-3"
              onClick={() => setIsExpanded(true)}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
                <Music className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{currentTrack.title}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {currentTrack.albumArtist || 'Unknown Artist'}
                </p>
              </div>
            </div>

            {/* Progress bar (mini) */}
            <div className="hidden w-64 sm:block">
              <Slider
                value={[progress]}
                max={100}
                step={0.1}
                onValueChange={([value]) => seek((value / 100) * duration)}
                className="mb-1"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatDuration(currentTime)}</span>
                <span>{formatDuration(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={previous}>
                <SkipBack className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={playPause}>
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={next}>
                <SkipForward className="h-5 w-5" />
              </Button>
            </div>

            {/* Volume (desktop) */}
            <div className="hidden items-center gap-2 lg:flex">
              <Button variant="ghost" size="icon" onClick={toggleMute}>
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume * 100]}
                max={100}
                onValueChange={([value]) => setVolume(value / 100)}
                className="w-24"
              />
            </div>

            {/* Queue toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsQueueVisible(!isQueueVisible)}
              className={cn(isQueueVisible && 'text-primary')}
            >
              <List className="h-5 w-5" />
            </Button>

            {/* Expand button */}
            <Button variant="ghost" size="icon" onClick={() => setIsExpanded(true)}>
              <ChevronUp className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>

      {/* Queue panel */}
      {isQueueVisible && !isExpanded && (
        <div className="fixed bottom-20 right-4 z-30 w-80 rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b p-3">
            <h3 className="font-semibold">Queue</h3>
            <Button variant="ghost" size="icon" onClick={() => setIsQueueVisible(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="h-80">
            <div className="p-2">
              {queue.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Queue is empty
                </p>
              ) : (
                queue.map((track, index) => (
                  <div
                    key={`${track.id}-${index}`}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-muted',
                      index === queueIndex && 'bg-muted'
                    )}
                    onClick={() => playFromQueue(index)}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                      {index === queueIndex && isPlaying ? (
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                      ) : (
                        <Music className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{track.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.albumArtist || 'Unknown'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue(index);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </>
  );
}
