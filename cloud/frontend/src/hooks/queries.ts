import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe } from '@/api/auth';
import { checkSubdomain, getMyTenant } from '@/api/tenants';
import { isApiError } from '@/api/client';
import type { Account, Tenant } from '@/api/types';
import { validateSubdomain } from '@/lib/subdomain';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  tenant: ['tenants', 'me'] as const,
  subdomainCheck: (name: string) => ['subdomains', 'check', name] as const,
};

/** Current account, or null when signed out (401 maps to null, not an error). */
export function useMe() {
  return useQuery<Account | null>({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        const { account } = await getMe();
        return account;
      } catch (error) {
        if (isApiError(error) && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The signed-in account's tenant (or null before the subdomain is claimed).
 * Only mount inside the auth gate. While a just-paid checkout is settling
 * (webhook lag), pass `pollWhileUnpaid` to poll until the status flips.
 */
export function useTenant(options?: { pollWhileUnpaid?: boolean }) {
  const pollWhileUnpaid = options?.pollWhileUnpaid ?? false;
  return useQuery<Tenant | null>({
    queryKey: queryKeys.tenant,
    queryFn: async () => (await getMyTenant()).tenant,
    refetchInterval: (query) => {
      const tenant = query.state.data;
      return pollWhileUnpaid && tenant && tenant.status === 'unpaid'
        ? 3_000
        : false;
    },
  });
}

/** Live availability check; only fires for names that pass local validation. */
export function useSubdomainCheck(name: string) {
  return useQuery({
    queryKey: queryKeys.subdomainCheck(name),
    queryFn: () => checkSubdomain(name),
    enabled: name.length > 0 && validateSubdomain(name) === null,
    staleTime: 10_000,
    retry: false,
  });
}

export function useInvalidate() {
  const queryClient = useQueryClient();
  return {
    tenant: () => queryClient.invalidateQueries({ queryKey: queryKeys.tenant }),
    me: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  };
}
