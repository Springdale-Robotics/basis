import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  /** e.g. "Couldn't load recipes" */
  title: string;
  /** The query error; its message is shown as the description. */
  error?: unknown;
  /** Overrides the message derived from `error`. */
  description?: string;
  /** Usually the query's refetch function. */
  onRetry?: () => void;
  /** Small inline layout for dashboard cards and other tight spots. */
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title,
  error,
  description,
  onRetry,
  compact = false,
  className,
}: ErrorStateProps) {
  const message = description ?? (error !== undefined ? getErrorMessage(error) : undefined);

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 py-3 text-sm text-muted-foreground',
          className
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="min-w-0 truncate" title={message}>
          {title}
        </span>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 shrink-0 px-2"
            onClick={() => onRetry()}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className
      )}
    >
      <div className="mb-4 text-destructive/70">
        <AlertTriangle className="h-12 w-12" />
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      {message && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{message}</p>
      )}
      {onRetry && (
        <div className="mt-4">
          <Button variant="outline" onClick={() => onRetry()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
