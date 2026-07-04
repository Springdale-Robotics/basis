import { Loader2, CheckCircle2, PartyPopper, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SetupCompleteProps {
  onComplete: () => void;
  isLoading: boolean;
  /** When Basis Remote was chosen, point at Settings to finish the claim. */
  basisRemoteChosen?: boolean;
}

export function SetupComplete({ onComplete, isLoading, basisRemoteChosen }: SetupCompleteProps) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-muted">
        <CheckCircle2 className="h-8 w-8 text-success" />
      </div>

      <div className="mb-2 flex items-center justify-center gap-2">
        <PartyPopper className="h-5 w-5 text-yellow-500" />
        <h2 className="text-xl font-semibold">Setup Complete!</h2>
        <PartyPopper className="h-5 w-5 text-yellow-500" />
      </div>

      <p className="mb-6 text-muted-foreground">
        Your Basis is ready to use. Click below to start managing your household.
      </p>

      {basisRemoteChosen && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-left">
          <Zap className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">One more step for Basis Remote:</span>{' '}
            after logging in, enter your claim code in{' '}
            <span className="font-medium text-foreground">Settings → Remote Access</span> to
            connect this server to your home-basis.com address.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <Button onClick={onComplete} className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Go to Login
        </Button>
      </div>

      <div className="mt-6 rounded-lg bg-muted/50 p-4 text-left">
        <h3 className="font-medium">What's next?</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>- Add family members to your household</li>
          <li>- Set up your calendars and events</li>
          <li>- Import your favorite recipes</li>
          <li>- Organize your inventory</li>
          <li>- Create task lists and chores</li>
        </ul>
      </div>
    </div>
  );
}
