import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { onDrain } from '@/lib/offline/sync';
import { cn } from '@/lib/utils';

export function OfflineIndicator() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [queued, setQueued] = useState(0);

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
    const off = onDrain(({ remaining }) => setQueued(remaining));
    return () => {
      off();
    };
  }, []);

  if (online && queued === 0) return null;

  return (
    <div
      className={cn(
        'fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-md',
        !online && 'border-orange-500/40 bg-orange-500/5',
      )}
    >
      {!online ? (
        <>
          <CloudOff className="h-3.5 w-3.5 text-orange-500" />
          <span>Offline — changes will sync when you reconnect</span>
        </>
      ) : (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
          <span>Syncing {queued} change{queued === 1 ? '' : 's'}…</span>
        </>
      )}
    </div>
  );
}
