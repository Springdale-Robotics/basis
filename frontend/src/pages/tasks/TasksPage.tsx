import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Sparkles, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { EditGate } from '@/components/permissions';
import { TaskRow } from '@/components/tasks/TaskRow';
import { QuickAddInput } from '@/components/tasks/QuickAddInput';
import { TaskEditDialog } from '@/components/tasks/TaskEditDialog';
import { AssigneePicker, type AssigneeValue } from '@/components/tasks/AssigneePicker';
import { tasksApi } from '@/api/tasks';
import { householdsApi } from '@/api/households';
import { groupsApi } from '@/api/groups';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import type { Task, TaskKind } from '@/types/models';
import type { CreateTaskRequest, UpdateTaskRequest } from '@/api/tasks';

type Filter = 'all' | 'mine';

export function TasksPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [kind, setKind] = useState<TaskKind>('task');
  const [filter, setFilter] = useState<Filter>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tasksQueryKey = ['tasks', kind, filter, showCompleted] as const;

  const { data: tasksData, isLoading } = useQuery({
    queryKey: tasksQueryKey,
    queryFn: () =>
      tasksApi.list({
        kind,
        mine: filter === 'mine' ? true : undefined,
        status: showCompleted ? undefined : 'pending',
      }),
  });

  const { data: membersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
  });

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
  });

  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData]);
  const users = membersData?.members ?? [];
  const groups = groupsData?.groups ?? [];

  // The set of groups the current user is in — needed to know if a task is
  // "claimable" by them. We approximate from the groups list; the backend
  // membership endpoint is per-group, so we fetch members eagerly only for
  // groups the user might be in. For now we assume `groups.list` returns all
  // groups in the household and we'll filter client-side via member fetches
  // lazily. To keep this page snappy, we just provide an empty set when we
  // haven't loaded membership; `Claim` button will only show if the server
  // signals via the `mine` filter that the task could be theirs anyway.
  const [currentUserGroupIds, setCurrentUserGroupIds] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    if (!user || groups.length === 0) return;
    let cancelled = false;
    Promise.all(
      groups.map(async (g) => {
        try {
          const { members } = await groupsApi.get(g.id);
          return members.some((m) => m.userId === user.id) ? g.id : null;
        } catch {
          return null;
        }
      }),
    ).then((ids) => {
      if (cancelled) return;
      setCurrentUserGroupIds(new Set(ids.filter((id): id is string => !!id)));
    });
    return () => {
      cancelled = true;
    };
  }, [groups, user]);

  // ===== Mutations =====
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const createMutation = useMutation({
    mutationFn: (data: CreateTaskRequest) => tasksApi.create(data),
    onSuccess: () => {
      invalidate();
      setEditorOpen(false);
    },
    onError: (e: Error) =>
      toast({ title: 'Could not create task', description: e.message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskRequest }) =>
      tasksApi.update(id, data),
    onSuccess: () => {
      invalidate();
      setEditorOpen(false);
      setEditing(null);
    },
    onError: (e: Error) =>
      toast({ title: 'Could not save task', description: e.message }),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => tasksApi.complete(id),
    onMutate: async (id) => {
      // Optimistic flip — feels immediate without the round-trip.
      await queryClient.cancelQueries({ queryKey: tasksQueryKey });
      const prev = queryClient.getQueryData<{ tasks: Task[] }>(tasksQueryKey);
      if (prev) {
        queryClient.setQueryData(tasksQueryKey, {
          tasks: prev.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: t.kind === 'chore' ? 'pending' : 'completed',
                  lastCompletedAt: new Date().toISOString(),
                }
              : t,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(tasksQueryKey, ctx.prev);
    },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tasksApi.delete(id),
    onSuccess: () => {
      invalidate();
      setEditorOpen(false);
      setEditing(null);
    },
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => tasksApi.claim(id),
    onSuccess: invalidate,
  });

  const reorderMutation = useMutation({
    mutationFn: (taskIds: string[]) => tasksApi.reorder({ taskIds }),
    onError: invalidate, // refetch on failure to restore server order
  });

  // ===== Local sort order (for optimistic drag-reorder) =====
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  useEffect(() => {
    setLocalOrder(null);
  }, [kind, filter, showCompleted, tasks.length]);
  const orderedTasks = useMemo(() => {
    if (!localOrder) return tasks;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return localOrder
      .map((id) => byId.get(id))
      .filter((t): t is Task => !!t);
  }, [tasks, localOrder]);

  // ===== Drag-and-drop =====
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedTasks.map((t) => t.id);
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from === -1 || to === -1) return;
    const next = arrayMove(ids, from, to);
    setLocalOrder(next);
    reorderMutation.mutate(next);
  };

  // ===== Keyboard shortcuts =====
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setEditing(null);
        setEditorOpen(true);
      } else if (e.key === 'Escape' && selectedIds.size > 0) {
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds]);

  // ===== Bulk actions =====
  const bulkMode = selectedIds.size > 0;

  const bulkComplete = () => {
    selectedIds.forEach((id) => completeMutation.mutate(id));
    setSelectedIds(new Set());
  };
  const bulkDelete = () => {
    selectedIds.forEach((id) => deleteMutation.mutate(id));
    setSelectedIds(new Set());
  };
  const bulkAssign = (value: AssigneeValue) => {
    selectedIds.forEach((id) =>
      updateMutation.mutate({
        id,
        data: {
          assigneeUserId: value.userId ?? null,
          assigneeGroupId: value.groupId ?? null,
        },
      }),
    );
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleQuickAdd = (data: CreateTaskRequest) => {
    createMutation.mutate(data);
  };

  return (
    <div>
      <PageHeader
        title="Tasks & Chores"
        description="One-shot tasks live alongside the chores that keep coming back."
        actions={
          <EditGate feature="tasks">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              More options
            </Button>
          </EditGate>
        }
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as TaskKind)}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="task">
              Tasks
              {orderedTasks.length > 0 && kind === 'task' && (
                <Badge className="ml-2" variant="secondary">
                  {orderedTasks.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="chore">
              Chores
              {orderedTasks.length > 0 && kind === 'chore' && (
                <Badge className="ml-2" variant="secondary">
                  {orderedTasks.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={filter === 'all' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              variant={filter === 'mine' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('mine')}
            >
              Mine
            </Button>
            <Button
              variant={showCompleted ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowCompleted((v) => !v)}
            >
              {showCompleted ? 'Hide done' : 'Show done'}
            </Button>
          </div>
        </div>

        <TabsContent value={kind} className="space-y-3">
          <EditGate feature="tasks">
            <QuickAddInput
              kind={kind}
              onSubmit={handleQuickAdd}
              isSubmitting={createMutation.isPending}
            />
          </EditGate>

          {bulkMode && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-secondary/50 p-2">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <Button size="sm" variant="default" onClick={bulkComplete}>
                Complete
              </Button>
              <AssigneePicker
                users={users}
                groups={groups}
                value={{}}
                onChange={bulkAssign}
                compact
              />
              <Button size="sm" variant="destructive" onClick={bulkDelete}>
                Delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : orderedTasks.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-12 w-12" />}
              title={
                kind === 'chore'
                  ? 'No chores yet'
                  : 'Nothing to do — nice work'
              }
              description={
                kind === 'chore'
                  ? 'Add recurring household chores using the box above.'
                  : 'Add a task with the input above, or press N anywhere on this page.'
              }
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={orderedTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {orderedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      users={users}
                      groups={groups}
                      currentUserId={user?.id ?? ''}
                      currentUserGroups={Array.from(currentUserGroupIds)}
                      selected={selectedIds.has(task.id)}
                      bulkMode={bulkMode}
                      onToggleSelect={() => toggleSelect(task.id)}
                      onComplete={() => completeMutation.mutate(task.id)}
                      onClaim={() => claimMutation.mutate(task.id)}
                      onEdit={() => {
                        setEditing(task);
                        setEditorOpen(true);
                      }}
                      onDelete={() => deleteMutation.mutate(task.id)}
                      onTogglePin={() =>
                        updateMutation.mutate({
                          id: task.id,
                          data: { pinned: !task.pinned },
                        })
                      }
                      onAssign={(value) =>
                        updateMutation.mutate({
                          id: task.id,
                          data: {
                            assigneeUserId: value.userId ?? null,
                            assigneeGroupId: value.groupId ?? null,
                          },
                        })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </TabsContent>
      </Tabs>

      <TaskEditDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditing(null);
        }}
        task={editing}
        defaultKind={kind}
        users={users}
        groups={groups}
        onCreate={(data) => createMutation.mutate(data)}
        onUpdate={(id, data) => updateMutation.mutate({ id, data })}
        onDelete={(id) => deleteMutation.mutate(id)}
        isSubmitting={
          createMutation.isPending ||
          updateMutation.isPending ||
          deleteMutation.isPending
        }
      />
    </div>
  );
}
