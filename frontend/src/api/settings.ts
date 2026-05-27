import { apiGet, apiPatch, apiPost } from './client';

export type TailscaleIssue =
  | 'not_installed'
  | 'needs_login'
  | 'needs_operator'
  | 'daemon_offline'
  | 'cli_timeout'
  | 'unknown_error';

export interface TailscaleDetectResult {
  available: boolean;
  hostname?: string;
  tailnet?: string;
  tailscaleIPs?: string[];
  issues: TailscaleIssue[];
  serve: {
    configured: boolean;
    httpsPort?: number;
    target?: string;
  };
}

export type CloudflaredIssue =
  | 'not_installed'
  | 'spawn_failed'
  | 'child_exited'
  | 'unknown_error';

export interface CloudflaredStatus {
  installed: boolean;
  version?: string;
  running: boolean;
  lastError?: string;
  issues: CloudflaredIssue[];
}
import type { HouseholdSettings, ThemeConfig } from '@/types/models';

export type RemoteAccessMode =
  | 'local_only'
  | 'cloudflare'
  | 'tailscale'
  | 'custom_domain';

export interface RemoteAccessSettings {
  mode: RemoteAccessMode;
  publicUrl?: string;
  localUrl?: string;
  cloudflare?: {
    tunnelId: string;
    tunnelToken: string;
  };
  tailscale?: {
    hostname: string;
    tailnet: string;
    magicDnsUrl: string;
  };
  customDomain?: {
    domain: string;
    sslConfigured: boolean;
  };
}

export type UpdateRemoteAccessRequest = Partial<{
  mode: RemoteAccessMode;
  publicUrl: string | null;
  localUrl: string | null;
  cloudflare: RemoteAccessSettings['cloudflare'] | null;
  tailscale: RemoteAccessSettings['tailscale'] | null;
  customDomain: RemoteAccessSettings['customDomain'] | null;
}>;

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
    apiGet<{ remoteAccess: RemoteAccessSettings }>('/settings/remote-access'),

  updateRemoteAccess: (data: UpdateRemoteAccessRequest) =>
    apiPatch<{ remoteAccess: RemoteAccessSettings }>('/settings/remote-access', data),

  detectTailscale: () =>
    apiGet<TailscaleDetectResult>('/settings/remote-access/tailscale/detect'),

  enableTailscale: () =>
    apiPost<{ publicUrl: string; remoteAccess: RemoteAccessSettings }>(
      '/settings/remote-access/tailscale/enable'
    ),

  disableTailscale: () =>
    apiPost<{ remoteAccess: RemoteAccessSettings }>(
      '/settings/remote-access/tailscale/disable'
    ),

  enableTailscaleFunnel: () =>
    apiPost<{ path: string; publicHostname: string }>(
      '/settings/remote-access/tailscale/funnel/enable'
    ),

  generateIosProfile: (deviceLabel: string) =>
    apiPost<{
      appPasswordId: string;
      deviceLabel: string;
      installUrl: string;
      expiresInSeconds: number;
    }>('/users/me/connect/ios', { deviceLabel }),

  disableTailscaleFunnel: () =>
    apiPost<{ message: string }>(
      '/settings/remote-access/tailscale/funnel/disable'
    ),

  detectCloudflared: () =>
    apiGet<CloudflaredStatus>('/settings/remote-access/cloudflare/detect'),

  connectCloudflare: (token: string, publicUrl: string) =>
    apiPost<{ status: CloudflaredStatus; publicUrl: string }>(
      '/settings/remote-access/cloudflare/connect',
      { token, publicUrl }
    ),

  disconnectCloudflare: () =>
    apiPost<{ message: string }>(
      '/settings/remote-access/cloudflare/disconnect'
    ),

  testRemoteUrl: (url: string) =>
    apiPost<{ ok: boolean; status?: number; elapsedMs: number; reason?: string }>(
      '/settings/remote-access/test-url',
      { url }
    ),

  getFeatures: () =>
    apiGet<{ features: FeatureSettings }>('/settings/features'),

  updateFeatures: (data: Partial<FeatureSettings>) =>
    apiPatch<{ features: FeatureSettings }>('/settings/features', data),

  getStorageSettings: () =>
    apiGet<StorageSettingsResponse>('/settings/storage'),

  updateStorageSettings: (data: UpdateStorageSettingsRequest) =>
    apiPatch<{ storage: StorageSettings }>('/settings/storage', data),
};
