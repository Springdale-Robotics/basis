import { Check, MoreVertical, Trash2, Edit, UtensilsCrossed, Store, ChefHat, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Leftover, LeftoverSource } from '@/types/models';

interface LeftoverCardProps {
  leftover: Leftover;
  onFinish: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const sourceIcons: Record<LeftoverSource, React.ReactNode> = {
  recipe: <UtensilsCrossed className="h-3 w-3" />,
  restaurant: <Store className="h-3 w-3" />,
  homemade: <ChefHat className="h-3 w-3" />,
  other: <HelpCircle className="h-3 w-3" />,
};

const sourceLabels: Record<LeftoverSource, string> = {
  recipe: 'Recipe',
  restaurant: 'Restaurant',
  homemade: 'Homemade',
  other: 'Other',
};

function getDaysOld(preparedAt: string): number {
  const prepared = new Date(preparedAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  prepared.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - prepared.getTime()) / (1000 * 60 * 60 * 24));
}

function getDaysUntilExpiry(expiryDate: string): number {
  // Parse as local date to avoid timezone issues
  const [year, month, day] = expiryDate.split('T')[0].split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getExpiryBadgeVariant(days: number): 'destructive' | 'secondary' | 'outline' {
  if (days <= 0) return 'destructive';
  if (days <= 2) return 'destructive';
  return 'secondary';
}

export function LeftoverCard({
  leftover,
  onFinish,
  onEdit,
  onDelete,
}: LeftoverCardProps) {
  const daysOld = getDaysOld(leftover.preparedAt);
  const daysUntilExpiry = getDaysUntilExpiry(leftover.expiryDate);
  const isExpired = daysUntilExpiry <= 0;
  const isUrgent = daysUntilExpiry <= 2 && !isExpired;
  const portions = typeof leftover.portions === 'string' ? parseFloat(leftover.portions) : leftover.portions;

  const ageLabel = daysOld === 0 ? 'Made today' : daysOld === 1 ? 'Made yesterday' : `${daysOld} days old`;
  const expiryLabel = isExpired
    ? `Expired ${Math.abs(daysUntilExpiry)} day${Math.abs(daysUntilExpiry) !== 1 ? 's' : ''} ago`
    : daysUntilExpiry === 0
    ? 'Expires today'
    : daysUntilExpiry === 1
    ? 'Expires tomorrow'
    : `Expires in ${daysUntilExpiry} days`;

  const sourceName = leftover.source === 'recipe' && leftover.sourceRecipe
    ? leftover.sourceRecipe.title
    : leftover.source === 'restaurant' && leftover.restaurantName
    ? leftover.restaurantName
    : sourceLabels[leftover.source];

  return (
    <Card
      className={cn(
        'transition-colors',
        isExpired && 'border-destructive bg-destructive/5',
        isUrgent && !isExpired && 'border-amber-400 bg-amber-50 dark:bg-amber-950/20'
      )}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{leftover.name}</p>
            {portions > 1 && (
              <Badge variant="outline" className="text-xs shrink-0">
                {portions} portions
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
            <Badge variant="secondary" className="text-xs gap-1">
              {sourceIcons[leftover.source]}
              {sourceName}
            </Badge>
            <span className="text-xs">{ageLabel}</span>
            {leftover.area && (
              <>
                <span className="text-xs">in</span>
                <span className="text-xs">{leftover.area.icon} {leftover.area.name}</span>
              </>
            )}
          </div>
          {leftover.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {leftover.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={getExpiryBadgeVariant(daysUntilExpiry)} className="whitespace-nowrap">
            {expiryLabel}
          </Badge>
          <Button
            variant={isExpired || isUrgent ? 'default' : 'outline'}
            size="sm"
            onClick={onFinish}
            className={cn(
              isExpired && 'bg-destructive hover:bg-destructive/90',
              isUrgent && !isExpired && 'bg-amber-500 hover:bg-amber-600 text-white'
            )}
          >
            <Check className="h-4 w-4 mr-1" />
            Finish
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
