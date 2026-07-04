import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMultiplier, formatServings } from '@/lib/servings';

interface ServingsStepperProps {
  /** Servings count when the recipe has base servings, otherwise a multiplier. */
  value: number;
  onChange: (n: number) => void;
  /** True when editing whole servings; false when editing the multiplier. */
  editsServings: boolean;
  baseServings: number | null;
  /** Multiplier that will be persisted, used for the "N× recipe" hint. */
  computedMultiplier: number;
  /** Optional leading icon (e.g. a Users glyph). */
  icon?: ReactNode;
  className?: string;
}

export function ServingsStepper({
  value,
  onChange,
  editsServings,
  baseServings,
  computedMultiplier,
  icon,
  className,
}: ServingsStepperProps) {
  // Step by 1 when editing whole servings, by 0.5 when editing the multiplier.
  const step = editsServings ? 1 : 0.5;
  const minValue = editsServings
    ? Math.max(1, Math.round((baseServings ?? 1) * 0.5))
    : 0.5;
  const maxValue = editsServings ? (baseServings ?? 1) * 10 : 10;

  const adjust = (delta: number) => {
    const next = Math.max(
      minValue,
      Math.min(maxValue, Number((value + delta).toFixed(2)))
    );
    onChange(next);
  };

  const scaled = Math.abs(computedMultiplier - 1) > 1e-4;

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        className
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <div className="text-sm font-medium">
            {editsServings ? 'Servings' : 'Servings multiplier'}
          </div>
          {editsServings && scaled && (
            <div className="text-xs text-muted-foreground">
              {formatMultiplier(computedMultiplier)}× recipe
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => adjust(-step)}
          disabled={value <= minValue}
          aria-label="Decrease servings"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-sm font-medium tabular-nums">
          {editsServings ? formatServings(value) : `${value}×`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => adjust(step)}
          disabled={value >= maxValue}
          aria-label="Increase servings"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
