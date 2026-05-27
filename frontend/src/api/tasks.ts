import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Task, TaskKind, RecurrenceMode } from '@/types/models';

export interface CreateTaskRequest {
  kind: TaskKind;
  title: string;
  description?: string;
  assigneeUserId?: string | null;
  assigneeGroupId?: string | null;
  dueDate?: string | null;
  cadenceDays?: number | null;
  recurrenceMode?: RecurrenceMode | null;
  recurrenceRule?: string | null;
  pinned?: boolean;
  rewardPoints?: number;
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: 'pending' | 'completed';
}

export interface GetTasksParams {
  kind?: TaskKind;
  status?: 'pending' | 'completed';
  mine?: boolean;
  page?: number;
  limit?: number;
}

export interface ReorderRequest {
  // Ordered list of task IDs in the new order, within the same kind.
  taskIds: string[];
}

export interface RewardInfo {
  userId: string;
  points: number;
  lifetimePoints: number;
}

export interface RewardHistoryEntry {
  id: string;
  rewardId: string;
  taskId?: string;
  pointsChange: number;
  reason: string;
  createdAt: string;
}

export const tasksApi = {
  list: (params?: GetTasksParams) =>
    apiGet<{ tasks: Task[] }>('/tasks', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  get: (id: string) => apiGet<{ task: Task }>(`/tasks/${id}`),

  create: (data: CreateTaskRequest) => apiPost<{ task: Task }>('/tasks', data),

  update: (id: string, data: UpdateTaskRequest) =>
    apiPatch<{ task: Task }>(`/tasks/${id}`, data),

  delete: (id: string) => apiDelete<{ message: string }>(`/tasks/${id}`),

  complete: (id: string) =>
    apiPost<{ task: Task }>(`/tasks/${id}/complete`, {}),

  // Claim a task assigned to a group (self-assign).
  claim: (id: string) => apiPost<{ task: Task }>(`/tasks/${id}/claim`, {}),

  reorder: (data: ReorderRequest) =>
    apiPost<{ message: string }>('/tasks/reorder', data),

  // Rewards
  getRewards: () => apiGet<{ rewards: RewardInfo[] }>('/tasks/rewards'),

  getUserRewards: (userId: string) =>
    apiGet<{ reward: RewardInfo }>(`/tasks/rewards/${userId}`),

  getUserRewardsHistory: (userId: string) =>
    apiGet<{ history: RewardHistoryEntry[] }>(
      `/tasks/rewards/${userId}/history`,
    ),

  adjustRewards: (
    userId: string,
    adjustment: { points: number; reason: string },
  ) =>
    apiPost<{ points: number; lifetimePoints: number }>(
      `/tasks/rewards/${userId}/adjust`,
      adjustment,
    ),
};
