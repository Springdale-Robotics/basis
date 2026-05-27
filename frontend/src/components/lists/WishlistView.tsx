import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  ExternalLink,
  Gift,
  Hand,
  Trash2,
  DollarSign,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { householdsApi } from '@/api/households';
import { useAuthStore } from '@/stores/authStore';
import { useListMutations } from './useListMutations';
import { ItemDetailSheet } from './ItemDetailSheet';
import { cn } from '@/lib/utils';
import type { List, ListItem } from '@/types/models';

interface WishlistViewProps {
  list: List;
  items: ListItem[];
}

export function WishlistView({ list, items }: WishlistViewProps) {
  const m = useListMutations(list.id);
  const currentUser = useAuthStore((s) => s.user);
  const [quickAdd, setQuickAdd] = useState('');
  const [detailItem, setDetailItem] = useState<ListItem | null>(null);

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
  });
  const members = membersData?.members ?? [];

  const isRecipient = list.recipientUserId === currentUser?.id;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAdd.trim()) return;
    m.addItem.mutate({ content: quickAdd.trim() });
    setQuickAdd('');
  };

  return (
    <>
      {isRecipient && (
        <Card className="mb-4 border-pink-500/30 bg-pink-500/5">
          <CardContent className="flex items-center gap-3 p-3 text-sm">
            <Gift className="h-5 w-5 text-pink-500" />
            <p>
              <strong>This list is for you.</strong> You won't see who has
              claimed each item — surprises are safe.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="p-3">
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              placeholder="Add a wish… (you can add link & price after)"
              value={quickAdd}
              onChange={(e) => setQuickAdd(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!quickAdd.trim() || m.addItem.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((it) => {
          const claimer = it.claimedByUserId
            ? members.find((u) => u.id === it.claimedByUserId) ?? null
            : null;
          const claimedByMe = it.claimedByUserId === currentUser?.id;
          const claimedBySomeoneElse =
            it.claimedByUserId && it.claimedByUserId !== currentUser?.id;

          return (
            <Card
              key={it.id}
              className={cn(
                'group cursor-pointer transition-shadow hover:shadow-md',
                claimedBySomeoneElse && !isRecipient && 'opacity-70',
              )}
              onClick={() => setDetailItem(it)}
            >
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{it.content}</div>
                    {it.notes && (
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {it.notes}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      m.deleteItem.mutate(it.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {it.price && (
                    <Badge variant="secondary" className="gap-1">
                      <DollarSign className="h-3 w-3" />
                      {it.price}
                    </Badge>
                  )}
                  {it.url && (
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Link
                    </a>
                  )}
                </div>
                {!isRecipient && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    {claimer ? (
                      <div className="flex items-center gap-1.5 text-xs">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={claimer.avatarUrl} />
                          <AvatarFallback className="text-[9px]">
                            {claimer.displayName?.[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          {claimedByMe ? 'You claimed' : `${claimer.displayName} claimed`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Unclaimed
                      </span>
                    )}
                    <Button
                      variant={claimedByMe ? 'outline' : 'default'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!!claimedBySomeoneElse}
                      onClick={(e) => {
                        e.stopPropagation();
                        m.claimItem.mutate(it.id);
                      }}
                    >
                      <Hand className="mr-1 h-3 w-3" />
                      {claimedByMe ? 'Unclaim' : claimedBySomeoneElse ? 'Taken' : 'Claim'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {items.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No wishes yet. Add one above.
        </p>
      )}

      <ItemDetailSheet
        open={!!detailItem}
        onOpenChange={(o) => !o && setDetailItem(null)}
        list={list}
        item={detailItem}
        onSave={async (data) => {
          if (!detailItem) return;
          await m.updateItem.mutateAsync({ itemId: detailItem.id, data });
        }}
        onDelete={async () => {
          if (!detailItem) return;
          await m.deleteItem.mutateAsync(detailItem.id);
        }}
      />
    </>
  );
}
