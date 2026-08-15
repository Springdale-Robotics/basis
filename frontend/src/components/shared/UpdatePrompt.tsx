import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBottomStack } from '@/hooks/useBottomStack';

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
  const { navHeight, stackHeight } = useBottomStack();
  // Full-width and flush above the mobile nav; a floating card inset from the
  // corner on desktop. navHeight is non-zero exactly below the md breakpoint,
  // where the classes below switch over.
  const bottom = navHeight > 0 ? stackHeight : stackHeight + 16;
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

  /**
   * Hand over to the new worker and show the new build.
   *
   * `updateServiceWorker` only reloads the page when an older worker was
   * already controlling it — workbox listens for `controlling` and checks
   * `event.isUpdate`. The very first page load of a session is *not*
   * controlled by any worker (the new worker deliberately doesn't claim
   * clients, so control begins on the following load), and there the event
   * never fires: the button looked dead. Caught by clicking it after clearing
   * site data.
   */
  const applyUpdate = async () => {
    const wasControlled = !!navigator.serviceWorker?.controller;
    await updateServiceWorker(true);
    if (wasControlled) return;

    // Give the worker we just messaged a moment to stop waiting, so the
    // reload is served by the new one rather than repeating the prompt.
    const registration = await navigator.serviceWorker.getRegistration();
    const deadline = Date.now() + 3000;
    while (registration?.waiting && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.location.reload();
  };

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      // Sits on top of the mobile bottom nav and music player rather than
      // over them — the nav is also fixed at bottom-0 z-50, so anchoring
      // there would hide navigation until the banner was dismissed.
      style={{ bottom }}
      className="fixed inset-x-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t bg-card px-4 py-3 shadow-skylight-lg md:inset-x-auto md:right-4 md:rounded-lg md:border"
    >
      <span className="text-sm">A new version of Basis is available.</span>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void applyUpdate()}>
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
