import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Household, HouseholdSettings, User } from '@/types/models';

export interface CreateHouseholdRequest {
  name: string;
  timezone: string;
}

export interface UpdateHouseholdRequest {
  name?: string;
  timezone?: string;
  settings?: Partial<HouseholdSettings>;
}

export interface InviteMemberRequest {
  email: string;
  role: 'member' | 'kid' | 'visitor';
}

export interface InviteResponse {
  id: string;
  code: string;
  email: string;
  role: string;
  expiresAt: string;
}

export const householdsApi = {
  getCurrent: () =>
    apiGet<{ household: Household }>('/households/current'),

  update: (data: UpdateHouseholdRequest) =>
    apiPatch<{ household: Household }>('/households/current', data),

  getMembers: () =>
    apiGet<{ members: User[] }>('/households/current/members'),

  inviteMember: (data: InviteMemberRequest) =>
    apiPost<{ invite: InviteResponse }>('/households/current/members/invite', data),

  removeMember: (userId: string) =>
    apiDelete<void>(`/households/current/members/${userId}`),

  updateMemberRole: (userId: string, role: string) =>
    apiPatch<{ member: User }>(`/households/current/members/${userId}`, { role }),

  getInvites: () =>
    apiGet<{ invites: InviteResponse[] }>('/households/current/members/invites'),

  revokeInvite: (inviteId: string) =>
    apiDelete<void>(`/households/current/members/invites/${inviteId}`),
};
