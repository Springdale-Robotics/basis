import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { inventoryApi } from '@/api/inventory';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import type { IngredientAlias } from '@/types/models';

/**
 * Recipe import records a learned name whenever someone links an ingredient to
 * an inventory item called something else ("evoo" -> "Olive Oil"). Those rules
 * then apply on their own to every later import and receipt scan.
 *
 * That is only reasonable if the household can see them. A wrong one — say
 * "butter" pointing at "Unsalted Butter" in a kitchen that stocks both — would
 * otherwise keep quietly mislinking with nothing to point at.
 */
export function LearnedIngredientNames() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<IngredientAlias | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'ingredient-aliases'],
    queryFn: () => inventoryApi.getIngredientAliases(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteIngredientAlias(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'ingredient-aliases'] });
      toast({ title: 'Learned name removed' });
      setDeleteTarget(null);
    },
    onError: (error) => {
      toast({
        title: 'Could not remove learned name',
        description: getErrorMessage(error, 'Please try again.'),
        variant: 'destructive',
      });
    },
  });

  const aliases = data?.aliases ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Learned Ingredient Names
        </CardTitle>
        <CardDescription>
          When you link a recipe ingredient to an item with a different name, we remember it and
          apply it to later imports and receipts. Remove any that aren't right.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing learned yet. Link an ingredient to an item while importing a recipe and it will
            show up here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {aliases.map((alias) => (
              <li key={alias.id} className="flex items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <span className="truncate font-medium">{alias.displayName}</span>
                  <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-muted-foreground">{alias.itemName}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(alias)}
                  disabled={deleteMutation.isPending}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Forget this name?"
        description={
          deleteTarget
            ? `"${deleteTarget.displayName}" will stop linking to ${deleteTarget.itemName} automatically. Recipes already imported keep their links.`
            : ''
        }
        confirmText="Forget"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </Card>
  );
}
