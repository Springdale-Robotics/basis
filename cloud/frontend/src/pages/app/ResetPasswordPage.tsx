import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword } from '@/api/auth';
import { isApiError } from '@/api/client';
import { Wordmark } from '@/components/MarketingLayout';
import { Alert, Button } from '@/components/ui';
import { inputClasses } from '@/lib/cn';

const MIN_PASSWORD_LENGTH = 10;

function friendlyError(error: unknown): string {
  if (isApiError(error, 'RESET_TOKEN_EXPIRED')) {
    return 'This reset link has expired. Request a new one below.';
  }
  if (isApiError(error, 'RESET_TOKEN_INVALID')) {
    return 'This reset link is invalid or has already been used. Request a new one below.';
  }
  if (isApiError(error, 'WEAK_PASSWORD')) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (isApiError(error)) return error.message;
  return 'Something went wrong. Try again.';
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-stone-50 px-4 pt-16 sm:pt-24">
      <Link to="/" aria-label="Basis home">
        <Wordmark />
      </Link>
      <div className="mt-8 w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
        {children}
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (newPassword: string) => resetPassword(token, newPassword),
  });

  if (!token) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-stone-900">Reset password</h1>
        <Alert tone="error" className="mt-6">
          This reset link is missing or incomplete.
        </Alert>
        <p className="mt-5 text-center text-sm text-stone-500">
          <Link
            to="/app/forgot-password"
            className="font-medium text-pine-700 hover:text-pine-800"
          >
            Request a new link
          </Link>
        </p>
      </Shell>
    );
  }

  if (mutation.isSuccess) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-stone-900">Password updated</h1>
        <p className="mt-1 text-sm text-stone-500">
          You can now sign in with your new password.
        </p>
        <Link
          to="/app/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-pine-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pine-800"
        >
          Go to sign in
        </Link>
      </Shell>
    );
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setLocalError('Passwords don’t match.');
      return;
    }
    mutation.mutate(password);
  };

  const errorMessage =
    localError ?? (mutation.isError ? friendlyError(mutation.error) : null);
  const expiredOrInvalid =
    isApiError(mutation.error, 'RESET_TOKEN_EXPIRED') ||
    isApiError(mutation.error, 'RESET_TOKEN_INVALID');

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-stone-900">Reset password</h1>
      <p className="mt-1 text-sm text-stone-500">Choose a new password.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClasses()}
          />
          <p className="mt-1.5 text-xs text-stone-500">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
        <div>
          <label
            htmlFor="confirm"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={inputClasses()}
          />
        </div>

        {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

        <Button type="submit" busy={mutation.isPending} className="w-full py-2.5">
          Update password
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-stone-500">
        {expiredOrInvalid ? (
          <Link
            to="/app/forgot-password"
            className="font-medium text-pine-700 hover:text-pine-800"
          >
            Request a new link
          </Link>
        ) : (
          <Link
            to="/app/login"
            className="font-medium text-pine-700 hover:text-pine-800"
          >
            Back to sign in
          </Link>
        )}
      </p>
    </Shell>
  );
}
