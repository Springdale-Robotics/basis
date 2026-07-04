import type { Tier } from '@/api/types';
import { cn } from '@/lib/cn';

const tiers: Array<{
  id: Tier;
  name: string;
  price: string;
  cap: string;
  note: string;
}> = [
  {
    id: 'basic',
    name: 'Basic',
    price: '$20/year',
    cap: '250 GB/month transfer',
    note: 'Calendars, recipes, photos on the go. Over the cap, transfers slow to 4 Mbps — the app stays usable.',
  },
  {
    id: 'streaming',
    name: 'Streaming',
    price: '$36/year',
    cap: '2 TB/month (fair use)',
    note: 'Everything in Basic, plus enough headroom to stream your movie and music libraries remotely.',
  },
];

export function TierPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Tier | null;
  onChange: (tier: Tier) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2">
      {tiers.map((tier) => {
        const selected = value === tier.id;
        return (
          <button
            key={tier.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(tier.id)}
            className={cn(
              'rounded-xl border p-4 text-left transition-colors disabled:opacity-60',
              selected
                ? 'border-pine-700 bg-pine-50 ring-1 ring-pine-700'
                : 'border-stone-200 bg-white hover:border-stone-300',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-stone-900">{tier.name}</span>
              <span className="text-sm font-medium text-stone-700">
                {tier.price}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-pine-800">{tier.cap}</p>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">
              {tier.note}
            </p>
          </button>
        );
      })}
    </div>
  );
}
