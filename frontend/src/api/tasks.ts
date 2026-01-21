import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Task, Achievement } from '@/types/models';

export interface CreateTaskRequest {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  isChore?: boolean;
  assignedTo?: string;
  rewardPoints?: number;
  recurrenceRule?: string | null;
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface GetTasksParams {
  status?: 'pending' | 'in_progress' | 'completed';
  assignedTo?: string;
  isChore?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateAchievementRequest {
  name: string;
  description: string;
  icon: string;
  pointsRequired?: number;
  tasksRequired?: number;
}

export interface RewardInfo {
  points: number;
  lifetimePoints: number;
}

export interface RewardHistoryEntry {
  id: string;
  userId: string;
  points: number;
  reason: string;
  taskId?: string;
  createdAt: string;
}

export const tasksApi = {
  list: (params?: GetTasksParams) =>
    apiGet<{ tasks: Task[] }>('/tasks', {
      params: params as Record<string, string | number | boolean | undefined>
    }),

  get: (id: string) =>
    apiGet<{ task: Task }>(`/tasks/${id}`),

  create: (data: CreateTaskRequest) =>
    apiPost<{ task: Task }>('/tasks', data),

  update: (id: string, data: UpdateTaskRequest) =>
    apiPatch<{ task: Task }>(`/tasks/${id}`, data),

  delete: (id: string) =>
    apiDelete<{ message: string }>(`/tasks/${id}`),

  complete: (id: string) =>
    apiPost<{ task: Task }>(`/tasks/${id}/complete`, {}),

  assign: (id: string, userId: string) =>
    apiPost<{ task: Task }>(`/tasks/${id}/assign`, { userId }),

  // Chores
  getChores: () =>
    apiGet<{ chores: Task[] }>('/tasks/chores'),

  // Rewards
  getRewards: () =>
    apiGet<{ rewards: RewardInfo[] }>('/tasks/rewards'),

  getUserRewards: (userId: string) =>
    apiGet<{ reward: RewardInfo }>(`/tasks/rewards/${userId}`),

  getUserRewardsHistory: (userId: string) =>
    apiGet<{ history: RewardHistoryEntry[] }>(`/tasks/rewards/${userId}/history`),

  adjustRewards: (userId: string, adjustment: { points: number; reason: string }) =>
    apiPost<{ points: number; lifetimePoints: number }>(`/tasks/rewards/${userId}/adjust`, adjustment),

  // Achievements
  getAchievements: () =>
    apiGet<{ achievements: Achievement[] }>('/tasks/achievements'),

  createAchievement: (data: CreateAchievementRequest) =>
    apiPost<{ achievement: Achievement }>('/tasks/achievements', data),

  getUserAchievements: (userId: string) =>
    apiGet<{ achievements: Achievement[] }>(`/tasks/users/${userId}/achievements`),

  awardAchievement: (userId: string, achievementId: string) =>
    apiPost<{ awarded: Achievement }>(`/tasks/users/${userId}/achievements`, { achievementId }),
};
