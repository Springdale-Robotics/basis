import { Loader2, CheckCircle2, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SetupCompleteProps {
  onComplete: () => void;
  isLoading: boolean;
}

export function SetupComplete({ onComplete, isLoading }: SetupCompleteProps) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
      </div>

      <div className="mb-2 flex items-center justify-center gap-2">
        <PartyPopper className="h-5 w-5 text-yellow-500" />
        <h2 className="text-xl font-semibold">Setup Complete!</h2>
        <PartyPopper className="h-5 w-5 text-yellow-500" />
      </div>

      <p className="mb-6 text-muted-foreground">
        Your Basis is ready to use. Click below to start managing your household.
      </p>

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
