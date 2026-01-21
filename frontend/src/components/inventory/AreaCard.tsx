import { useState } from 'react';
import { ChevronDown, ChevronUp, Settings, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { StorageArea, InventoryItem } from '@/types/models';

interface AreaCardProps {
  area: StorageArea;
  items: InventoryItem[];
  onEdit: () => void;
  onItemClick: (item: InventoryItem) => void;
  onAddItem: () => void;
}

export function AreaCard({
  area,
  items,
  onEdit,
  onItemClick,
  onAddItem,
}: AreaCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const lowStockItems = items.filter((item) => {
    if (item.keepInStockThreshold) {
      const totalQuantity = item.stockEntries?.reduce(
        (sum, entry) => sum + entry.quantity,
        0
      ) || 0;
      return totalQuantity < item.keepInStockThreshold;
    }
    return false;
  });

  const expiringItems = items.filter((item) => {
    const expiringEntry = item.stockEntries?.find((entry) => {
      if (!entry.expiresAt) return false;
      const daysUntilExpiry = Math.ceil(
        (new Date(entry.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      return daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
    });
    return !!expiringEntry;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{area.icon || '📦'}</div>
            <div>
              <CardTitle className="text-lg">{area.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lowStockItems.length > 0 && (
              <Badge variant="destructive">{lowStockItems.length} low</Badge>
            )}
            {expiringItems.length > 0 && (
              <Badge variant="outline" className="border-orange-500 text-orange-500">
                {expiringItems.length} expiring
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={onEdit}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No items in this area</p>
              <Button variant="link" onClick={onAddItem}>
                Add an item
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} onClick={() => onItemClick(item)} />
              ))}
              <Button
                variant="ghost"
                className="w-full justify-start text-muted-foreground"
                onClick={onAddItem}
              >
                + Add item
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface ItemRowProps {
  item: InventoryItem;
  onClick: () => void;
}

function ItemRow({ item, onClick }: ItemRowProps) {
  const totalQuantity = item.stockEntries?.reduce(
    (sum, entry) => sum + entry.quantity,
    0
  ) || 0;

  const isLowStock =
    item.keepInStockThreshold && totalQuantity < item.keepInStockThreshold;

  const nearestExpiry = item.stockEntries
    ?.filter((e) => e.expiresAt)
    .sort(
      (a, b) =>
        new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime()
    )[0];

  const daysUntilExpiry = nearestExpiry
    ? Math.ceil(
        (new Date(nearestExpiry.expiresAt!).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 7;

  return (
    <div
      className={cn(
        'flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-muted transition-colors',
        isLowStock && 'border-l-2 border-l-destructive',
        isExpiringSoon && !isLowStock && 'border-l-2 border-l-orange-500'
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span>{item.icon || '📦'}</span>
        <div>
          <p className="font-medium">{item.name}</p>
          {item.category && (
            <p className="text-xs text-muted-foreground">{item.category}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isExpiringSoon && daysUntilExpiry !== null && (
          <Badge variant="outline" className="border-orange-500 text-orange-500">
            {daysUntilExpiry === 0
              ? 'Today'
              : daysUntilExpiry === 1
              ? '1 day'
              : `${daysUntilExpiry} days`}
          </Badge>
        )}
        <span
          className={cn(
            'font-medium',
            isLowStock && 'text-destructive',
            totalQuantity === 0 && 'text-muted-foreground'
          )}
        >
          {totalQuantity} {item.unit || 'x'}
        </span>
      </div>
    </div>
  );
}
