import { useMutation } from '@tanstack/react-query';
import { createPortal } from '@/api/billing';
import { isApiError } from '@/api/client';
import type { Tenant } from '@/api/types';
import { Alert, Badge, Button, Card, CardTitle } from '@/components/ui';
import { formatDate } from '@/lib/format';

const tierLabels: Record<string, string> = {
  basic: 'Basic — $20/year · 250 GB/month',
  streaming: 'Streaming — $36/year · 2 TB/month fair use',
};

export function BillingCard({ tenant }: { tenant: Tenant }) {
  const portal = useMutation({
    mutationFn: createPortal,
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  if (tenant.isComp) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Billing</CardTitle>
          <Badge tone="pine">Beta account</Badge>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          Your Basis Remote subscription is on the house
          {tenant.tier ? ` (${tenant.tier} tier)` : ''} — thanks for helping
          us test. No billing to manage.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Billing</CardTitle>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-stone-500">Plan</dt>
          <dd className="text-right font-medium text-stone-900">
            {tenant.tier ? tierLabels[tenant.tier] : 'No active plan'}
          </dd>
        </div>
        {tenant.currentPeriodEnd && (
          <div className="flex justify-between gap-4">
            <dt className="text-stone-500">
              {tenant.cancelAtPeriodEnd || tenant.status === 'canceled'
                ? 'Ends'
                : 'Renews'}
            </dt>
            <dd className="text-right font-medium text-stone-900">
              {formatDate(tenant.currentPeriodEnd)}
            </dd>
          </div>
        )}
      </dl>

      {tenant.cancelAtPeriodEnd && tenant.status !== 'canceled' && (
        <Alert tone="warning" className="mt-4">
          Your subscription is set to cancel
          {tenant.currentPeriodEnd
            ? ` on ${formatDate(tenant.currentPeriodEnd)}`
            : ' at the end of this period'}
          . After that your subdomain stays reserved for 90 days. You can
          resume from the billing portal.
        </Alert>
      )}

      {portal.isError && (
        <Alert tone="error" className="mt-4">
          {isApiError(portal.error)
            ? portal.error.message
            : 'Could not open the billing portal. Try again.'}
        </Alert>
      )}

      <div className="mt-5">
        <Button
          variant="secondary"
          busy={portal.isPending}
          onClick={() => portal.mutate()}
        >
          Manage billing
        </Button>
        <p className="mt-2 text-xs text-stone-500">
          Update your card, change plans, or cancel — handled by Stripe.
        </p>
      </div>
    </Card>
  );
}
