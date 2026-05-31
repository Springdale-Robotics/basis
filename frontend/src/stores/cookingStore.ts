import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Recipe, RecipeTimer } from '@/types/models';
import { generateId } from '@/lib/utils';

interface TimerState {
  id: string;
  name: string;
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
  completedAt?: number;
}

interface CookingSession {
  id: string;
  recipeId: string;
  recipe: Recipe;
  currentStep: number;
  timers: TimerState[];
  startedAt: number;
}

interface CookingState {
  activeSession: CookingSession | null;
  sessions: CookingSession[];

  startSession: (recipe: Recipe) => string;
  endSession: (sessionId: string) => void;
  setCurrentStep: (sessionId: string, step: number) => void;
  nextStep: (sessionId: string) => void;
  prevStep: (sessionId: string) => void;

  startTimer: (sessionId: string, timerId: string) => void;
  pauseTimer: (sessionId: string, timerId: string) => void;
  resetTimer: (sessionId: string, timerId: string) => void;
  updateTimerRemaining: (sessionId: string, timerId: string, remaining: number) => void;
  markTimerComplete: (sessionId: string, timerId: string) => void;

  getSession: (sessionId: string) => CookingSession | undefined;
}

export const useCookingStore = create<CookingState>((set, get) => ({
  activeSession: null,
  sessions: [],

  startSession: (recipe) => {
    const sessionId = generateId();
    const timers: TimerState[] = recipe.timers.map((t) => ({
      id: t.id,
      name: t.name,
      durationSeconds: t.durationSeconds,
      remainingSeconds: t.durationSeconds,
      isRunning: false,
      isPaused: false,
    }));

    const session: CookingSession = {
      id: sessionId,
      recipeId: recipe.id,
      recipe,
      currentStep: 0,
      timers,
      startedAt: Date.now(),
    };

    set((state) => ({
      activeSession: session,
      sessions: [...state.sessions, session],
    }));

    return sessionId;
  },

  endSession: (sessionId) =>
    set((state) => ({
      activeSession:
        state.activeSession?.id === sessionId ? null : state.activeSession,
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    })),

  setCurrentStep: (sessionId, step) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, currentStep: step } : s
      ),
      activeSession:
        state.activeSession?.id === sessionId
          ? { ...state.activeSession, currentStep: step }
          : state.activeSession,
    })),

  nextStep: (sessionId) => {
    const session = get().getSession(sessionId);
    if (session && session.currentStep < session.recipe.instructions.length - 1) {
      get().setCurrentStep(sessionId, session.currentStep + 1);
    }
  },

  prevStep: (sessionId) => {
    const session = get().getSession(sessionId);
    if (session && session.currentStep > 0) {
      get().setCurrentStep(sessionId, session.currentStep - 1);
    }
  },

  startTimer: (sessionId, timerId) =>
    set((state) => {
      const updateTimers = (timers: TimerState[]) =>
        timers.map((t) =>
          t.id === timerId ? { ...t, isRunning: true, isPaused: false } : t
        );

      return {
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, timers: updateTimers(s.timers) } : s
        ),
        activeSession:
          state.activeSession?.id === sessionId
            ? { ...state.activeSession, timers: updateTimers(state.activeSession.timers) }
            : state.activeSession,
      };
    }),

  pauseTimer: (sessionId, timerId) =>
    set((state) => {
      const updateTimers = (timers: TimerState[]) =>
        timers.map((t) =>
          t.id === timerId ? { ...t, isRunning: false, isPaused: true } : t
        );

      return {
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, timers: updateTimers(s.timers) } : s
        ),
        activeSession:
          state.activeSession?.id === sessionId
            ? { ...state.activeSession, timers: updateTimers(state.activeSession.timers) }
            : state.activeSession,
      };
    }),

  resetTimer: (sessionId, timerId) =>
    set((state) => {
      const updateTimers = (timers: TimerState[]) =>
        timers.map((t) =>
          t.id === timerId
            ? {
                ...t,
                remainingSeconds: t.durationSeconds,
                isRunning: false,
                isPaused: false,
                completedAt: undefined,
              }
            : t
        );

      return {
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, timers: updateTimers(s.timers) } : s
        ),
        activeSession:
          state.activeSession?.id === sessionId
            ? { ...state.activeSession, timers: updateTimers(state.activeSession.timers) }
            : state.activeSession,
      };
    }),

  updateTimerRemaining: (sessionId, timerId, remaining) =>
    set((state) => {
      const updateTimers = (timers: TimerState[]) =>
        timers.map((t) =>
          t.id === timerId ? { ...t, remainingSeconds: remaining } : t
        );

      return {
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, timers: updateTimers(s.timers) } : s
        ),
        activeSession:
          state.activeSession?.id === sessionId
            ? { ...state.activeSession, timers: updateTimers(state.activeSession.timers) }
            : state.activeSession,
      };
    }),

  markTimerComplete: (sessionId, timerId) =>
    set((state) => {
      const updateTimers = (timers: TimerState[]) =>
        timers.map((t) =>
          t.id === timerId
            ? { ...t, isRunning: false, remainingSeconds: 0, completedAt: Date.now() }
            : t
        );

      return {
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, timers: updateTimers(s.timers) } : s
        ),
        activeSession:
          state.activeSession?.id === sessionId
            ? { ...state.activeSession, timers: updateTimers(state.activeSession.timers) }
            : state.activeSession,
      };
    }),

  getSession: (sessionId) => get().sessions.find((s) => s.id === sessionId),
}));
