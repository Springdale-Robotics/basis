import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Notification } from '@/types/models';

export interface GetNotificationsParams {
  unreadOnly?: boolean;
}

export interface NotificationPreferences {
  lowStock: boolean;
  expiringSoon: boolean;
  taskDue: boolean;
  syncErrors: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

export const notificationsApi = {
  list: (params?: GetNotificationsParams) =>
    apiGet<{ notifications: Notification[] }>('/notifications', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  markAsRead: (id: string) =>
    apiPatch<{ notification: Notification }>(`/notifications/${id}/read`, {}),

  markAllAsRead: () =>
    apiPost<{ message: string }>('/notifications/read-all', {}),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/notifications/${id}`),

  getUnreadCount: () =>
    apiGet<{ count: number }>('/notifications/unread-count'),

  getSettings: () =>
    apiGet<{ preferences: NotificationPreferences }>('/notifications/settings'),

  updateSettings: (data: Partial<NotificationPreferences>) =>
    apiPatch<{ preferences: NotificationPreferences }>('/notifications/settings', data),

  executeAction: (id: string, actionId: string) =>
    apiPost<{ message: string; endpoint?: string }>(`/notifications/${id}/action`, { actionId }),
};
