import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BillingCard } from '@/components/dashboard/BillingCard';
import { ClaimFlow, CompleteSubscription } from '@/components/dashboard/ClaimFlow';
import { ConnectPanel } from '@/components/dashboard/ConnectPanel';
import { DangerZone } from '@/components/dashboard/DangerZone';
import { StatusCard } from '@/components/dashboard/StatusCard';
import { UsageCard } from '@/components/dashboard/UsageCard';
import { Alert, Button, Spinner } from '@/components/ui';
import { useInvalidate, useTenant } from '@/hooks/queries';

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const checkout = searchParams.get('checkout'); // 'success' | 'canceled' | null
  const invalidate = useInvalidate();
  const invalidatedOnReturn = useRef(false);

  // Returning from Stripe: refetch the tenant so status flips as soon as the
  // webhook lands (and keep polling while it hasn't — see useTenant).
  useEffect(() => {
    if (checkout && !invalidatedOnReturn.current) {
      invalidatedOnReturn.current = true;
      invalidate.tenant();
    }
  }, [checkout, invalidate]);

  const tenantQuery = useTenant({ pollWhileUnpaid: checkout === 'success' });

  const dismissCheckoutBanner = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    setSearchParams(next, { replace: true });
  };

  if (tenantQuery.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-pine-700" />
      </div>
    );
  }

  if (tenantQuery.isError) {
    return (
      <Alert tone="error">
        Couldn't load your account.{' '}
        <Button
          variant="ghost"
          className="ml-2 px-2 py-1"
          onClick={() => tenantQuery.refetch()}
        >
          Retry
        </Button>
      </Alert>
    );
  }

  const tenant = tenantQuery.data ?? null;

  const banner =
    checkout === 'success' ? (
      <Alert tone="success" onDismiss={dismissCheckoutBanner}>
        Payment received — thanks!
        {tenant?.status === 'unpaid'
          ? ' Activating your address… this usually takes a few seconds.'
          : ' Your address is active.'}
      </Alert>
    ) : checkout === 'canceled' ? (
      <Alert tone="warning" onDismiss={dismissCheckoutBanner}>
        Checkout canceled — nothing was charged. Your address is reserved, so
        you can finish any time.
      </Alert>
    ) : null;

  return (
    <div className="space-y-4">
      {banner}

      {tenant === null ? (
        <ClaimFlow />
      ) : tenant.status === 'unpaid' ? (
        <CompleteSubscription hostname={tenant.hostname} />
      ) : tenant.status === 'canceled' ? (
        <>
          <StatusCard tenant={tenant} />
          <CompleteSubscription
            hostname={tenant.hostname}
            title="Reactivate your address"
            description="Pick a plan to bring your address back — your box reconnects with a fresh claim code."
          />
          <BillingCard tenant={tenant} />
          <DangerZone />
        </>
      ) : (
        <>
          <StatusCard tenant={tenant} />
          <UsageCard tenant={tenant} />
          {(tenant.status === 'active' || tenant.status === 'past_due') && (
            <ConnectPanel connected={tenant.connected} />
          )}
          <BillingCard tenant={tenant} />
          <DangerZone />
        </>
      )}
    </div>
  );
}
