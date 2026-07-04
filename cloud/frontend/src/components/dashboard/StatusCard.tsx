import type { Tenant } from '@/api/types';
import { Badge, Card, type BadgeTone } from '@/components/ui';
import { formatRelative } from '@/lib/format';

function statusBadge(tenant: Tenant): { label: string; tone: BadgeTone } {
  switch (tenant.status) {
    case 'active':
      return tenant.connected
        ? { label: 'Connected', tone: 'green' }
        : { label: 'Offline', tone: 'gray' };
    case 'past_due':
      return { label: 'Past due', tone: 'amber' };
    case 'suspended':
      return { label: 'Suspended', tone: 'red' };
    case 'canceled':
      return { label: 'Canceled', tone: 'gray' };
    case 'unpaid':
      return { label: 'Awaiting payment', tone: 'amber' };
  }
}

export function StatusCard({ tenant }: { tenant: Tenant }) {
  const badge = statusBadge(tenant);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-lg text-stone-900">
            <span className="font-semibold text-pine-800">
              {tenant.subdomain}
            </span>
            .home-basis.com
          </p>
          <p className="mt-1 text-sm text-stone-500">
            {tenant.lastHeartbeatAt
              ? `Last heartbeat ${formatRelative(tenant.lastHeartbeatAt)}`
              : 'Your box has never connected.'}
          </p>
        </div>
        <Badge tone={badge.tone} className="px-3 py-1 text-sm">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-current"
          />
          {badge.label}
        </Badge>
      </div>

      {tenant.status === 'past_due' && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your last payment failed. The tunnel keeps working during a short
          grace period — update your card in billing to keep your address.
        </p>
      )}
      {tenant.status === 'suspended' && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">
          Your address is suspended because the subscription lapsed. Fix
          billing to bring it back — your box and data are unaffected.
        </p>
      )}
      {tenant.status === 'canceled' && (
        <p className="mt-4 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-700">
          Your subscription has ended. The subdomain stays reserved for you
          for 90 days. Basis itself keeps working on your LAN or over
          Tailscale.
        </p>
      )}
      {tenant.status === 'active' &&
        !tenant.connected &&
        tenant.lastConnectedAt && (
          <p className="mt-4 text-sm text-stone-500">
            Last connected {formatRelative(tenant.lastConnectedAt)}. If your
            box is on, check Settings → Remote Access in Basis.
          </p>
        )}
    </Card>
  );
}
