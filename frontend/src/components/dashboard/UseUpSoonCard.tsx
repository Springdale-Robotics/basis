import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { inventoryApi } from '@/api/inventory';
import { formatDate } from '@/lib/utils';

export function UseUpSoonCard() {
  const { data: expiringItems, isLoading } = useQuery({
    queryKey: ['inventory', 'expiring'],
    queryFn: () => inventoryApi.getExpiringItems(7),
  });

  return (
    <Card className="bg-warning-muted/30 border-warning/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-semibold">Use Up Soon</CardTitle>
        <Sparkles className="h-5 w-5 text-warning" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : !expiringItems?.expiring?.length ? (
          <p className="text-sm text-muted-foreground">Fridge looks happy — nothing to use up</p>
        ) : (
          <div className="space-y-2">
            {expiringItems.expiring.slice(0, 4).map((stockEntry) => (
              <div
                key={stockEntry.id}
                className="flex items-center justify-between rounded-lg bg-background/70 px-3 py-2"
              >
                <span className="text-sm font-medium truncate">
                  {stockEntry.item?.name || 'Unknown'}
                </span>
                <Badge variant="warning" className="text-xs shrink-0">
                  {stockEntry.expiryDate
                    ? formatDate(stockEntry.expiryDate, { month: 'short', day: 'numeric' })
                    : 'Soon'}
                </Badge>
              </div>
            ))}
            {expiringItems.expiring.length > 4 && (
              <Link to="/inventory" className="text-xs text-primary hover:underline">
                +{expiringItems.expiring.length - 4} more
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
