import { Link, Navigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import { LoginForm } from '@/components/auth/LoginForm';
import { useAuth } from '@/hooks/useAuth';

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isAuthenticated && !isLoading) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen">
      {/* Left side - form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-1/2 lg:px-8">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold">
            <Home className="h-8 w-8" />
            <span>Basis</span>
          </div>

          <h2 className="mt-8 text-2xl font-bold">Welcome back</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to your account to continue
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </div>

      {/* Right side - decorative */}
      <div className="hidden bg-muted lg:block lg:w-1/2">
        <div className="flex h-full items-center justify-center p-12">
          <div className="max-w-lg text-center">
            <h2 className="text-3xl font-bold">Manage your home, together</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Calendars, recipes, inventory, tasks, and more - all in one place
              for the whole family.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
