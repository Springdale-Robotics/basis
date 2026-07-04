import { useMutation } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { createClaimCode } from '@/api/tenants';
import type { ClaimCode } from '@/api/types';
import { Alert, Button, Card, CardTitle, CopyButton } from '@/components/ui';
import { useCountdown } from '@/hooks/useCountdown';
import { formatCountdown } from '@/lib/format';

const steps = [
  'Open Basis on any device at home.',
  'Go to Settings → Remote Access.',
  'Choose "Basis Remote" as the mode.',
  'Paste the code. Your box connects on its own.',
];

export function ConnectPanel({ connected }: { connected: boolean }) {
  const generate = useMutation({
    mutationFn: createClaimCode,
  });

  const claim: ClaimCode | undefined = generate.data;
  const secondsLeft = useCountdown(claim?.expiresAt ?? null);
  const expired = secondsLeft !== null && secondsLeft <= 0;

  return (
    <Card>
      <CardTitle>Connect your box</CardTitle>
      <p className="mt-1 text-sm text-stone-500">
        {connected
          ? 'Your box is connected. Generate a new code only to link a different box — it replaces the old link.'
          : 'Generate a one-time code and paste it into Basis on your home box.'}
      </p>

      {claim && !expired ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pine-200 bg-pine-50 px-5 py-4">
            <span
              className="font-mono text-2xl font-semibold tracking-widest text-pine-950 sm:text-3xl"
              data-testid="claim-code"
            >
              {claim.code}
            </span>
            <CopyButton
              text={claim.code}
              label="Copy code"
              className="border border-pine-200 bg-white px-3 py-1.5"
            />
          </div>
          <p className="mt-2 text-sm text-stone-500" aria-live="polite">
            Expires in{' '}
            <span className="font-mono font-medium text-stone-900">
              {formatCountdown(secondsLeft ?? 0)}
            </span>
            . One use only — generating a new code voids this one.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          {expired && (
            <Alert tone="warning" className="mb-4">
              That code expired. Generate a fresh one.
            </Alert>
          )}
          {generate.isError && (
            <Alert tone="error" className="mb-4">
              {isApiError(generate.error, 'SUBSCRIPTION_REQUIRED')
                ? 'Claim codes need an active subscription. Finish setting up billing first.'
                : isApiError(generate.error)
                  ? generate.error.message
                  : 'Something went wrong. Try again.'}
            </Alert>
          )}
          <Button
            busy={generate.isPending}
            onClick={() => generate.mutate()}
            variant={connected ? 'secondary' : 'primary'}
          >
            {expired || claim ? 'Generate a new code' : 'Generate claim code'}
          </Button>
        </div>
      )}

      <ol className="mt-6 space-y-2 border-t border-stone-100 pt-5">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-stone-600">
            <span
              aria-hidden="true"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-stone-100 font-mono text-[11px] font-medium text-stone-600"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </Card>
  );
}
