import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';

/** Rendered inside the AppShell for authenticated unknown routes. */
export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="h-12 w-12" />}
      title="Page not found"
      description="The page you're looking for doesn't exist or may have moved."
      action={
        <Button asChild>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Button>
      }
      className="py-24"
    />
  );
}
