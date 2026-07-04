import { useEffect, useState } from 'react';

/** Seconds until `targetIso`, ticking every second; null when no target. */
export function useCountdown(targetIso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!targetIso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (!targetIso) return null;
  return Math.max(0, Math.floor((new Date(targetIso).getTime() - now) / 1000));
}
