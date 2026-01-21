import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SetupWizard } from '@/components/setup/SetupWizard';
import { setupApi } from '@/api/setup';
import { LoadingPage } from '@/components/shared/LoadingSpinner';

export function SetupPage() {
  const { data: status, isLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: setupApi.getStatus,
  });

  if (isLoading) {
    return <LoadingPage />;
  }

  if (status?.isSetupComplete) {
    return <Navigate to="/login" replace />;
  }

  return <SetupWizard />;
}
