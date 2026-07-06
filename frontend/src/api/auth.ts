import { apiGet, apiPost, apiDelete } from './client';
import type { User, Household, UserRole } from '@/types/models';

export interface LoginRequest {
  email: string;
  password: string;
  deviceId?: string;
}

export interface LoginResponse {
  user: User;
  household: Household;
}

export interface RegisterWithInviteRequest {
  inviteCode: string;
  email: string;
  password: string;
  displayName: string;
}

export interface ValidateInviteResponse {
  invite: {
    role: UserRole;
    householdName: string;
    expiresAt: string;
  };
}

export interface Session {
  id: string;
  deviceId?: string;
  ipAddress?: string;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiPost<LoginResponse>('/auth/login', data),

  logout: () =>
    apiPost<{ message: string }>('/auth/logout', {}),

  validateInvite: (code: string) =>
    apiGet<ValidateInviteResponse>(`/auth/invite/${code}`),

  registerWithInvite: (data: RegisterWithInviteRequest) =>
    apiPost<LoginResponse>('/auth/register/invite', data),

  me: () =>
    apiGet<{ user: User }>('/auth/me'),

  refreshSession: () =>
    apiPost<{ expiresAt: string }>('/auth/refresh', {}),

  getSessions: () =>
    apiGet<{ sessions: Session[] }>('/auth/sessions'),

  revokeSession: (id: string) =>
    apiDelete<{ message: string }>(`/auth/sessions/${id}`),

  logoutAll: () =>
    apiPost<{ message: string }>('/auth/logout-all', {}),

  logoutAllIncludingCurrent: () =>
    apiPost<{ message: string }>('/auth/logout-all-including-current', {}),
};
