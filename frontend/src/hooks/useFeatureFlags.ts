import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';

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
  rewards: true,
  smartHome: true,
  files: true,
};

export function useFeatureFlags(): FeatureFlags {
  const { household } = useAuthStore();

  return useMemo(() => {
    if (!household?.settings?.features) {
      return defaultFlags;
    }

    return {
      ...defaultFlags,
      ...household.settings.features,
    };
  }, [household?.settings?.features]);
}

export function useFeatureEnabled(feature: keyof FeatureFlags): boolean {
  const flags = useFeatureFlags();
  return flags[feature];
}
