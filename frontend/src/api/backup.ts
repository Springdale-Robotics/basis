import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from './client';

export interface Backup {
  id: string;
  householdId: string;
  name?: string;
  filePath?: string;
  sizeBytes?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  includesFiles: boolean;
  error?: string;
  createdBy?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BackupSchedule {
  id: string;
  householdId: string;
  name: string;
  cronExpression: string;
  retentionDays: number;
  includeFiles: boolean;
  isEnabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface CreateBackupRequest {
  name?: string;
  includeFiles?: boolean;
}

export interface CreateScheduleRequest {
  name: string;
  cronExpression: string;
  retentionDays?: number;
  includeFiles?: boolean;
}

export const backupApi = {
  // Backups
  list: () =>
    apiGet<{ backups: Backup[] }>('/backup'),

  create: (data?: CreateBackupRequest) =>
    apiPost<{ backup: Backup }>('/backup', data || {}),

  get: (id: string) =>
    apiGet<{ backup: Backup }>(`/backup/${id}`),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/backup/${id}`),

  upload: (file: File, onProgress?: (progress: number) => void) =>
    apiUpload<{ backup: Backup }>('/backup/upload', file, { onProgress }),

  restore: (id: string) =>
    apiPost<{ message: string }>(`/backup/${id}/restore`, {}),

  // Schedules
  getSchedules: () =>
    apiGet<{ schedules: BackupSchedule[] }>('/backup/schedules'),

  createSchedule: (data: CreateScheduleRequest) =>
    apiPost<{ schedule: BackupSchedule }>('/backup/schedules', data),

  updateSchedule: (id: string, data: Partial<CreateScheduleRequest & { isEnabled: boolean }>) =>
    apiPatch<{ schedule: BackupSchedule }>(`/backup/schedules/${id}`, data),

  deleteSchedule: (id: string) =>
    apiDelete<{ message: string }>(`/backup/schedules/${id}`),
};
