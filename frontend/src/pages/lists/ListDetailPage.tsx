import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Edit } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ShareButton, EditGate } from '@/components/permissions';
import { listsApi } from '@/api/lists';
import { cn } from '@/lib/utils';

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newItem, setNewItem] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: list, isLoading } = useQuery({
    queryKey: ['lists', id],
    queryFn: () => listsApi.get(id!),
    enabled: !!id,
  });

  const addItemMutation = useMutation({
    mutationFn: (content: string) => listsApi.createItem(id!, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', id] });
      setNewItem('');
    },
  });

  const toggleItemMutation = useMutation({
    mutationFn: (itemId: string) => listsApi.toggleItem(id!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', id] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => listsApi.deleteItem(id!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', id] });
    },
  });

  const deleteListMutation = useMutation({
    mutationFn: () => listsApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      navigate('/lists');
    },
  });

  const clearCheckedMutation = useMutation({
    mutationFn: () => listsApi.clearCheckedItems(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', id] });
    },
  });

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (newItem.trim()) {
      addItemMutation.mutate(newItem.trim());
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!list) {
    return <div>List not found</div>;
  }

  const listData = list.list;
  const listItems = list.items || [];
  const checkedItems = listItems.filter((item) => item.checked);
  const uncheckedItems = listItems.filter((item) => !item.checked);

  return (
    <div>
      <div className="mb-4">
        <Button variant="ghost" asChild>
          <Link to="/lists">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Lists
          </Link>
        </Button>
      </div>

      <PageHeader
        title={listData.name}
        actions={
          <div className="flex gap-2">
            <ShareButton
              resourceType="list"
              resourceId={id!}
              resourceName={listData.name}
              variant="outline"
            />
            <EditGate feature="lists">
              {checkedItems.length > 0 && (
                <Button variant="outline" onClick={() => clearCheckedMutation.mutate()}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Checked
                </Button>
              )}
              <Button variant="outline">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </EditGate>
          </div>
        }
      />

      {/* Add item */}
      <EditGate feature="lists">
        <Card className="mb-6">
          <CardContent className="p-4">
            <form onSubmit={handleAddItem} className="flex gap-2">
              <Input
                placeholder="Add an item..."
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={addItemMutation.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      </EditGate>

      {/* Items */}
      <div className="space-y-2">
        {uncheckedItems.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex items-center gap-4 p-4">
              <Checkbox
                checked={item.checked}
                onCheckedChange={(checked) =>
                  toggleItemMutation.mutate(item.id)
                }
              />
              <span className="flex-1">{item.content}</span>
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

        {checkedItems.length > 0 && (
          <>
            <div className="py-4">
              <span className="text-sm text-muted-foreground">
                Completed ({checkedItems.length})
              </span>
            </div>
            {checkedItems.map((item) => (
              <Card key={item.id} className="opacity-60">
                <CardContent className="flex items-center gap-4 p-4">
                  <Checkbox
                    checked={item.checked}
                    onCheckedChange={() => toggleItemMutation.mutate(item.id)}
                  />
                  <span className="flex-1 line-through">{item.content}</span>
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
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete List"
        description="Are you sure you want to delete this list? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleteListMutation.mutate()}
      />
    </div>
  );
}
