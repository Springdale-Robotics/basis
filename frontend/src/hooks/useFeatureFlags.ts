import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { settingsApi } from '@/api/settings';

interface FeatureFlags {
  calendar: boolean;
  recipes: boolean;
  inventory: boolean;
  tasks: boolean;
  rewards: boolean;
  smartHome: boolean;
  files: boolean;
}

const defaultFlags: FeatureFlags = {
  calendar: true,
  recipes: true,
  inventory: true,
  tasks: true,
  rewards: false,
  smartHome: true,
  files: true,
};

/**
 * Reads the household's enabled features. The Household object on the auth
 * store stores them under either `features` or `enabledFeatures` depending on
 * how it was hydrated; we additionally fetch the authoritative settings via
 * the API and merge so toggles update without a full reload.
 */
export function useFeatureFlags(): FeatureFlags {
  const { household, isAuthenticated } = useAuthStore();

  const { data } = useQuery({
    queryKey: ['settings', 'features'],
    queryFn: () => settingsApi.getFeatures(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const fromStore = (household?.settings as
      | { features?: Partial<FeatureFlags>; enabledFeatures?: Partial<FeatureFlags> }
      | undefined);
    const stored = fromStore?.features ?? fromStore?.enabledFeatures ?? {};
    return {
      ...defaultFlags,
      ...stored,
      ...(data?.features ?? {}),
    };
  }, [household?.settings, data]);
}

export function useFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const flags = useFeatureFlags();
  return flags[feature];
}
