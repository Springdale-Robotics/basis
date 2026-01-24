import type { ReactNode } from 'react';
import { useFeaturePermissions } from '@/hooks/useFeaturePermissions';
import type { Feature } from '@/api/permissions';

interface FeatureGateProps {
  feature: Feature;
  require?: 'view' | 'edit' | 'admin';
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({
  feature,
  require = 'view',
  children,
  fallback = null,
}: FeatureGateProps) {
  const { hasAccess, canEdit, canAdmin, isLoading } = useFeaturePermissions();

  if (isLoading) return null; // Hide while loading to prevent flash

  const permitted =
    require === 'admin'
      ? canAdmin(feature)
      : require === 'edit'
      ? canEdit(feature)
      : hasAccess(feature);

  return permitted ? <>{children}</> : <>{fallback}</>;
}

// Convenience wrapper for edit permission checks
interface EditGateProps {
  feature: Feature;
  children: ReactNode;
  fallback?: ReactNode;
}

export function EditGate({ feature, children, fallback }: EditGateProps) {
  return (
    <FeatureGate feature={feature} require="edit" fallback={fallback}>
      {children}
    </FeatureGate>
  );
}
