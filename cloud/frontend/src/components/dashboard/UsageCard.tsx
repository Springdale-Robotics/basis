import type { Tenant } from '@/api/types';
import { Card, CardTitle } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatGB } from '@/lib/format';

export function UsageCard({ tenant }: { tenant: Tenant }) {
  const { monthGB, capGB } = tenant.usage;
  const pct = capGB ? Math.min(100, (monthGB / capGB) * 100) : null;
  const nearCap = pct !== null && pct >= 80 && !tenant.throttled;

  const barColor = tenant.throttled
    ? 'bg-red-500'
    : nearCap
      ? 'bg-amber-500'
      : 'bg-pine-600';

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <CardTitle>Transfer this month</CardTitle>
        <p className="text-sm text-stone-600">
          <span className="font-semibold text-stone-900">
            {formatGB(monthGB)}
          </span>{' '}
          {capGB ? `of ${formatGB(capGB)}` : 'used — unlimited*'}
        </p>
      </div>

      {pct !== null ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label="Monthly transfer used"
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-stone-100"
        >
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${Math.max(pct, monthGB > 0 ? 2 : 0)}%` }}
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone-500">
          *2 TB/month fair-use cap — no automatic throttling. We'll reach out
          before doing anything if usage runs consistently far beyond it.
        </p>
      )}

      {tenant.throttled && (
        <p className="mt-3 text-sm font-medium text-red-700">
          You're over this month's cap — transfers throttled to 4 Mbps until
          the month resets. The app stays usable; streaming won't be.
        </p>
      )}
      {nearCap && (
        <p className="mt-3 text-sm font-medium text-amber-700">
          You've used over 80% of this month's transfer.
        </p>
      )}
      {pct !== null && !tenant.throttled && !nearCap && (
        <p className="mt-3 text-xs text-stone-500">
          Counts traffic in and out through your address. Resets on the first
          of the month.
        </p>
      )}
    </Card>
  );
}
