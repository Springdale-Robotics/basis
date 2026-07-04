import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { announceQueueSize, onDrain } from '@/lib/offline/sync';
import { toast } from '@/hooks/useToast';
import { useBottomStack } from '@/hooks/useBottomStack';
import { cn } from '@/lib/utils';

const FAILURE_DISPLAY_MS = 8000;

export function OfflineIndicator() {
  const { stackHeight } = useBottomStack();
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [queued, setQueued] = useState(0);
  // Count of queued changes discarded in the most recent sync run; shown
  // briefly in the pill (and toasted) so failures aren't silent.
  const [recentFailures, setRecentFailures] = useState(0);
  const lastDiscarded = useRef(0);
  const clearFailuresTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // Pick up a queue persisted across reloads (or already populated).
    void announceQueueSize();
    const off = onDrain(({ remaining, discarded, lastError }) => {
      setQueued(remaining);
      if (discarded > lastDiscarded.current) {
        setRecentFailures(discarded);
        toast({
          variant: 'destructive',
          title: `${discarded} change${discarded === 1 ? '' : 's'} couldn't sync`,
          description:
            lastError ??
            'The server rejected a change made offline, so it was discarded.',
        });
        clearTimeout(clearFailuresTimer.current);
        clearFailuresTimer.current = setTimeout(
          () => setRecentFailures(0),
          FAILURE_DISPLAY_MS,
        );
      }
      lastDiscarded.current = discarded;
    });
    return () => {
      off();
      clearTimeout(clearFailuresTimer.current);
    };
  }, []);

  if (online && queued === 0 && recentFailures === 0) return null;

  return (
    <div
      // Stays above the mobile bottom nav and/or music player when present.
      style={{ bottom: stackHeight + 12 }}
      className={cn(
        'fixed right-3 z-50 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-md',
        !online && 'border-warning/40 bg-warning/5',
        online && queued === 0 && recentFailures > 0 && 'border-destructive/40 bg-destructive/5',
      )}
    >
      {!online ? (
        <>
          <CloudOff className="h-3.5 w-3.5 text-warning" />
          <span>
            {queued > 0
              ? `Offline — ${queued} change${queued === 1 ? '' : 's'} waiting to sync`
              : 'Offline — changes will sync when you reconnect'}
          </span>
        </>
      ) : queued > 0 ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-info" />
          <span>Syncing {queued} change{queued === 1 ? '' : 's'}…</span>
        </>
      ) : (
        <>
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          <span>
            {recentFailures} change{recentFailures === 1 ? '' : 's'} couldn't sync
          </span>
        </>
      )}
    </div>
  );
}
