import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Home } from 'lucide-react';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { useAuth } from '@/hooks/useAuth';

export function RegisterPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const householdId = searchParams.get('household');

  if (isAuthenticated && !isLoading) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!householdId) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen">
      {/* Left side - form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-1/2 lg:px-8">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold">
            <Home className="h-8 w-8" />
            <span>Home Manager</span>
          </div>

          <h2 className="mt-8 text-2xl font-bold">Create your account</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Join your household and start managing together
          </p>

          <div className="mt-8">
            <RegisterForm householdId={householdId} />
          </div>

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
