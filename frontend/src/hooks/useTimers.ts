import { useEffect, useCallback, useRef } from 'react';
import { useTimerStore } from '@/stores/timerStore';

export function useTimers() {
  const {
    timers,
    addTimer,
    removeTimer,
    startTimer,
    pauseTimer,
    resetTimer,
    addTime,
    tick,
    dismissTimer,
  } = useTimerStore();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const completedTimersRef = useRef<Set<string>>(new Set());

  // Initialize audio element for timer alerts
  useEffect(() => {
    // Create audio element for timer completion sound
    audioRef.current = new Audio('/timer-alert.mp3');
    audioRef.current.volume = 0.5;

    return () => {
      audioRef.current = null;
    };
  }, []);

  // Timer tick effect
  useEffect(() => {
    const hasRunningTimers = timers.some((t) => t.isRunning);
    if (!hasRunningTimers) return;

    const interval = setInterval(() => {
      tick();
    }, 1000);

    return () => clearInterval(interval);
  }, [timers, tick]);

  // Play sound when timer completes
  useEffect(() => {
    timers.forEach((timer) => {
      if (timer.isComplete && !completedTimersRef.current.has(timer.id)) {
        completedTimersRef.current.add(timer.id);
        // Play alert sound
        audioRef.current?.play().catch(() => {
          // Audio play failed, likely due to browser autoplay policy
          console.log('Timer alert sound blocked by browser');
        });
        // Also try to show a notification
        if (Notification.permission === 'granted') {
          new Notification(`Timer Complete: ${timer.name}`, {
            body: 'Your cooking timer has finished!',
            icon: '/favicon.ico',
          });
        }
      }
    });

    // Clean up completed timers that were dismissed
    const currentIds = new Set(timers.map((t) => t.id));
    completedTimersRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        completedTimersRef.current.delete(id);
      }
    });
  }, [timers]);

  // Request notification permission on first use
  const requestNotificationPermission = useCallback(async () => {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  const handleAddTimer = useCallback(
    (name: string, minutes: number, seconds: number = 0) => {
      const totalSeconds = minutes * 60 + seconds;
      if (totalSeconds <= 0) return null;

      requestNotificationPermission();
      return addTimer(name, totalSeconds);
    },
    [addTimer, requestNotificationPermission]
  );

  const handleStartTimer = useCallback(
    (timerId: string) => {
      requestNotificationPermission();
      startTimer(timerId);
    },
    [startTimer, requestNotificationPermission]
  );

  const handleAddTime = useCallback(
    (timerId: string, minutes: number) => {
      addTime(timerId, minutes * 60);
    },
    [addTime]
  );

  return {
    timers,
    addTimer: handleAddTimer,
    removeTimer,
    startTimer: handleStartTimer,
    pauseTimer,
    resetTimer,
    addTime: handleAddTime,
    dismissTimer,
    hasActiveTimers: timers.some((t) => t.isRunning || t.isComplete),
  };
}
