import { Link } from 'react-router-dom';
import { Home, ArrowLeft, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A Basis box has no mail server, so there is no emailed reset link — password
 * recovery goes through a household admin (Settings → Members → Reset
 * password). This page states that honestly instead of pretending to send
 * an email.
 */
export function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 text-2xl font-bold">
          <Home className="h-8 w-8" />
          <span>Basis</span>
        </div>

        <h2 className="mt-8 text-2xl font-bold">Forgot your password?</h2>

        <div className="mt-6 space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3 rounded-md border p-4">
            <KeyRound className="h-5 w-5 shrink-0 text-primary" />
            <p>
              Ask a household admin to reset your password. Admins can do this
              from{' '}
              <span className="font-medium text-foreground">
                Settings → Members → Reset password
              </span>
              , then share the new password with you so you can sign in and
              change it.
            </p>
          </div>
          <p>
            Basis runs entirely in your home and doesn't send email, so there's
            no emailed reset link. If you're the only admin and locked out,
            you'll need access to the server itself — see the recovery notes in
            the documentation.
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link to="/login">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
