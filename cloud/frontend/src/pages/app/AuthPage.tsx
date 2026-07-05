import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { login, signup, type Credentials } from '@/api/auth';
import { isApiError } from '@/api/client';
import type { Account } from '@/api/types';
import { Wordmark } from '@/components/MarketingLayout';
import { Alert, Button, Spinner } from '@/components/ui';
import { queryKeys, useMe } from '@/hooks/queries';
import { inputClasses } from '@/lib/cn';

const MIN_PASSWORD_LENGTH = 10;

function friendlyError(error: unknown): string {
  if (isApiError(error, 'EMAIL_TAKEN')) {
    return 'An account with that email already exists — sign in instead.';
  }
  if (isApiError(error, 'WEAK_PASSWORD')) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (isApiError(error, 'INVALID_CREDENTIALS')) {
    return 'Wrong email or password.';
  }
  if (isApiError(error)) return error.message;
  return 'Something went wrong. Try again.';
}

function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const mutation = useMutation({
    mutationFn: (credentials: Credentials) =>
      isSignup ? signup(credentials) : login(credentials),
    onSuccess: ({ account }: { account: Account }) => {
      queryClient.setQueryData(queryKeys.me, account);
      navigate(from, { replace: true });
    },
  });

  if (me.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-pine-700" />
      </div>
    );
  }
  if (me.data) return <Navigate to="/app" replace />;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (isSignup && password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    mutation.mutate({ email: email.trim(), password });
  };

  const errorMessage =
    localError ?? (mutation.isError ? friendlyError(mutation.error) : null);

  return (
    <div className="flex min-h-screen flex-col items-center bg-stone-50 px-4 pt-16 sm:pt-24">
      <Link to="/" aria-label="Basis home">
        <Wordmark />
      </Link>
      <div className="mt-8 w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-stone-900">
          {isSignup ? 'Create your account' : 'Sign in'}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {isSignup
            ? 'One account per household — you’ll claim your address next.'
            : 'Manage your Basis Remote address and billing.'}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-stone-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClasses()}
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-stone-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
              minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClasses()}
            />
            {isSignup ? (
              <p className="mt-1.5 text-xs text-stone-500">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            ) : (
              <p className="mt-1.5 text-right text-sm">
                <Link
                  to="/app/forgot-password"
                  className="font-medium text-pine-700 hover:text-pine-800"
                >
                  Forgot password?
                </Link>
              </p>
            )}
          </div>

          {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

          <Button
            type="submit"
            busy={mutation.isPending}
            className="w-full py-2.5"
          >
            {isSignup ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-stone-500">
          {isSignup ? (
            <>
              Already have an account?{' '}
              <Link
                to="/app/login"
                className="font-medium text-pine-700 hover:text-pine-800"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              New to Basis Remote?{' '}
              <Link
                to="/app/signup"
                className="font-medium text-pine-700 hover:text-pine-800"
              >
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function LoginPage() {
  return <AuthForm mode="login" />;
}

export function SignupPage() {
  return <AuthForm mode="signup" />;
}
