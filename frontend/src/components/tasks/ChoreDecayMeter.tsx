import { cn } from '@/lib/utils';

interface ChoreDecayMeterProps {
  /** Last time this chore was completed; null if never. */
  lastCompletedAt?: string | null;
  /** Cadence in days. Required for the meter to compute urgency. */
  cadenceDays?: number | null;
  /** Optional override "now" for tests. */
  now?: Date;
}

// Computes a 0-1 ratio of how overdue a chore is.
//   0   = just done, green
//   1   = exactly at the due-by point, yellow
//   >1  = overdue, red — clamps at 2x for the bar fill.
function computeOverdueRatio(
  lastCompletedAt: Date | null,
  cadenceDays: number,
  now: Date,
): number {
  if (!lastCompletedAt) return 1.5; // never done = nudge user
  const elapsedMs = now.getTime() - lastCompletedAt.getTime();
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  return elapsedDays / cadenceDays;
}

export function ChoreDecayMeter({
  lastCompletedAt,
  cadenceDays,
  now = new Date(),
}: ChoreDecayMeterProps) {
  if (!cadenceDays) return null;

  const ratio = computeOverdueRatio(
    lastCompletedAt ? new Date(lastCompletedAt) : null,
    cadenceDays,
    now,
  );

  // Bar fill: clamp 0..1.5 -> 0..100%.
  const fillPct = Math.min(100, Math.max(0, (ratio / 1.5) * 100));

  // Color thresholds:
  //   ratio < 0.7   -> green
  //   0.7..1.0      -> yellow
  //   >1.0          -> red
  const color =
    ratio < 0.7
      ? 'bg-success'
      : ratio < 1.0
      ? 'bg-warning'
      : 'bg-destructive';

  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
      aria-label="chore urgency"
    >
      <div
        className={cn('h-full transition-all', color)}
        style={{ width: `${fillPct}%` }}
      />
    </div>
  );
}
