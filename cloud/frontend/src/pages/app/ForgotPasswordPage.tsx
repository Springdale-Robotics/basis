import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { forgotPassword } from '@/api/auth';
import { Wordmark } from '@/components/MarketingLayout';
import { Alert, Button } from '@/components/ui';
import { inputClasses } from '@/lib/cn';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');

  const mutation = useMutation({
    mutationFn: (address: string) => forgotPassword(address),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(email.trim());
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-stone-50 px-4 pt-16 sm:pt-24">
      <Link to="/" aria-label="Basis home">
        <Wordmark />
      </Link>
      <div className="mt-8 w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-stone-900">Forgot password</h1>
        <p className="mt-1 text-sm text-stone-500">
          Enter your email and we’ll send you a reset link.
        </p>

        {mutation.isSuccess ? (
          <div className="mt-6 space-y-4">
            <Alert tone="success">
              If an account exists for that email, we’ve sent a reset link. Check
              your inbox.
            </Alert>
            <p className="text-center text-sm text-stone-500">
              <Link
                to="/app/login"
                className="font-medium text-pine-700 hover:text-pine-800"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        ) : (
          <>
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

              {mutation.isError && (
                <Alert tone="error">Something went wrong. Try again.</Alert>
              )}

              <Button
                type="submit"
                busy={mutation.isPending}
                className="w-full py-2.5"
              >
                Send reset link
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-stone-500">
              <Link
                to="/app/login"
                className="font-medium text-pine-700 hover:text-pine-800"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
