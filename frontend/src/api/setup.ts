import { apiGet, apiPost } from './client';

export interface SetupStatus {
  isSetupComplete: boolean;
  hasHousehold: boolean;
  hasAdmin: boolean;
}

export interface SetupHouseholdRequest {
  name: string;
  timezone: string;
}

export interface SetupAdminRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface SetupRemoteAccessRequest {
  mode: 'local' | 'cloudflare' | 'tailscale' | 'custom';
  config?: Record<string, unknown>;
}

export interface SetupCompleteResponse {
  success: boolean;
  loginUrl: string;
}

export const setupApi = {
  getStatus: () =>
    apiGet<SetupStatus>('/setup/status'),

  createHousehold: (data: SetupHouseholdRequest) =>
    apiPost<{ householdId: string }>('/setup/household', data),

  createAdmin: (householdId: string, data: SetupAdminRequest) =>
    apiPost<{ userId: string }>('/setup/admin', { ...data, householdId }),

  configureRemoteAccess: (data: SetupRemoteAccessRequest) =>
    apiPost<void>('/setup/remote-access', data),

  complete: () =>
    apiPost<SetupCompleteResponse>('/setup/complete', {}),
};
