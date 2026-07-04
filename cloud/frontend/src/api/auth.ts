import { api } from './client';
import type { Account } from './types';

export interface Credentials {
  email: string;
  password: string;
}

export function signup(credentials: Credentials) {
  return api.post<{ account: Account }>('/api/auth/signup', credentials);
}

export function login(credentials: Credentials) {
  return api.post<{ account: Account }>('/api/auth/login', credentials);
}

export function logout() {
  return api.post<Record<string, never>>('/api/auth/logout');
}

export function getMe() {
  return api.get<{ account: Account }>('/api/auth/me');
}
