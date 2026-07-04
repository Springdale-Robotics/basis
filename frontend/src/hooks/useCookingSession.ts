import { useEffect, useCallback } from 'react';
import { useCookingStore } from '@/stores/cookingStore';
import type { Recipe } from '@/types/models';

export function useCookingSession(sessionId?: string) {
  const {
    activeSession,
    sessions,
    startSession,
    endSession,
    setCurrentStep,
    nextStep,
    prevStep,
    startTimer,
    pauseTimer,
    resetTimer,
    updateTimerRemaining,
    markTimerComplete,
    getSession,
  } = useCookingStore();

  const session = sessionId ? getSession(sessionId) : activeSession;

  // Timer tick effect
  useEffect(() => {
    if (!session) return;

    const interval = setInterval(() => {
      session.timers.forEach((timer) => {
        if (timer.isRunning && timer.remainingSeconds > 0) {
          const newRemaining = timer.remainingSeconds - 1;
          updateTimerRemaining(session.id, timer.id, newRemaining);

          if (newRemaining === 0) {
            markTimerComplete(session.id, timer.id);
          }
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.id, session?.timers]);

  const start = useCallback(
    (recipe: Recipe) => {
      const id = startSession(recipe);
      return id;
    },
    [startSession]
  );

  const end = useCallback(() => {
    if (session) {
      endSession(session.id);
    }
  }, [session, endSession]);

  const goToStep = useCallback(
    (step: number) => {
      if (session) {
        setCurrentStep(session.id, step);
      }
    },
    [session, setCurrentStep]
  );

  const next = useCallback(() => {
    if (session) {
      nextStep(session.id);
    }
  }, [session, nextStep]);

  const prev = useCallback(() => {
    if (session) {
      prevStep(session.id);
    }
  }, [session, prevStep]);

  const handleStartTimer = useCallback(
    (timerId: string) => {
      if (session) {
        startTimer(session.id, timerId);
      }
    },
    [session, startTimer]
  );

  const handlePauseTimer = useCallback(
    (timerId: string) => {
      if (session) {
        pauseTimer(session.id, timerId);
      }
    },
    [session, pauseTimer]
  );

  const handleResetTimer = useCallback(
    (timerId: string) => {
      if (session) {
        resetTimer(session.id, timerId);
      }
    },
    [session, resetTimer]
  );

  return {
    session,
    sessions,
    isActive: !!session,
    currentStep: session?.currentStep ?? 0,
    totalSteps: session?.recipe.instructions.length ?? 0,
    timers: session?.timers ?? [],
    recipe: session?.recipe,

    start,
    end,
    goToStep,
    next,
    prev,
    startTimer: handleStartTimer,
    pauseTimer: handlePauseTimer,
    resetTimer: handleResetTimer,
  };
}
