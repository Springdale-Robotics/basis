import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Package, AlertTriangle, RefreshCcw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { SearchInput } from '@/components/shared/SearchInput';
import { AreaForm } from '@/components/inventory/AreaForm';
import { ItemForm } from '@/components/inventory/ItemForm';
import { inventoryApi } from '@/api/inventory';
import { formatDate } from '@/lib/utils';
import type { StorageAreaFormData, InventoryItemFormData } from '@/types/forms';

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | undefined>();
  const [areaFormOpen, setAreaFormOpen] = useState(false);
  const [itemFormOpen, setItemFormOpen] = useState(false);

  const { data: areas, isLoading: areasLoading } = useQuery({
    queryKey: ['inventory', 'areas'],
    queryFn: inventoryApi.getAreas,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['inventory', 'items', search, selectedArea],
    queryFn: () =>
      inventoryApi.getItems({ search: search || undefined, areaId: selectedArea }),
  });

  const { data: expiringItems } = useQuery({
    queryKey: ['inventory', 'expiring'],
    queryFn: () => inventoryApi.getExpiringItems(7),
  });

  const { data: lowStockItems } = useQuery({
    queryKey: ['inventory', 'low-stock'],
    queryFn: inventoryApi.getLowStockItems,
  });

  const createAreaMutation = useMutation({
    mutationFn: (data: StorageAreaFormData) => inventoryApi.createArea(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setAreaFormOpen(false);
    },
  });

  const createItemMutation = useMutation({
    mutationFn: (data: InventoryItemFormData) => {
      const apiData = {
        name: data.name,
        category: data.category || undefined,
        barcode: data.barcode || undefined,
        defaultUnit: data.unit || 'pieces',
        keepInStock: data.keepInStock,
        minStockLevel: data.keepInStock ? data.keepInStockThreshold : undefined,
      };
      return inventoryApi.createItem(apiData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setItemFormOpen(false);
    },
  });

  const isLoading = areasLoading || itemsLoading;

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Manage your household inventory"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAreaFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Area
            </Button>
            <Button onClick={() => setItemFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        }
      />

      {/* Alerts */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {expiringItems?.expiring && expiringItems.expiring.length > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  {expiringItems.expiring.length} items expiring soon
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Check your inventory
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {lowStockItems?.lowStock && lowStockItems.lowStock.length > 0 && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
            <CardContent className="flex items-center gap-3 p-4">
              <RefreshCcw className="h-5 w-5 text-blue-600" />
              <div>
                <p className="font-medium text-blue-900 dark:text-blue-100">
                  {lowStockItems.lowStock.length} items running low
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Consider adding to shopping list
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="all">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All Items</TabsTrigger>
          <TabsTrigger value="expiring">
            Expiring
            {expiringItems?.expiring && expiringItems.expiring.length > 0 && (
              <Badge className="ml-2" variant="destructive">
                {expiringItems.expiring.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="low-stock">
            Low Stock
            {lowStockItems?.lowStock && lowStockItems.lowStock.length > 0 && (
              <Badge className="ml-2" variant="secondary">
                {lowStockItems.lowStock.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="keep-in-stock">Keep in Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <div className="mb-4">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search items..."
              className="max-w-sm"
            />
          </div>

          {/* Storage areas */}
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : !areas?.areas?.length ? (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title="No storage areas"
              description="Create your first storage area to organize your inventory"
              action={
                <Button onClick={() => setAreaFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Area
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {areas.areas.map((area) => {
                const areaItems = items?.items?.filter((item) =>
                  item.id
                ) || [];
                return (
                  <Card key={area.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        {area.icon && <span>{area.icon}</span>}
                        {area.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!items?.items?.length ? (
                        <p className="text-sm text-muted-foreground">No items in this area</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {items.items.slice(0, 6).map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between rounded-md border p-2"
                            >
                              <span className="text-sm font-medium">{item.name}</span>
                              {item.category && (
                                <Badge variant="outline" className="text-xs">
                                  {item.category}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="expiring">
          {!expiringItems?.expiring?.length ? (
            <EmptyState
              title="No items expiring soon"
              description="All your items are fresh"
            />
          ) : (
            <div className="space-y-2">
              {expiringItems.expiring.map((stockEntry) => (
                <Card key={stockEntry.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium">{stockEntry.item?.name || 'Unknown'}</p>
                      <p className="text-sm text-muted-foreground">
                        {stockEntry.expiryDate &&
                          `Expires ${formatDate(stockEntry.expiryDate)}`}
                      </p>
                    </div>
                    <Badge variant="destructive">Expiring</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="low-stock">
          {!lowStockItems?.lowStock?.length ? (
            <EmptyState
              title="All items are well stocked"
              description="No items are running low"
            />
          ) : (
            <div className="space-y-2">
              {lowStockItems.lowStock.map((item) => (
                <Card key={item.item.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium">{item.item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Current: {item.currentQuantity} / Min: {item.minQuantity}
                      </p>
                    </div>
                    <Button size="sm">Add to List</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="keep-in-stock">
          <EmptyState
            title="No keep-in-stock items"
            description="Mark items as 'keep in stock' to automatically add them to your shopping list when running low"
          />
        </TabsContent>
      </Tabs>

      <AreaForm
        open={areaFormOpen}
        onOpenChange={setAreaFormOpen}
        onSubmit={(data) => createAreaMutation.mutate(data)}
        isSubmitting={createAreaMutation.isPending}
      />

      <ItemForm
        open={itemFormOpen}
        onOpenChange={setItemFormOpen}
        areas={areas?.areas || []}
        onSubmit={(data) => createItemMutation.mutate(data)}
        isSubmitting={createItemMutation.isPending}
      />
    </div>
  );
}
