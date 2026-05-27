import { apiGet, apiPatch } from './client';
import type { User, Session } from '@/types/models';

export interface UpdateUserRequest {
  displayName?: string;
  email?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const usersApi = {
  get: (id: string) =>
    apiGet<User>(`/users/${id}`),

  update: (id: string, data: UpdateUserRequest) =>
    apiPatch<User>(`/users/${id}`, data),

  changePassword: (id: string, data: ChangePasswordRequest) =>
    apiPatch<{ message: string }>(`/users/${id}/password`, data),

  getSessions: (userId: string) =>
    apiGet<Session[]>(`/users/${userId}/sessions`),
};
