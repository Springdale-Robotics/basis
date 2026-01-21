import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { HouseholdConnection, ConnectionPermissions } from '@/types/models';

export interface UpdateConnectionRequest {
  permissions?: Partial<ConnectionPermissions>;
}

export const connectionsApi = {
  list: () =>
    apiGet<HouseholdConnection[]>('/connections'),

  get: (id: string) =>
    apiGet<HouseholdConnection>(`/connections/${id}`),

  update: (id: string, data: UpdateConnectionRequest) =>
    apiPatch<HouseholdConnection>(`/connections/${id}`, data),

  disconnect: (id: string) =>
    apiDelete<void>(`/connections/${id}`),

  getSharedResources: (connectionId: string) =>
    apiGet<{
      calendars: string[];
      recipes: string[];
      files: string[];
    }>(`/connections/${connectionId}/shared`),
};
