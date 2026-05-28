import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';

export interface CookingTimer {
  id: string;
  name: string;
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
  isComplete: boolean;
  createdAt: number;
}

interface TimerState {
  timers: CookingTimer[];

  addTimer: (name: string, durationSeconds: number) => string;
  removeTimer: (timerId: string) => void;
  startTimer: (timerId: string) => void;
  pauseTimer: (timerId: string) => void;
  resetTimer: (timerId: string) => void;
  addTime: (timerId: string, seconds: number) => void;
  tick: () => void;
  dismissTimer: (timerId: string) => void;
}

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      timers: [],

      addTimer: (name, durationSeconds) => {
        const id = generateId();
        const timer: CookingTimer = {
          id,
          name,
          durationSeconds,
          remainingSeconds: durationSeconds,
          isRunning: false,
          isPaused: false,
          isComplete: false,
          createdAt: Date.now(),
        };

        set((state) => ({
          timers: [...state.timers, timer],
        }));

        return id;
      },

      removeTimer: (timerId) =>
        set((state) => ({
          timers: state.timers.filter((t) => t.id !== timerId),
        })),

      startTimer: (timerId) =>
        set((state) => ({
          timers: state.timers.map((t) =>
            t.id === timerId && !t.isComplete
              ? { ...t, isRunning: true, isPaused: false }
              : t
          ),
        })),

      pauseTimer: (timerId) =>
        set((state) => ({
          timers: state.timers.map((t) =>
            t.id === timerId
              ? { ...t, isRunning: false, isPaused: true }
              : t
          ),
        })),

      resetTimer: (timerId) =>
        set((state) => ({
          timers: state.timers.map((t) =>
            t.id === timerId
              ? {
                  ...t,
                  remainingSeconds: t.durationSeconds,
                  isRunning: false,
                  isPaused: false,
                  isComplete: false,
                }
              : t
          ),
        })),

      addTime: (timerId, seconds) =>
        set((state) => ({
          timers: state.timers.map((t) =>
            t.id === timerId
              ? {
                  ...t,
                  remainingSeconds: t.remainingSeconds + seconds,
                  durationSeconds: t.durationSeconds + seconds,
                  isComplete: false,
                  // If timer was complete and we're adding time, keep it paused
                  isRunning: t.isComplete ? false : t.isRunning,
                  isPaused: t.isComplete ? true : t.isPaused,
                }
              : t
          ),
        })),

      tick: () =>
        set((state) => ({
          timers: state.timers.map((t) => {
            if (t.isRunning && t.remainingSeconds > 0) {
              const newRemaining = t.remainingSeconds - 1;
              return {
                ...t,
                remainingSeconds: newRemaining,
                isComplete: newRemaining === 0,
                isRunning: newRemaining === 0 ? false : t.isRunning,
              };
            }
            return t;
          }),
        })),

      dismissTimer: (timerId) =>
        set((state) => ({
          timers: state.timers.filter((t) => t.id !== timerId),
        })),
    }),
    {
      name: 'cooking-timers',
      // Only persist non-running state to avoid issues on reload
      partialize: (state) => ({
        timers: state.timers.map((t) => ({
          ...t,
          isRunning: false,
          isPaused: t.isRunning ? true : t.isPaused,
        })),
      }),
    }
  )
);
