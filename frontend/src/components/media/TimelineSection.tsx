import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TimelineSectionProps {
  /** ISO date string for the group (formatted as a long date header). */
  date: string;
  count: number;
  /** Grid column classes; the section supplies `grid gap-2` itself. */
  gridClassName?: string;
  children: ReactNode;
}

/**
 * A dated section in the photos/videos timeline views: long-form date
 * header with a count badge above a thumbnail grid.
 */
export function TimelineSection({
  date,
  count,
  gridClassName,
  children,
}: TimelineSectionProps) {
  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-lg font-semibold">{formattedDate}</h3>
        <Badge variant="secondary">{count}</Badge>
      </div>
      <div className={cn('grid gap-2', gridClassName)}>{children}</div>
    </div>
  );
}
