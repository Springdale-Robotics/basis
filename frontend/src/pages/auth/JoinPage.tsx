import { Link, Navigate, useParams } from 'react-router-dom';
import { Home, Loader2, AlertCircle } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { authApi } from '@/api/auth';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';
import { registerFormSchema, type RegisterFormData } from '@/types/forms';
import { getErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
  kid: 'Kid',
  visitor: 'Visitor',
};

export function JoinPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  // Validate the invite code
  const {
    data: inviteData,
    isLoading: inviteLoading,
    error: inviteError,
  } = useQuery({
    queryKey: ['invite', inviteCode],
    queryFn: () => authApi.validateInvite(inviteCode!),
    enabled: !!inviteCode && !isAuthenticated,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      displayName: '',
    },
  });

  const registerMutation = useMutation({
    mutationFn: authApi.registerWithInvite,
    onSuccess: (data) => {
      setAuth(data.user, data.household);
      navigate('/dashboard', { replace: true });
    },
    onError: (err) => {
      setError(getErrorMessage(err));
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setError(null);
    registerMutation.mutate({
      inviteCode: inviteCode!,
      email: data.email,
      password: data.password,
      displayName: data.displayName,
    });
  };

  // Redirect if already authenticated
  if (isAuthenticated && !authLoading) {
    return <Navigate to="/dashboard" replace />;
  }

  // Loading state
  if (inviteLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state - invalid invite
  if (inviteError || !inviteData) {
    const errorMessage = inviteError ? getErrorMessage(inviteError) : 'Invalid invite link';

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <h2 className="mt-4 text-xl font-semibold">Invalid Invite</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {errorMessage}
              </p>
              <div className="mt-6 flex gap-3">
                <Button variant="outline" asChild>
                  <Link to="/login">Sign In</Link>
                </Button>
                <Button asChild>
                  <Link to="/setup">Create Household</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const invite = inviteData.invite;

  return (
    <div className="flex min-h-screen">
      {/* Left side - form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-1/2 lg:px-8">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold">
            <Home className="h-8 w-8" />
            <span>Basis</span>
          </div>

          <h2 className="mt-8 text-2xl font-bold">Join {invite.householdName}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            You've been invited as a{' '}
            <Badge variant="secondary" className="ml-1">
              {ROLE_LABELS[invite.role] || invite.role}
            </Badge>
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="Your name"
                autoComplete="name"
                {...register('displayName')}
              />
              {errors.displayName && (
                <p className="text-sm text-destructive">{errors.displayName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Account
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* Right side - decorative */}
      <div className="hidden bg-muted lg:block lg:w-1/2">
        <div className="flex h-full items-center justify-center p-12">
          <div className="max-w-lg text-center">
            <h2 className="text-3xl font-bold">Join your household</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Create your account to access shared calendars, recipes, tasks, and more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
