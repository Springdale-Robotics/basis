import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  prefix?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  prefix,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 pb-4 md:flex-row md:items-center md:justify-between',
        className
      )}
    >
      <div className="flex items-center gap-3">
        {prefix}
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
