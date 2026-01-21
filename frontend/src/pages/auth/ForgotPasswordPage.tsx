import { Home } from 'lucide-react';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 text-2xl font-bold">
          <Home className="h-8 w-8" />
          <span>Home Manager</span>
        </div>

        <h2 className="mt-8 text-2xl font-bold">Forgot your password?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your email and we'll send you a reset link
        </p>

        <div className="mt-8">
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
