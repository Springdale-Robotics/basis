import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { STALE_TIME } from '@/lib/constants';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Set to true to suppress the global error toast for this mutation. */
      silenceError?: boolean;
    };
  }
}

const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    // Mutations can opt out of the global toast explicitly...
    if (mutation.meta?.silenceError) return;
    // ...or implicitly, by handling the error themselves.
    if (mutation.options.onError) return;
    toast({
      variant: 'destructive',
      title: 'Something went wrong',
      description: getErrorMessage(error),
    });
  },
});

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME.MEDIUM,
      gcTime: STALE_TIME.LONG,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export { queryClient };
