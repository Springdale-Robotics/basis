import { Home } from 'lucide-react';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 text-2xl font-bold">
          <Home className="h-8 w-8" />
          <span>Basis</span>
        </div>

        <h2 className="mt-8 text-2xl font-bold">Reset your password</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your new password below
        </p>

        <div className="mt-8">
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
