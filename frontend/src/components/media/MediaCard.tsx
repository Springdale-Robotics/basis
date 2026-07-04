import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type MediaAspect = 'square' | 'poster' | 'video';

const aspectClasses: Record<MediaAspect, string> = {
  square: 'aspect-square',
  poster: 'aspect-[2/3]',
  video: 'aspect-video',
};

interface MediaCardProps {
  /** Route to navigate to on click. Rendered as a plain card when omitted. */
  href?: string;
  image?: string | null;
  title: string;
  /** Secondary line under the title (year, artist, meta row, etc.). */
  subtitle?: ReactNode;
  aspect?: MediaAspect;
  /** Icon shown when there is no image. */
  fallbackIcon: LucideIcon;
  /** Center the title/subtitle (used for artists). */
  centered?: boolean;
  /** Extra content rendered over the image (hover play buttons, etc.). */
  overlay?: ReactNode;
}

/**
 * Shared list-page card for movies, TV shows, albums, and artists:
 * a linked Card with an aspect-ratio image (icon fallback) and a
 * title/subtitle footer.
 */
export function MediaCard({
  href,
  image,
  title,
  subtitle,
  aspect = 'square',
  fallbackIcon: FallbackIcon,
  centered = false,
  overlay,
}: MediaCardProps) {
  const card = (
    <Card className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-lg">
      <div className={cn('relative bg-muted', aspectClasses[aspect])}>
        {image ? (
          <img
            src={image}
            alt={title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <FallbackIcon className="h-12 w-12 text-muted-foreground" />
          </div>
        )}
        {overlay}
      </div>
      <CardContent className={cn('p-3', centered && 'text-center')}>
        <h3 className="truncate font-medium">{title}</h3>
        {subtitle && (
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {subtitle}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link to={href}>{card}</Link> : card;
}

interface MediaCardSkeletonProps {
  aspect?: MediaAspect;
  centered?: boolean;
}

export function MediaCardSkeleton({
  aspect = 'square',
  centered = false,
}: MediaCardSkeletonProps) {
  return (
    <Card className="overflow-hidden">
      <Skeleton className={cn('rounded-none', aspectClasses[aspect])} />
      <CardContent className={cn('p-3', centered && 'text-center')}>
        <Skeleton className={cn('h-5 w-3/4', centered && 'mx-auto')} />
        <Skeleton className={cn('mt-2 h-4 w-1/2', centered && 'mx-auto')} />
      </CardContent>
    </Card>
  );
}
