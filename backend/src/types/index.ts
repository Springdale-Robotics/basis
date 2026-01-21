import type { UserRole, PermissionLevel, ResourceType, GranteeType } from '../lib/validators.js';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface PermissionContext {
  userId: string;
  householdId: string;
  userRole: UserRole;
  deviceId?: string;
}

export interface PermissionCheck {
  resourceType: ResourceType;
  resourceId: string;
  requiredLevel: PermissionLevel;
}

export type { UserRole, PermissionLevel, ResourceType, GranteeType };

export interface JwtPayload {
  sub: string;
  householdId: string;
  type: 'access' | 'refresh' | 'api';
  iat: number;
  exp: number;
}

export interface CalendarSyncCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}
