import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Household } from '@/types/models';

interface AuthState {
  user: User | null;
  household: Household | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  setHousehold: (household: Household | null) => void;
  setAuth: (user: User, household: Household) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      household: null,
      isAuthenticated: false,
      isLoading: true,

      setUser: (user) =>
        set({ user, isAuthenticated: !!user }),

      setHousehold: (household) =>
        set({ household }),

      setAuth: (user, household) =>
        set({ user, household, isAuthenticated: true, isLoading: false }),

      clearAuth: () =>
        set({ user: null, household: null, isAuthenticated: false, isLoading: false }),

      setLoading: (isLoading) =>
        set({ isLoading }),
    }),
    {
      name: 'homemanager-auth',
      partialize: (state) => ({
        user: state.user,
        household: state.household,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
