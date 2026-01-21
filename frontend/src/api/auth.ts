import { apiGet, apiPost, apiDelete } from './client';
import type { User, Household } from '@/types/models';

export interface LoginRequest {
  email: string;
  password: string;
  deviceId?: string;
}

export interface LoginResponse {
  user: User;
  household: Household;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  householdId: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
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

  register: (data: RegisterRequest) =>
    apiPost<LoginResponse>('/auth/register', data),

  me: () =>
    apiGet<{ user: User }>('/auth/me'),

  forgotPassword: (data: ForgotPasswordRequest) =>
    apiPost<{ message: string }>('/auth/forgot-password', data),

  resetPassword: (data: ResetPasswordRequest) =>
    apiPost<{ message: string }>('/auth/reset-password', data),

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
