import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Link2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { inventoryApi } from '@/api/inventory';
import { getItemIcon } from '@/lib/inventory-constants';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import type { InventoryItem } from '@/types/models';

interface RelinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item being replaced/deleted */
  item: InventoryItem | null;
  /** Called after successful relink with the new item ID */
  onRelinked?: (newItemId: string) => void;
  /** Title override */
  title?: string;
  /** Description override */
  description?: string;
}

/**
 * Reusable dialog for relinking recipe ingredients from one inventory item to another.
 * Used when:
 * - Deleting an item that's linked to recipes
 * - Consolidating duplicate items
 * - Merging items
 */
export function RelinkDialog({
  open,
  onOpenChange,
  item,
  onRelinked,
  title,
  description,
}: RelinkDialogProps) {
  const queryClient = useQueryClient();
  const [newItemId, setNewItemId] = useState('');

  // Fetch linked recipes for this item
  const { data: linkedData, isLoading: loadingLinks } = useQuery({
    queryKey: ['inventory', 'linked-recipes', item?.id],
    queryFn: () => inventoryApi.getLinkedRecipes(item!.id),
    enabled: open && !!item,
  });

  // Fetch all items for the replacement picker (exclude current item)
  const { data: itemsData } = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => inventoryApi.getItems({}),
    enabled: open,
  });

  const linkedRecipes = linkedData?.linkedRecipes || [];
  const itemOptions: ComboboxOption[] = useMemo(() => {
    return (itemsData?.items || [])
      .filter(i => i.id !== item?.id)
      .map(i => ({
        value: i.id,
        label: i.name,
        icon: <span>{getItemIcon(i)}</span>,
      }));
  }, [itemsData, item]);

  useEffect(() => {
    if (open) setNewItemId('');
  }, [open]);

  const relinkMutation = useMutation({
    mutationFn: () => inventoryApi.relinkItem(item!.id, newItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      toast({ title: `Relinked ${linkedRecipes.length} recipe ingredient${linkedRecipes.length !== 1 ? 's' : ''}` });
      onRelinked?.(newItemId);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({ title: 'Relink failed', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {title || `Relink "${item.name}"`}
          </DialogTitle>
          <DialogDescription>
            {description || `This item is used in ${linkedRecipes.length} recipe${linkedRecipes.length !== 1 ? 's' : ''}. Choose a replacement item before removing it.`}
          </DialogDescription>
        </DialogHeader>

        {loadingLinks ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Show which recipes are affected */}
            {linkedRecipes.length > 0 && (
              <div className="rounded-lg border p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Used in</p>
                {linkedRecipes.slice(0, 5).map((lr, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                    <span className="font-medium">{lr.recipeName}</span>
                    <span className="text-muted-foreground">as "{lr.ingredientName}"</span>
                  </div>
                ))}
                {linkedRecipes.length > 5 && (
                  <p className="text-xs text-muted-foreground">
                    ...and {linkedRecipes.length - 5} more
                  </p>
                )}
              </div>
            )}

            {/* Replacement item picker */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Replace with:</p>
              <Combobox
                options={itemOptions}
                value={newItemId}
                onValueChange={setNewItemId}
                placeholder="Search for a replacement item..."
                searchPlaceholder="Type to search..."
                emptyText="No items found"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => relinkMutation.mutate()}
            disabled={!newItemId || relinkMutation.isPending}
          >
            {relinkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Relink & Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
