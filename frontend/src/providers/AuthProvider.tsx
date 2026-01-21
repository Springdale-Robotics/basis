import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { authApi, type LoginRequest } from '@/api/auth';
import { householdsApi } from '@/api/households';
import { setupApi } from '@/api/setup';
import { ApiError } from '@/lib/api-error';
import type { User, Household } from '@/types/models';

interface AuthContextType {
  user: User | null;
  household: Household | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, household, isAuthenticated, setAuth, clearAuth, setLoading } = useAuthStore();

  // Check setup status first
  const { data: setupStatus, isLoading: setupLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: setupApi.getStatus,
    retry: false,
    staleTime: Infinity,
  });

  // Fetch current user session
  const { refetch, isLoading: authLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    retry: false,
    enabled: setupStatus?.isSetupComplete ?? false,
    staleTime: STALE_TIME_AUTH,
  });

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setAuth(data.user, data.household);
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      const from = (location.state as { from?: string })?.from || '/dashboard';
      navigate(from, { replace: true });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      clearAuth();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
    onError: () => {
      clearAuth();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  // Handle auth state from query
  const isSetupComplete = setupStatus?.isSetupComplete ?? false;

  useEffect(() => {
    const handleAuth = async () => {
      if (setupLoading) return;

      // If setup is not complete, redirect to setup page
      if (!isSetupComplete) {
        setLoading(false);
        if (!location.pathname.startsWith('/setup')) {
          navigate('/setup', { replace: true });
        }
        return;
      }

      try {
        const authResult = await refetch();
        if (authResult.data?.user) {
          // Fetch household separately
          const householdResult = await householdsApi.getCurrent();
          setAuth(authResult.data.user, householdResult.household);
        } else {
          clearAuth();
        }
      } catch (error) {
        if (ApiError.isApiError(error) && error.status === 401) {
          clearAuth();
        }
      }
    };

    handleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSetupComplete, setupLoading]);

  const isLoading = setupLoading || authLoading;

  const value: AuthContextType = {
    user,
    household,
    isAuthenticated,
    isLoading,
    login: async (data) => {
      await loginMutation.mutateAsync(data);
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
    refetch: () => {
      refetch();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const STALE_TIME_AUTH = 1000 * 60 * 5; // 5 minutes

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
