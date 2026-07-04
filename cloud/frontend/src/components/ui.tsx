import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-pine-700 text-white hover:bg-pine-800 disabled:hover:bg-pine-700',
  secondary:
    'border border-stone-300 bg-white text-stone-900 hover:border-stone-400 hover:bg-stone-50',
  danger:
    'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  ghost: 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  busy?: boolean;
}

export function Button({
  variant = 'primary',
  busy = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        buttonVariants[variant],
        className,
      )}
      {...props}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Spinner                                                             */
/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className ?? 'h-5 w-5')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-stone-200 bg-white p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2 className={cn('text-base font-semibold text-stone-900', className)}>
      {children}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export type BadgeTone = 'green' | 'amber' | 'red' | 'gray' | 'pine';

const badgeTones: Record<BadgeTone, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-stone-100 text-stone-600',
  pine: 'bg-pine-100 text-pine-800',
};

export function Badge({
  tone = 'gray',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Alert banner                                                        */
/* ------------------------------------------------------------------ */

type AlertTone = 'success' | 'error' | 'warning' | 'info';

const alertTones: Record<AlertTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-stone-200 bg-stone-50 text-stone-700',
};

export function Alert({
  tone = 'info',
  className,
  children,
  onDismiss,
}: {
  tone?: AlertTone;
  className?: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
        alertTones[tone],
        className,
      )}
    >
      <div>{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 rounded p-0.5 opacity-60 hover:opacity-100"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Copy button                                                         */
/* ------------------------------------------------------------------ */

export function CopyButton({
  text,
  className,
  label = 'Copy',
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — nothing to do.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        copied
          ? 'text-emerald-600'
          : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900',
        className,
      )}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
