import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { HouseholdSetup } from './HouseholdSetup';
import { AdminSetup } from './AdminSetup';
import { RemoteAccessSetup } from './RemoteAccessSetup';
import { SetupComplete } from './SetupComplete';
import { setupApi } from '@/api/setup';
import { cn } from '@/lib/utils';
import type { SetupHouseholdFormData, SetupAdminFormData } from '@/types/forms';

const steps = [
  { id: 'household', label: 'Create Household' },
  { id: 'admin', label: 'Admin Account' },
  { id: 'remote', label: 'Remote Access' },
  { id: 'complete', label: 'Complete' },
];

export function SetupWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createHouseholdMutation = useMutation({
    mutationFn: setupApi.createHousehold,
    onSuccess: (data) => {
      setHouseholdId(data.householdId);
      setCurrentStep(1);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const createAdminMutation = useMutation({
    mutationFn: (data: SetupAdminFormData) =>
      setupApi.createAdmin(householdId!, {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
      }),
    onSuccess: () => {
      setCurrentStep(2);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const remoteAccessMutation = useMutation({
    mutationFn: setupApi.configureRemoteAccess,
    onSuccess: () => {
      setCurrentStep(3);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const completeMutation = useMutation({
    mutationFn: setupApi.complete,
    onSuccess: () => {
      navigate('/login', { replace: true });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleHouseholdSubmit = (data: SetupHouseholdFormData) => {
    setError(null);
    createHouseholdMutation.mutate(data);
  };

  const handleAdminSubmit = (data: SetupAdminFormData) => {
    setError(null);
    createAdminMutation.mutate(data);
  };

  const handleRemoteAccessSubmit = (mode: 'local' | 'cloudflare' | 'tailscale' | 'custom') => {
    setError(null);
    remoteAccessMutation.mutate({ mode });
  };

  const handleComplete = () => {
    completeMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Progress indicator */}
        <nav aria-label="Progress" className="mb-8">
          <ol className="flex items-center justify-center space-x-4">
            {steps.map((step, index) => (
              <li key={step.id} className="flex items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium',
                    index < currentStep
                      ? 'border-primary bg-primary text-primary-foreground'
                      : index === currentStep
                      ? 'border-primary text-primary'
                      : 'border-muted text-muted-foreground'
                  )}
                >
                  {index < currentStep ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'ml-4 h-0.5 w-12',
                      index < currentStep ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                )}
              </li>
            ))}
          </ol>
          <div className="mt-2 text-center">
            <p className="text-sm font-medium">{steps[currentStep].label}</p>
          </div>
        </nav>

        {/* Error message */}
        {error && (
          <div className="mb-6 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Step content */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          {currentStep === 0 && (
            <HouseholdSetup
              onSubmit={handleHouseholdSubmit}
              isLoading={createHouseholdMutation.isPending}
            />
          )}
          {currentStep === 1 && (
            <AdminSetup
              onSubmit={handleAdminSubmit}
              isLoading={createAdminMutation.isPending}
            />
          )}
          {currentStep === 2 && (
            <RemoteAccessSetup
              onSubmit={handleRemoteAccessSubmit}
              onSkip={() => setCurrentStep(3)}
              isLoading={remoteAccessMutation.isPending}
            />
          )}
          {currentStep === 3 && (
            <SetupComplete
              onComplete={handleComplete}
              isLoading={completeMutation.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
