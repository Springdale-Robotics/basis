import { apiGet, apiPost, apiDelete } from './client';

export interface AppPasswordSummary {
  id: string;
  label: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateAppPasswordResponse {
  appPassword: AppPasswordSummary;
  secret: string;
}

export const appPasswordsApi = {
  list: () =>
    apiGet<{ appPasswords: AppPasswordSummary[] }>('/users/me/app-passwords'),

  create: (label: string, scopes: string[] = ['caldav']) =>
    apiPost<CreateAppPasswordResponse, { label: string; scopes: string[] }>(
      '/users/me/app-passwords',
      { label, scopes }
    ),

  revoke: (id: string) =>
    apiDelete<{ message: string }>(`/users/me/app-passwords/${id}`),
};
