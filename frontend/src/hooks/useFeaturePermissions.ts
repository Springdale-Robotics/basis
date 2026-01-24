import { useQuery } from '@tanstack/react-query';
import { permissionsApi, type Feature, type FeatureAccessInfo } from '@/api/permissions';
import { STALE_TIME } from '@/lib/constants';

export function useFeaturePermissions() {
  const { data, isLoading } = useQuery({
    queryKey: ['permissions', 'features', 'my-access'],
    queryFn: () => permissionsApi.getMyFeatureAccess(),
    staleTime: STALE_TIME.MEDIUM, // 5 minutes
  });

  const features = data?.features ?? null;

  return {
    features,
    isLoading,
    hasAccess: (feature: Feature) => features?.[feature]?.canView ?? false,
    canEdit: (feature: Feature) => features?.[feature]?.canEdit ?? false,
    canAdmin: (feature: Feature) => features?.[feature]?.canAdmin ?? false,
  };
}
