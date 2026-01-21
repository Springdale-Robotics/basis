import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Device, DeviceSettings } from '@/types/models';

export interface RegisterDeviceRequest {
  name: string;
  type: 'browser' | 'tablet' | 'kiosk' | 'mobile';
  isFixed?: boolean;
  allowedPages?: string[];
  defaultUserId?: string;
}

export interface UpdateDeviceRequest {
  name?: string;
  type?: 'browser' | 'tablet' | 'kiosk' | 'mobile';
  isFixed?: boolean;
  allowedPages?: string[];
  defaultUserId?: string | null;
}

export interface DeviceRule {
  id: string;
  deviceId: string;
  ruleType: 'time_based' | 'user_based' | 'always';
  condition?: Record<string, unknown>;
  allowedPages: string[];
  deniedPages: string[];
  defaultUserId?: string;
  priority?: number;
  createdAt: string;
}

export interface CreateDeviceRuleRequest {
  ruleType: 'time_based' | 'user_based' | 'always';
  condition?: Record<string, unknown>;
  allowedPages?: string[];
  deniedPages?: string[];
  defaultUserId?: string;
  priority?: number;
}

export const devicesApi = {
  list: () =>
    apiGet<{ devices: Device[] }>('/devices'),

  get: (id: string) =>
    apiGet<{ device: Device; settings: DeviceSettings | null }>(`/devices/${id}`),

  register: (data: RegisterDeviceRequest) =>
    apiPost<{ device: Device }>('/devices', data),

  update: (id: string, data: UpdateDeviceRequest) =>
    apiPatch<{ device: Device }>(`/devices/${id}`, data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/devices/${id}`),

  // Device Rules
  getRules: (deviceId: string) =>
    apiGet<{ rules: DeviceRule[] }>(`/devices/${deviceId}/rules`),

  createRule: (deviceId: string, data: CreateDeviceRuleRequest) =>
    apiPost<{ rule: DeviceRule }>(`/devices/${deviceId}/rules`, data),

  deleteRule: (deviceId: string, ruleId: string) =>
    apiDelete<{ message: string }>(`/devices/${deviceId}/rules/${ruleId}`),

  // Heartbeat
  heartbeat: (deviceId: string) =>
    apiPost<{ message: string }>(`/devices/${deviceId}/heartbeat`, {}),
};
