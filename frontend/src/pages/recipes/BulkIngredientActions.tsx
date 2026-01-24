import { Check, Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { IngredientMatch } from '@/api/recipes';

interface BulkIngredientActionsProps {
  matches: IngredientMatch[];
  onAutoAccept: () => void;
  onCreateAll: () => Promise<void>;
  onSkipAll: () => void;
  isCreating?: boolean;
}

export function BulkIngredientActions({
  matches,
  onAutoAccept,
  onCreateAll,
  onSkipAll,
  isCreating = false,
}: BulkIngredientActionsProps) {
  // Calculate counts
  const totalMatches = matches.length;
  const linkedCount = matches.filter(m => m.matchedItemId).length;
  const unmatchedCount = totalMatches - linkedCount;

  // Count high confidence matches that aren't already linked
  const highConfidenceUnlinked = matches.filter(m => {
    if (m.matchedItemId) return false;
    if (!m.suggestions || m.suggestions.length === 0) return false;
    return m.suggestions[0].confidence >= 0.9;
  }).length;

  // Don't show if all are linked or no matches
  if (totalMatches === 0 || linkedCount === totalMatches) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/50 rounded-lg">
      <span className="text-sm text-muted-foreground mr-2">Quick actions:</span>

      {highConfidenceUnlinked > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={onAutoAccept}
        >
          <Check className="mr-1 h-3 w-3" />
          Auto-accept high confidence
          <Badge variant="secondary" className="ml-2 text-xs">
            {highConfidenceUnlinked}
          </Badge>
        </Button>
      )}

      {unmatchedCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCreateAll()}
          disabled={isCreating}
        >
          {isCreating ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3 w-3" />
          )}
          Create all unmatched as items
          <Badge variant="secondary" className="ml-2 text-xs">
            {unmatchedCount}
          </Badge>
        </Button>
      )}

      {unmatchedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkipAll}
        >
          <X className="mr-1 h-3 w-3" />
          Skip unmatched
        </Button>
      )}
    </div>
  );
}
