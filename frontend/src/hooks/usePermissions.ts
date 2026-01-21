import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { UserRole } from '@/types/models';

interface PermissionConfig {
  pages: string[];
  actions: string[];
  excludePages?: string[];
  limitedEdit?: boolean;
}

const rolePermissions: Record<UserRole, PermissionConfig> = {
  admin: {
    pages: ['*'],
    actions: ['*'],
  },
  member: {
    pages: ['calendar', 'recipes', 'inventory', 'tasks', 'lists', 'files', 'settings'],
    actions: ['create', 'edit', 'delete', 'view'],
    excludePages: ['settings/household', 'settings/members'],
  },
  kid: {
    pages: ['calendar', 'recipes', 'tasks', 'rewards'],
    actions: ['view', 'complete-task'],
    limitedEdit: true,
  },
  visitor: {
    pages: ['calendar', 'recipes'],
    actions: ['view'],
  },
};

export function usePermissions() {
  const { user } = useAuthStore();

  const permissions = useMemo(() => {
    if (!user) {
      return {
        canAccess: () => false,
        canPerform: () => false,
        isAdmin: false,
        role: null as UserRole | null,
      };
    }

    const config = rolePermissions[user.role];

    const canAccess = (page: string): boolean => {
      if (config.pages.includes('*')) return true;
      if (config.excludePages?.some((p) => page.startsWith(p))) return false;
      return config.pages.some((p) => page.startsWith(p));
    };

    const canPerform = (action: string): boolean => {
      if (config.actions.includes('*')) return true;
      return config.actions.includes(action);
    };

    return {
      canAccess,
      canPerform,
      isAdmin: user.role === 'admin',
      role: user.role,
      limitedEdit: config.limitedEdit ?? false,
    };
  }, [user]);

  return permissions;
}
