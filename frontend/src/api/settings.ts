import { apiGet, apiPatch } from './client';
import type { HouseholdSettings, ThemeConfig } from '@/types/models';

export interface RemoteAccessSettings {
  mode: 'local' | 'cloudflare' | 'tailscale' | 'custom';
  publicUrl?: string;
  cloudflare?: {
    tunnelId?: string;
    domain?: string;
  };
  tailscale?: {
    hostname?: string;
  };
  custom?: {
    domain: string;
    ddnsProvider?: string;
  };
}

export interface FeatureSettings {
  calendar: boolean;
  recipes: boolean;
  inventory: boolean;
  tasks: boolean;
  rewards: boolean;
  smartHome: boolean;
  files: boolean;
}

export interface StorageSettings {
  limitGb: number | null;
  warnAtPercent: number;
}

export interface StorageSettingsResponse {
  storage: StorageSettings;
  systemDefaultGb: number | null;
  diskCapacityGb: number | null;
  currentUsageBytes: number;
}

export interface UpdateStorageSettingsRequest {
  limitGb?: number | null;
  warnAtPercent?: number;
}

export const settingsApi = {
  getHouseholdSettings: () =>
    apiGet<HouseholdSettings>('/settings/household'),

  updateHouseholdSettings: (data: Partial<HouseholdSettings>) =>
    apiPatch<HouseholdSettings>('/settings/household', data),

  getTheme: () =>
    apiGet<ThemeConfig>('/settings/theme'),

  updateTheme: (data: Partial<ThemeConfig>) =>
    apiPatch<ThemeConfig>('/settings/theme', data),

  getRemoteAccess: () =>
    apiGet<RemoteAccessSettings>('/settings/remote-access'),

  getFeatures: () =>
    apiGet<FeatureSettings>('/settings/features'),

  updateFeatures: (data: Partial<FeatureSettings>) =>
    apiPatch<FeatureSettings>('/settings/features', data),

  getStorageSettings: () =>
    apiGet<StorageSettingsResponse>('/settings/storage'),

  updateStorageSettings: (data: UpdateStorageSettingsRequest) =>
    apiPatch<{ storage: StorageSettings }>('/settings/storage', data),
};
