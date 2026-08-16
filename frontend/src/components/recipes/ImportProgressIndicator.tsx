import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Loader2, Check } from 'lucide-react';
import { useBottomStack } from '@/hooks/useBottomStack';
import { imageParseApi, type ImportBatchSummary } from '@/api/image-parse';
import { cn } from '@/lib/utils';

/**
 * Reading in progress, wherever you happen to be in the app.
 *
 * Photographing a binder is meant to be something you walk away from, and the
 * price of walking away is not knowing whether it finished. The reading runs on
 * the box regardless — this is just the answer to "is it done yet?", available
 * without going to look.
 *
 * Deliberately quiet. It appears only while a photographing session is
 * unfinished or waiting to be looked at, says one thing, and goes away when
 * there is nothing to say.
 */

/** Ambient, not a live view: often enough to be current, rare enough to ignore. */
const POLL_MS = 20000;

export function ImportProgressIndicator() {
  const { stackHeight } = useBottomStack();
  const location = useLocation();
  const [batch, setBatch] = useState<ImportBatchSummary | null>(null);

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      // No point asking while the tab is in the background, and it would keep
      // a phone awake for nothing.
      if (document.visibilityState !== 'visible') return;
      try {
        const { batches } = await imageParseApi.listBatches('open');
        const worthShowing = batches
          .filter((candidate) => candidate.total > 0)
          .sort((a, b) => (b.working || 0) - (a.working || 0))[0];
        if (!stopped) setBatch(worthShowing ?? null);
      } catch {
        // Not worth a noise: this is a convenience, not a feature.
      }
    };

    void check();
    const timer = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // The capture page shows all of this in more detail; two of it is clutter.
  if (!batch || location.pathname.startsWith('/recipes/capture')) return null;

  const working = batch.working > 0;

  return (
    <Link
      to={`/recipes/capture?batch=${batch.id}`}
      style={{ bottom: stackHeight + 12 }}
      className={cn(
        'fixed left-3 z-50 flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-md',
        'hover:bg-accent transition-colors',
        !working && 'border-success/40 bg-success/5'
      )}
    >
      {working ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>
            Reading {batch.ready} of {batch.total}
          </span>
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-success" />
          <span>
            {batch.ready} recipe{batch.ready === 1 ? '' : 's'} read — review
          </span>
        </>
      )}
    </Link>
  );
}
