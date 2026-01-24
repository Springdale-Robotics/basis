import { cn } from '@/lib/utils';
import type { StorageUsage } from '@/api/files';

interface StorageIndicatorProps {
  storage: StorageUsage;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getProgressColor(percent: number): string {
  if (percent >= 95) return 'bg-red-500';
  if (percent >= 80) return 'bg-yellow-500';
  return 'bg-primary';
}

export function StorageIndicator({ storage, className }: StorageIndicatorProps) {
  const { usedBytes, effectiveLimit, percentUsed } = storage;
  const hasLimit = effectiveLimit > 0;
  const cappedPercent = Math.min(percentUsed, 100);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Mini progress bar */}
      <div className="relative h-2 w-24 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            'h-full transition-all',
            getProgressColor(percentUsed)
          )}
          style={{ width: `${hasLimit ? cappedPercent : 0}%` }}
        />
      </div>

      {/* Text label */}
      <span className="text-sm text-muted-foreground">
        {formatBytes(usedBytes)}
        {hasLimit ? (
          <>
            {' / '}
            {formatBytes(effectiveLimit)}
            {' '}
            <span className={cn(
              percentUsed >= 95 ? 'text-red-500' :
              percentUsed >= 80 ? 'text-yellow-500' : ''
            )}>
              ({Math.round(percentUsed)}%)
            </span>
          </>
        ) : (
          ' used'
        )}
      </span>
    </div>
  );
}
