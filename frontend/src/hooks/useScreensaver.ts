import { useState, useEffect, useCallback } from 'react';

interface UseScreensaverOptions {
  enabled: boolean;
  timeoutMinutes: number;
  onActivate?: () => void;
  onDeactivate?: () => void;
}

export function useScreensaver({
  enabled,
  timeoutMinutes,
  onActivate,
  onDeactivate,
}: UseScreensaverOptions) {
  const [isActive, setIsActive] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const handleActivity = useCallback(() => {
    setLastActivity(Date.now());
    if (isActive) {
      setIsActive(false);
      onDeactivate?.();
    }
  }, [isActive, onDeactivate]);

  useEffect(() => {
    if (!enabled) {
      setIsActive(false);
      return;
    }

    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    events.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [enabled, handleActivity]);

  useEffect(() => {
    if (!enabled) return;

    const checkIdleTime = () => {
      const idleTime = Date.now() - lastActivity;
      const timeoutMs = timeoutMinutes * 60 * 1000;

      if (idleTime >= timeoutMs && !isActive) {
        setIsActive(true);
        onActivate?.();
      }
    };

    const interval = setInterval(checkIdleTime, 1000);
    return () => clearInterval(interval);
  }, [enabled, lastActivity, timeoutMinutes, isActive, onActivate]);

  const deactivate = useCallback(() => {
    setIsActive(false);
    setLastActivity(Date.now());
    onDeactivate?.();
  }, [onDeactivate]);

  return { isActive, deactivate };
}
