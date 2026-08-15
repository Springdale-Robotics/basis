import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** How often an open app asks the server whether a newer build exists. */
const UPDATE_POLL_MS = 15 * 60 * 1000;

/**
 * Notices when a newer build has been deployed, and reloads on request.
 *
 * The service worker precaches the app shell, so a session that spans a deploy
 * keeps serving the old bundle. Two things went wrong with the previous
 * `registerType: 'autoUpdate'` setup:
 *
 * 1. Nothing ever *checked* for a new build after boot. The browser only looks
 *    for an updated worker on navigation, and an installed iOS app is
 *    suspended and resumed rather than reloaded — so a home-screen Basis could
 *    sit on a months-old bundle indefinitely. That produced a genuinely
 *    confusing failure: a bug was fixed and released, the user retried on the
 *    stale bundle, and hit the old behaviour plus an error string the new code
 *    no longer emits. Nothing on screen suggested the app was out of date.
 *    The `visibilitychange` check below is the fix for that case.
 *
 * 2. When it did update, it reloaded the page out from under the user with no
 *    warning. Recipe import is a multi-step flow holding unsaved work — OCR
 *    text corrected by hand, ingredient links chosen one by one — and a silent
 *    reload discards it. So we prompt and let the user pick the moment.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        if (document.visibilityState !== 'visible') return;
        if (!navigator.onLine) return;
        void registration.update();
      };

      // Resuming a suspended app is not a navigation, so this is the only
      // signal we get that an iOS user has come back after a deploy.
      document.addEventListener('visibilitychange', checkForUpdate);
      // And a poll, for the tablet left open on the kitchen counter.
      setInterval(checkForUpdate, UPDATE_POLL_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t bg-card px-4 py-3 shadow-skylight-lg sm:inset-x-auto sm:bottom-4 sm:right-4 sm:rounded-lg sm:border"
    >
      <span className="text-sm">A new version of Basis is available.</span>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Reload
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
      </div>
    </div>
  );
}
