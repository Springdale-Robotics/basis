import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Camera,
  ChevronDown,
  Search,
  Pin,
  Archive,
  Copy,
  ListChecks,
  Layers,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ImageParseDialog } from '@/components/image-parse';
import { CreateListDialog } from '@/components/lists/CreateListDialog';
import { listsApi } from '@/api/lists';
import { getListTypeMeta } from '@/lib/listTypes';
import { cn } from '@/lib/utils';
import type { List } from '@/types/models';

type Filter = 'active' | 'templates' | 'archived';

export function ListsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [imageParseOpen, setImageParseOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');

  const includeArchived = filter === 'archived';
  const onlyTemplates = filter === 'templates';

  const { data, isLoading } = useQuery({
    queryKey: ['lists', { includeArchived, onlyTemplates, search }],
    queryFn: () =>
      listsApi.list({
        includeArchived,
        onlyTemplates,
        search: search || undefined,
      }),
  });
  const lists = data?.lists ?? [];

  // Pinned vs other (only for active filter)
  const { pinned, others } = useMemo(() => {
    if (filter !== 'active') return { pinned: [], others: lists };
    return {
      pinned: lists.filter((l) => l.isPinned),
      others: lists.filter((l) => !l.isPinned),
    };
  }, [lists, filter]);

  const handleImageParseSuccess = (_type: string, createdIds: string[]) => {
    if (createdIds.length > 0) navigate(`/lists/${createdIds[0]}`);
  };

  return (
    <div>
      <PageHeader
        title="Lists"
        description="Checklists, wish lists, and notes for the household."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New list
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create manually
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImageParseOpen(true)}>
                <Camera className="mr-2 h-4 w-4" />
                From image
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lists…"
            className="pl-8 sm:w-64"
          />
        </div>
      </div>

      <ImageParseDialog
        open={imageParseOpen}
        onOpenChange={setImageParseOpen}
        defaultType="list"
        onSuccess={handleImageParseSuccess}
      />

      <CreateListDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/lists/${id}`)}
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-12 w-12" />}
          title={
            filter === 'templates'
              ? 'No templates yet'
              : filter === 'archived'
              ? 'No archived lists'
              : search
              ? 'No lists match'
              : 'No lists yet'
          }
          description={
            filter === 'templates'
              ? 'Save a list as a template to reuse it for trips, parties, etc.'
              : filter === 'archived'
              ? "Lists you've archived will appear here."
              : 'Create your first list to get organized.'
          }
          action={
            filter === 'active' && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImageParseOpen(true)}>
                  <Camera className="mr-2 h-4 w-4" />
                  From image
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New list
                </Button>
              </div>
            )
          }
        />
      ) : (
        <div className="space-y-6">
          {pinned.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Pin className="h-3 w-3" /> Pinned
              </div>
              <ListsGrid lists={pinned} queryClient={queryClient} />
            </div>
          )}
          <ListsGrid lists={others} queryClient={queryClient} />
        </div>
      )}
    </div>
  );
}

function ListsGrid({
  lists,
  queryClient,
}: {
  lists: List[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof listsApi.update>[1] }) =>
      listsApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => listsApi.duplicate(id, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lists.map((list) => {
        const meta = getListTypeMeta(list.type);
        const Icon = meta.icon;
        return (
          <Card
            key={list.id}
            className="group relative transition-shadow hover:shadow-md"
            style={list.color ? { borderTopColor: list.color, borderTopWidth: 3 } : undefined}
          >
            <CardContent className="p-4">
              <Link to={`/lists/${list.id}`} className="block">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 truncate">
                    {list.icon ? (
                      <span className="text-xl">{list.icon}</span>
                    ) : (
                      <Icon
                        className="h-5 w-5 text-muted-foreground"
                        style={list.color ? { color: list.color } : undefined}
                      />
                    )}
                    <span className="truncate font-medium">{list.name}</span>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 text-xs', meta.badgeClass)}>
                    {list.isTemplate ? 'Template' : meta.label}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Updated {new Date(list.updatedAt).toLocaleDateString()}
                </p>
              </Link>
              <div className="mt-3 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={list.isPinned ? 'Unpin' : 'Pin'}
                  onClick={(e) => {
                    e.preventDefault();
                    update.mutate({ id: list.id, data: { isPinned: !list.isPinned } });
                  }}
                >
                  <Pin className={cn('h-3.5 w-3.5', list.isPinned && 'fill-current')} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Duplicate"
                  onClick={(e) => {
                    e.preventDefault();
                    duplicate.mutate(list.id);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title={list.archivedAt ? 'Restore' : 'Archive'}
                  onClick={(e) => {
                    e.preventDefault();
                    update.mutate({
                      id: list.id,
                      data: { archivedAt: list.archivedAt ? null : new Date().toISOString() },
                    });
                  }}
                >
                  {list.archivedAt ? (
                    <Layers className="h-3.5 w-3.5" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
