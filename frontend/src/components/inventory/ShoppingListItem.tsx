import { Check, MoreVertical } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ShoppingListItem as ShoppingListItemType } from '@/types/models';

interface ShoppingListItemProps {
  item: ShoppingListItemType;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveToInventory: () => void;
}

export function ShoppingListItem({
  item,
  onToggle,
  onEdit,
  onDelete,
  onMoveToInventory,
}: ShoppingListItemProps) {
  const sourceLabel = {
    manual: 'Manual',
    meal_plan: 'Meal Plan',
    low_stock: 'Low Stock',
    recipe: 'Recipe',
  } as const;

  // Multiple distinct sources have contributed to this row's quantity — show
  // a "Mixed" badge listing them so a manual entry doesn't disguise a
  // meal-plan contribution.
  const sources = item.sources ?? [item.source];
  const uniqueSources = Array.from(new Set(sources));
  const isMixed = uniqueSources.length > 1;
  const mixedTooltip = uniqueSources
    .map((s) => sourceLabel[s] ?? s)
    .join(' + ');

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-colors',
        item.checked && 'bg-muted/50'
      )}
    >
      <Checkbox
        checked={item.checked}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'font-medium',
            item.checked && 'line-through text-muted-foreground'
          )}
        >
          {item.name}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-muted-foreground">
            {item.quantity} {item.unit || 'x'}
          </span>
          {item.category && (
            <Badge variant="outline" className="text-xs">
              {item.category}
            </Badge>
          )}
          <Badge
            variant="secondary"
            title={isMixed ? mixedTooltip : undefined}
            className={cn(
              'text-xs',
              !isMixed && item.source === 'low_stock' && 'bg-warning-muted text-warning-muted-foreground',
              !isMixed && item.source === 'meal_plan' && 'bg-info-muted text-info-muted-foreground',
              isMixed && 'bg-primary/15 text-primary'
            )}
          >
            {isMixed ? `Mixed (${mixedTooltip})` : sourceLabel[item.source] || 'Manual'}
          </Badge>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
          {item.checked && (
            <DropdownMenuItem onClick={onMoveToInventory}>
              Move to Inventory
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface ShoppingListSectionProps {
  title: string;
  items: ShoppingListItemType[];
  onToggle: (id: string) => void;
  onEdit: (item: ShoppingListItemType) => void;
  onDelete: (id: string) => void;
  onMoveToInventory: (item: ShoppingListItemType) => void;
}

export function ShoppingListSection({
  title,
  items,
  onToggle,
  onEdit,
  onDelete,
  onMoveToInventory,
}: ShoppingListSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground px-1">{title}</h3>
      <div className="space-y-2">
        {items.map((item) => (
          <ShoppingListItem
            key={item.id}
            item={item}
            onToggle={() => onToggle(item.id)}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item.id)}
            onMoveToInventory={() => onMoveToInventory(item)}
          />
        ))}
      </div>
    </div>
  );
}
