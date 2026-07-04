import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** 'sm' is a compact variant for popovers, cards, and other tight spots. */
  size?: 'sm' | 'default';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'default',
  className,
}: EmptyStateProps) {
  const compact = size === 'sm';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6' : 'py-12',
        className
      )}
    >
      {icon && (
        <div className={cn('text-muted-foreground/50', compact ? 'mb-2' : 'mb-4')}>
          {icon}
        </div>
      )}
      <h3 className={cn('font-medium', compact ? 'text-sm' : 'text-lg')}>{title}</h3>
      {description && (
        <p
          className={cn(
            'text-muted-foreground max-w-sm',
            compact ? 'mt-0.5 text-xs' : 'mt-1 text-sm'
          )}
        >
          {description}
        </p>
      )}
      {action && <div className={compact ? 'mt-3' : 'mt-4'}>{action}</div>}
    </div>
  );
}
