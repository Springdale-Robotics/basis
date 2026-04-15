import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export type ConfidenceBand = 'high' | 'medium' | 'low' | null;

interface ConfidenceBadgeProps {
  band: ConfidenceBand;
  score?: number;
  className?: string;
  showLabel?: boolean;
}

const BAND_CONFIG = {
  high: {
    color: 'bg-green-500',
    label: 'In stock',
    tooltip: 'High confidence — recently verified or purchased',
  },
  medium: {
    color: 'bg-yellow-500',
    label: 'Check stock',
    tooltip: 'Medium confidence — consider verifying your supply',
  },
  low: {
    color: 'bg-red-500',
    label: 'Low confidence',
    tooltip: 'Low confidence — stock data may be outdated',
  },
} as const;

export function ConfidenceBadge({ band, score, className, showLabel = false }: ConfidenceBadgeProps) {
  if (!band) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('inline-flex items-center gap-1.5', className)}>
              <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
              {showLabel && <span className="text-xs text-muted-foreground">Unknown</span>}
            </span>
          </TooltipTrigger>
          <TooltipContent>No inventory data</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const config = BAND_CONFIG[band];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1.5', className)}>
            <span className={cn('h-2 w-2 rounded-full', config.color)} />
            {showLabel && <span className="text-xs text-muted-foreground">{config.label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {config.tooltip}
          {score != null && ` (${score}%)`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
