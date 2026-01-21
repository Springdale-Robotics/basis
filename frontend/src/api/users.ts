import { apiGet, apiPatch } from './client';
import type { User, Session } from '@/types/models';

export interface UpdateUserRequest {
  displayName?: string;
  email?: string;
}

export const usersApi = {
  get: (id: string) =>
    apiGet<User>(`/users/${id}`),

  update: (id: string, data: UpdateUserRequest) =>
    apiPatch<User>(`/users/${id}`, data),

  getSessions: (userId: string) =>
    apiGet<Session[]>(`/users/${userId}/sessions`),
};
