import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type { Household, HouseholdSettings, User, UserRole } from '@/types/models';

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
  role: UserRole;
  email?: string;
}

export interface MemberInvite {
  id: string;
  inviteCode: string;
  inviteLink: string;
  email?: string;
  role: UserRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  createdAt: string;
}

// Legacy type for backwards compatibility
export interface InviteResponse extends MemberInvite {}

export const householdsApi = {
  getCurrent: () =>
    apiGet<{ household: Household }>('/households/current'),

  update: (data: UpdateHouseholdRequest) =>
    apiPatch<{ household: Household }>('/households/current', data),

  getMembers: () =>
    apiGet<{ members: User[] }>('/households/current/members'),

  inviteMember: (data: InviteMemberRequest) =>
    apiPost<{ invite: MemberInvite }>('/households/current/members/invite', data),

  removeMember: (userId: string) =>
    apiDelete<void>(`/households/current/members/${userId}`),

  updateMemberRole: (userId: string, role: UserRole) =>
    apiPatch<{ member: User }>(`/households/current/members/${userId}`, { role }),

  getInvites: () =>
    apiGet<{ invites: MemberInvite[] }>('/households/current/members/invites'),

  revokeInvite: (inviteId: string) =>
    apiDelete<void>(`/households/current/members/invites/${inviteId}`),
};
