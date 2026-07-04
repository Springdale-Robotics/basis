import { cn, formatFileSize } from '@/lib/utils';
import { getStorageMeterClass, getStorageMeterTextClass } from '@/lib/storage';
import type { StorageUsage } from '@/api/files';

interface StorageIndicatorProps {
  storage: StorageUsage;
  className?: string;
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
            getStorageMeterClass(percentUsed)
          )}
          style={{ width: `${hasLimit ? cappedPercent : 0}%` }}
        />
      </div>

      {/* Text label */}
      <span className="text-sm text-muted-foreground">
        {formatFileSize(usedBytes)}
        {hasLimit ? (
          <>
            {' / '}
            {formatFileSize(effectiveLimit)}
            {' '}
            <span className={cn(getStorageMeterTextClass(percentUsed))}>
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
