import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ShoppingBag, Package } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { PutAwayDialog } from '@/components/inventory/PutAwayDialog';
import { AddToListDialog } from '@/components/inventory/AddToListDialog';
import { inventoryApi } from '@/api/inventory';
import { cn } from '@/lib/utils';

export function ShoppingListPage() {
  const queryClient = useQueryClient();
  const [putAwayDialogOpen, setPutAwayDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ['shopping-list'],
    queryFn: inventoryApi.getShoppingList,
  });

  const { data: inventoryData } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: inventoryApi.getItems,
  });

  const { data: areasData } = useQuery({
    queryKey: ['inventory-areas'],
    queryFn: inventoryApi.getAreas,
  });

  const toggleItemMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.checkShoppingListItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: inventoryApi.deleteShoppingListItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });

  const clearCheckedMutation = useMutation({
    mutationFn: inventoryApi.clearCheckedItems,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });

  const handlePutAway = async (data: {
    shoppingListItemId: string;
    areaId: string;
    quantity: number;
    expiryDate?: string;
  }) => {
    await inventoryApi.moveToInventory(data.shoppingListItemId, {
      areaId: data.areaId,
      quantity: data.quantity,
      expiryDate: data.expiryDate,
    });
    queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const handleSkipItem = (id: string) => {
    // Just delete it from the shopping list
    deleteItemMutation.mutate(id);
  };

  const shoppingList = items?.shoppingList || [];
  const checkedCount = shoppingList.filter((item) => item.checked).length;
  const uncheckedCount = shoppingList.filter((item) => !item.checked).length;

  // Group items by category
  const groupedItems = shoppingList.reduce((acc, item) => {
    const category = item.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, typeof shoppingList>);

  const inventoryItems = inventoryData?.items || [];
  const areas = areasData?.areas || [];
  const checkedItems = shoppingList.filter((item) => item.checked);

  return (
    <div>
      <PageHeader
        title="Shopping List"
        description={`${uncheckedCount} items to buy, ${checkedCount} checked off`}
        actions={
          <div className="flex gap-2">
            {checkedCount > 0 && (
              <>
                <Button variant="outline" onClick={() => clearCheckedMutation.mutate()}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Checked
                </Button>
                <Button onClick={() => setPutAwayDialogOpen(true)}>
                  <Package className="mr-2 h-4 w-4" />
                  Put Away Groceries
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Add item button */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <Button
            variant="outline"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add item from catalog...
          </Button>
        </CardContent>
      </Card>

      {/* Shopping list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : !shoppingList.length ? (
        <EmptyState
          icon={<ShoppingBag className="h-12 w-12" />}
          title="Your shopping list is empty"
          description="Add items manually or generate a list from your meal plan"
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedItems || {}).map(([category, categoryItems]) => (
            <div key={category}>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                {category}
              </h3>
              <div className="space-y-2">
                {categoryItems?.map((item) => (
                  <Card
                    key={item.id}
                    className={cn(item.checked && 'opacity-60')}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <Checkbox
                        checked={item.checked}
                        onCheckedChange={() => toggleItemMutation.mutate(item.id)}
                      />
                      <div className="flex-1">
                        <p
                          className={cn(
                            'font-medium',
                            item.checked && 'line-through'
                          )}
                        >
                          {item.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} {item.unit}
                        </p>
                      </div>
                      <Badge
                        variant={
                          item.source === 'meal_plan'
                            ? 'default'
                            : item.source === 'low_stock'
                            ? 'secondary'
                            : 'outline'
                        }
                        className="text-xs"
                      >
                        {item.source.replace('_', ' ')}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteItemMutation.mutate(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Put Away Dialog */}
      <PutAwayDialog
        open={putAwayDialogOpen}
        onOpenChange={setPutAwayDialogOpen}
        checkedItems={checkedItems}
        inventoryItems={inventoryItems}
        areas={areas}
        onPutAway={handlePutAway}
        onSkip={handleSkipItem}
      />

      {/* Add to List Dialog */}
      <AddToListDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        inventoryItems={inventoryItems}
        areas={areas}
      />
    </div>
  );
}
