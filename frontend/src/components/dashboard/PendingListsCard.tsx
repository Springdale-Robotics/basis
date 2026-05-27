import { useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight, ListChecks, Pin } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { listsApi } from '@/api/lists';
import { useAuthStore } from '@/stores/authStore';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { getListTypeMeta } from '@/lib/listTypes';
import { cn } from '@/lib/utils';

export function PendingListsCard() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const features = useFeatureFlags();

  const { data: listsData, isLoading: listsLoading } = useQuery({
    queryKey: ['lists', { dashboard: true }],
    queryFn: () => listsApi.list({}),
  });

  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ['lists', 'items-search', 'dashboard'],
    queryFn: () =>
      listsApi.searchItems({
        assigneeUserId: currentUser?.id,
        checked: false,
        limit: 6,
      }),
    enabled: !!currentUser?.id,
  });

  const toggle = useMutation({
    mutationFn: ({ listId, itemId }: { listId: string; itemId: string }) =>
      listsApi.toggleItem(listId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const pinned = useMemo(
    () => (listsData?.lists ?? []).filter((l) => l.isPinned).slice(0, 4),
    [listsData],
  );
  const myItems = itemsData?.items ?? [];
  const listsById = useMemo(() => {
    const m = new Map<string, { name: string; id: string }>();
    for (const l of itemsData?.lists ?? []) m.set(l.id, { name: l.name, id: l.id });
    return m;
  }, [itemsData]);

  const empty =
    !listsLoading &&
    !itemsLoading &&
    pinned.length === 0 &&
    myItems.length === 0;

  return (
    <Card className="md:col-span-2 lg:col-span-3">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-semibold">Your lists</CardTitle>
          <CardDescription>Pinned lists and items assigned to you</CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/lists">
            All lists
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {listsLoading || itemsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : empty ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ListChecks className="h-4 w-4" />
            No pinned lists or items assigned to you.{' '}
            <Link to="/lists" className="ml-1 underline">
              Open lists
            </Link>
          </p>
        ) : (
          <div className="space-y-4">
            {pinned.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {pinned.map((list) => {
                  const meta = getListTypeMeta(list.type);
                  const Icon = meta.icon;
                  return (
                    <Link
                      key={list.id}
                      to={`/lists/${list.id}`}
                      className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-2 hover:bg-background"
                    >
                      <Pin className="h-3 w-3 fill-current text-muted-foreground" />
                      {list.icon ? (
                        <span>{list.icon}</span>
                      ) : (
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="flex-1 truncate text-sm font-medium">
                        {list.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', meta.badgeClass)}
                      >
                        {meta.label}
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            )}
            {myItems.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Assigned to you
                </div>
                <div className="space-y-1.5">
                  {myItems.map((it) => {
                    const parent = listsById.get(it.listId);
                    return (
                      <div
                        key={it.id}
                        className="flex items-center gap-3 rounded-lg bg-background/70 p-2"
                      >
                        <Checkbox
                          checked={false}
                          onCheckedChange={() =>
                            toggle.mutate({ listId: it.listId, itemId: it.id })
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{it.content}</p>
                          {parent && (
                            <Link
                              to={`/lists/${parent.id}`}
                              className="text-xs text-muted-foreground hover:underline"
                            >
                              {parent.name}
                            </Link>
                          )}
                        </div>
                        {features.rewards && it.rewardPoints > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {it.rewardPoints} pts
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
