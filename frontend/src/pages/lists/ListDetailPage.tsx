import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Trash2,
  Edit,
  Copy,
  BookmarkPlus,
  Pin,
  Archive,
  Printer,
  MoreHorizontal,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ShareButton, EditGate } from '@/components/permissions';
import { EditListDialog } from '@/components/lists/EditListDialog';
import { ChecklistView } from '@/components/lists/ChecklistView';
import { WishlistView } from '@/components/lists/WishlistView';
import { NotesView } from '@/components/lists/NotesView';
import { listsApi } from '@/api/lists';
import { getListTypeMeta } from '@/lib/listTypes';
import { cn } from '@/lib/utils';

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['lists', id],
    queryFn: () => listsApi.get(id!),
    enabled: !!id,
  });

  const update = useMutation({
    mutationFn: (data: Parameters<typeof listsApi.update>[1]) =>
      listsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', id] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });

  const duplicate = useMutation({
    mutationFn: (asTemplate: boolean) =>
      listsApi.duplicate(id!, { asTemplate, resetChecks: true }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      navigate(`/lists/${res.list.id}`);
    },
  });

  const deleteList = useMutation({
    mutationFn: () => listsApi.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      navigate('/lists');
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) return <div>List not found</div>;

  const { list, items } = data;
  const meta = getListTypeMeta(list.type);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild size="sm">
          <Link to="/lists">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All lists
          </Link>
        </Button>
        {list.isTemplate && <Badge variant="secondary">Template</Badge>}
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {list.icon && <span className="text-2xl">{list.icon}</span>}
            <span style={list.color ? { color: list.color } : undefined}>
              {list.name}
            </span>
            <Badge variant="outline" className={cn('ml-2 text-xs', meta.badgeClass)}>
              {meta.label}
            </Badge>
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <ShareButton
              resourceType="list"
              resourceId={id!}
              resourceName={list.name}
              variant="outline"
            />
            <EditGate feature="lists">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit details
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      update.mutate({ isPinned: !list.isPinned })
                    }
                  >
                    <Pin className="mr-2 h-4 w-4" />
                    {list.isPinned ? 'Unpin' : 'Pin'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicate.mutate(false)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                  {!list.isTemplate && (
                    <DropdownMenuItem onClick={() => duplicate.mutate(true)}>
                      <BookmarkPlus className="mr-2 h-4 w-4" />
                      Save as template
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      update.mutate({
                        archivedAt: list.archivedAt ? null : new Date().toISOString(),
                      })
                    }
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    {list.archivedAt ? 'Restore' : 'Archive'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDeleteOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </EditGate>
          </div>
        }
      />

      <div className="print:mt-4">
        {list.type === 'wishlist' ? (
          <WishlistView list={list} items={items} />
        ) : list.type === 'notes' ? (
          <NotesView list={list} items={items} />
        ) : (
          <ChecklistView list={list} items={items} />
        )}
      </div>

      <EditListDialog open={editOpen} onOpenChange={setEditOpen} list={list} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete list"
        description="This permanently deletes the list and all its items. This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleteList.mutate()}
      />
    </div>
  );
}
