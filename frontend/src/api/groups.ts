import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface Group {
  id: string;
  householdId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface GroupMember {
  id: string;
  userId: string;
  memberType: 'user' | 'connected_household_user';
  addedAt: string;
  user: {
    id: string;
    displayName: string;
    email: string;
    avatarUrl?: string;
  };
}

export interface CreateGroupInput {
  name: string;
  description?: string;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
}

// List all groups in the household
export function listGroups() {
  return apiGet<{ groups: Group[] }>('/groups');
}

// Get a group with its members
export function getGroup(groupId: string) {
  return apiGet<{ group: Group; members: GroupMember[] }>(`/groups/${groupId}`);
}

// Create a new group
export function createGroup(input: CreateGroupInput) {
  return apiPost<{ group: Group }>('/groups', input);
}

// Update a group
export function updateGroup(groupId: string, input: UpdateGroupInput) {
  return apiPatch<{ group: Group }>(`/groups/${groupId}`, input);
}

// Delete a group
export function deleteGroup(groupId: string) {
  return apiDelete<{ message: string }>(`/groups/${groupId}`);
}

// Add a member to a group
export function addGroupMember(groupId: string, userId: string) {
  return apiPost<{ member: GroupMember }>(`/groups/${groupId}/members`, { userId });
}

// Remove a member from a group
export function removeGroupMember(groupId: string, userId: string) {
  return apiDelete<{ message: string }>(`/groups/${groupId}/members/${userId}`);
}

export const groupsApi = {
  list: listGroups,
  get: getGroup,
  create: createGroup,
  update: updateGroup,
  delete: deleteGroup,
  addMember: addGroupMember,
  removeMember: removeGroupMember,
};
