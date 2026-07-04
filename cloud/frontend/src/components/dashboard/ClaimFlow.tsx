import { useEffect, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createCheckout } from '@/api/billing';
import { isApiError } from '@/api/client';
import { createTenant } from '@/api/tenants';
import type { Tier } from '@/api/types';
import { TierPicker } from '@/components/dashboard/TierPicker';
import { Alert, Button, Card, Spinner } from '@/components/ui';
import { useInvalidate, useSubdomainCheck } from '@/hooks/queries';
import { inputClasses } from '@/lib/cn';
import { normalizeSubdomainInput, validateSubdomain } from '@/lib/subdomain';

function unavailableMessage(name: string, reason?: string): string {
  switch (reason) {
    case 'reserved':
      return `${name} is reserved.`;
    case 'taken':
      return `${name}.home-basis.com is already taken.`;
    case 'invalid format':
      return 'That name has an invalid format.';
    default:
      return `${name}.home-basis.com is not available${reason ? ` (${reason})` : ''}.`;
  }
}

function SubdomainField({
  value,
  onChange,
  onAvailable,
}: {
  value: string;
  onChange: (value: string) => void;
  onAvailable: (available: boolean) => void;
}) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), 400);
    return () => clearTimeout(id);
  }, [value]);

  const localError = value ? validateSubdomain(value) : null;
  const check = useSubdomainCheck(localError === null ? debounced : '');
  const settled = debounced === value && !check.isFetching;
  const available = Boolean(
    localError === null && settled && check.data?.available,
  );

  useEffect(() => {
    onAvailable(available);
  }, [available, onAvailable]);

  let feedback: ReactNode = (
    <span className="text-stone-400">
      Usually your last name — 3 to 30 characters, lowercase letters, numbers,
      and hyphens.
    </span>
  );
  if (value && localError) {
    feedback = <span className="text-red-600">{localError}</span>;
  } else if (value && (!settled || check.isLoading)) {
    feedback = (
      <span className="inline-flex items-center gap-1.5 text-stone-500">
        <Spinner className="h-3.5 w-3.5" /> Checking availability…
      </span>
    );
  } else if (value && check.isError) {
    feedback = (
      <span className="text-red-600">
        Couldn't check availability. Try again in a moment.
      </span>
    );
  } else if (value && check.data) {
    feedback = check.data.available ? (
      <span className="font-medium text-emerald-700">
        {value}.home-basis.com is available ✓
      </span>
    ) : (
      <span className="text-red-600">
        {unavailableMessage(value, check.data.reason)}
      </span>
    );
  }

  return (
    <div>
      <label
        htmlFor="subdomain"
        className="mb-1.5 block text-sm font-medium text-stone-700"
      >
        Your address
      </label>
      <div className="flex items-center">
        <input
          id="subdomain"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="lastname"
          value={value}
          onChange={(event) =>
            onChange(normalizeSubdomainInput(event.target.value))
          }
          className={inputClasses('rounded-r-none font-mono')}
        />
        <span className="rounded-r-lg border border-l-0 border-stone-300 bg-stone-100 px-3 py-2 font-mono text-sm text-stone-500">
          .home-basis.com
        </span>
      </div>
      <p className="mt-2 min-h-5 text-sm" aria-live="polite">
        {feedback}
      </p>
    </div>
  );
}

/**
 * No tenant yet: claim a subdomain, pick a tier, head to Stripe Checkout.
 */
export function ClaimFlow() {
  const [step, setStep] = useState<'subdomain' | 'tier'>('subdomain');
  const [subdomain, setSubdomain] = useState('');
  const [subdomainAvailable, setSubdomainAvailable] = useState(false);
  const [tier, setTier] = useState<Tier | null>(null);
  const invalidate = useInvalidate();

  const claim = useMutation({
    mutationFn: async (input: { subdomain: string; tier: Tier }) => {
      try {
        await createTenant({ subdomain: input.subdomain });
      } catch (error) {
        // Tenant already created on a previous attempt — go straight to
        // checkout for it.
        if (!isApiError(error, 'TENANT_EXISTS')) throw error;
      }
      return createCheckout(input.tier);
    },
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (error) => {
      invalidate.tenant();
      if (
        isApiError(error, 'SUBDOMAIN_TAKEN') ||
        isApiError(error, 'SUBDOMAIN_RESERVED') ||
        isApiError(error, 'SUBDOMAIN_INVALID')
      ) {
        setStep('subdomain');
        setSubdomainAvailable(false);
      }
    },
  });

  return (
    <Card>
      <h1 className="text-xl font-semibold text-stone-900">
        Claim your address
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        Pick the subdomain your household will use from anywhere, choose a
        plan, and connect your box.
      </p>

      {step === 'subdomain' && (
        <div className="mt-6 space-y-5">
          <SubdomainField
            value={subdomain}
            onChange={setSubdomain}
            onAvailable={setSubdomainAvailable}
          />
          <Button
            disabled={!subdomainAvailable}
            onClick={() => setStep('tier')}
          >
            Continue
          </Button>
        </div>
      )}

      {step === 'tier' && (
        <div className="mt-6 space-y-5">
          <div className="flex items-center justify-between rounded-lg bg-stone-50 px-4 py-3">
            <span className="font-mono text-sm text-stone-900">
              <span className="font-semibold text-pine-800">{subdomain}</span>
              .home-basis.com
            </span>
            <button
              type="button"
              onClick={() => setStep('subdomain')}
              className="text-sm font-medium text-pine-700 hover:text-pine-800"
              disabled={claim.isPending}
            >
              Change
            </button>
          </div>

          <TierPicker value={tier} onChange={setTier} disabled={claim.isPending} />

          {claim.isError && (
            <Alert tone="error">
              {isApiError(claim.error)
                ? claim.error.message
                : 'Something went wrong. Try again.'}
            </Alert>
          )}

          <Button
            disabled={!tier}
            busy={claim.isPending}
            onClick={() => {
              if (tier) claim.mutate({ subdomain, tier });
            }}
          >
            Continue to payment
          </Button>
          <p className="text-xs text-stone-500">
            You'll be redirected to Stripe. Billed annually; cancel any time.
          </p>
        </div>
      )}
    </Card>
  );
}

/**
 * Tenant exists but is unpaid (checkout canceled or never finished): let the
 * user pick a tier and resume checkout for the reserved subdomain.
 */
export function CompleteSubscription({
  hostname,
  title = 'Finish setting up',
  description = 'Your address is reserved — complete the subscription to activate it.',
}: {
  hostname: string;
  title?: string;
  description?: string;
}) {
  const [tier, setTier] = useState<Tier | null>(null);

  const checkout = useMutation({
    mutationFn: (selected: Tier) => createCheckout(selected),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  return (
    <Card>
      <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
      <p className="mt-1 text-sm text-stone-500">{description}</p>
      <p className="mt-4 rounded-lg bg-stone-50 px-4 py-3 font-mono text-sm text-stone-900">
        {hostname}
      </p>
      <div className="mt-5 space-y-5">
        <TierPicker
          value={tier}
          onChange={setTier}
          disabled={checkout.isPending}
        />
        {checkout.isError && (
          <Alert tone="error">
            {isApiError(checkout.error)
              ? checkout.error.message
              : 'Something went wrong. Try again.'}
          </Alert>
        )}
        <Button
          disabled={!tier}
          busy={checkout.isPending}
          onClick={() => {
            if (tier) checkout.mutate(tier);
          }}
        >
          Continue to payment
        </Button>
      </div>
    </Card>
  );
}
