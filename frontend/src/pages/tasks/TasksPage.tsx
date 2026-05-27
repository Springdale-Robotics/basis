import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownAZ,
  ArrowUpDown,
  CalendarClock,
  CheckSquare,
  Clock,
  GripVertical,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
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
import { format, isToday, isTomorrow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/shared/EmptyState';
import { EditGate } from '@/components/permissions';
import { TaskRow } from '@/components/tasks/TaskRow';
import { QuickAddInput } from '@/components/tasks/QuickAddInput';
import { TaskEditDialog } from '@/components/tasks/TaskEditDialog';
import {
  AssigneePicker,
  type AssigneeValue,
} from '@/components/tasks/AssigneePicker';
import { tasksApi } from '@/api/tasks';
import { householdsApi } from '@/api/households';
import { groupsApi } from '@/api/groups';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { Task, TaskKind } from '@/types/models';
import type { CreateTaskRequest, UpdateTaskRequest } from '@/api/tasks';

type Filter = 'all' | 'mine';
type SortBy = 'due' | 'manual' | 'added' | 'title';

const SORT_OPTIONS: { value: SortBy; label: string; icon: typeof Clock }[] = [
  { value: 'due', label: 'Due date', icon: CalendarClock },
  { value: 'added', label: 'Recently added', icon: Clock },
  { value: 'title', label: 'Title (A–Z)', icon: ArrowDownAZ },
  { value: 'manual', label: 'Manual', icon: GripVertical },
];

function storedSort(kind: TaskKind): SortBy {
  if (typeof window === 'undefined') return 'due';
  const v = window.localStorage.getItem(`tasks-sort-${kind}`);
  if (v === 'due' || v === 'manual' || v === 'added' || v === 'title') return v;
  return 'due';
}

function nextDueLabel(dueDate: string): string {
  const d = new Date(dueDate);
  if (isToday(d)) return 'today';
  if (isTomorrow(d)) return 'tomorrow';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? format(d, 'MMM d') : format(d, 'MMM d, yyyy');
}

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
  const [sortBy, setSortBy] = useState<SortBy>(() => storedSort('task'));

  // Re-read sort preference when switching tabs.
  useEffect(() => {
    setSortBy(storedSort(kind));
  }, [kind]);

  // Persist sort preference per kind.
  const updateSort = useCallback(
    (next: SortBy) => {
      setSortBy(next);
      window.localStorage.setItem(`tasks-sort-${kind}`, next);
    },
    [kind],
  );

  // One query for both tabs — keeps counts in sync regardless of active tab.
  const allTasksQueryKey = ['tasks', 'all', showCompleted] as const;
  const { data: allTasksData, isLoading } = useQuery({
    queryKey: allTasksQueryKey,
    queryFn: () =>
      tasksApi.list({
        status: showCompleted ? undefined : 'pending',
        limit: 200,
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

  const allTasks = useMemo(() => allTasksData?.tasks ?? [], [allTasksData]);
  const users = membersData?.members ?? [];
  const groups = groupsData?.groups ?? [];

  // Resolve which groups the current user belongs to. Required for "Mine"
  // filter and claim-button visibility.
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

  // Per-tab pending counts. Always reflect both tabs regardless of active.
  const taskCount = allTasks.filter(
    (t) => t.kind === 'task' && t.status === 'pending',
  ).length;
  const choreCount = allTasks.filter(
    (t) => t.kind === 'chore' && t.status === 'pending',
  ).length;

  // Tasks for the current tab + filter.
  const filtered = useMemo(() => {
    return allTasks.filter((t) => {
      if (t.kind !== kind) return false;
      if (filter === 'mine') {
        const isMine =
          t.assigneeUserId === user?.id ||
          (t.assigneeGroupId && currentUserGroupIds.has(t.assigneeGroupId));
        if (!isMine) return false;
      }
      return true;
    });
  }, [allTasks, kind, filter, user?.id, currentUserGroupIds]);

  // Apply sort. Pinned items always stick to the top regardless of choice.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (sortBy) {
        case 'manual':
          return a.sortOrder - b.sortOrder;
        case 'due': {
          const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          if (ad !== bd) return ad - bd;
          return a.sortOrder - b.sortOrder;
        }
        case 'added':
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case 'title':
          return a.title.localeCompare(b.title);
      }
    });
    return arr;
  }, [filtered, sortBy]);

  // Local drag-reorder override. Cleared when underlying data changes
  // shape (different tab, filter, or task count).
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  useEffect(() => {
    setLocalOrder(null);
  }, [kind, filter, showCompleted, sortBy]);

  const orderedTasks = useMemo(() => {
    if (!localOrder) return sorted;
    const byId = new Map(sorted.map((t) => [t.id, t]));
    const reordered = localOrder
      .map((id) => byId.get(id))
      .filter((t): t is Task => !!t);
    // Append any new items not in the local order.
    const seen = new Set(localOrder);
    return [...reordered, ...sorted.filter((t) => !seen.has(t.id))];
  }, [sorted, localOrder]);

  // ===== Mutations =====
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const createMutation = useMutation({
    mutationFn: (data: CreateTaskRequest) => tasksApi.create(data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: allTasksQueryKey });
      const prev = queryClient.getQueryData<{ tasks: Task[] }>(allTasksQueryKey);
      // Optimistic insert with a tentative ID so React keys stay stable.
      if (prev) {
        const optimistic: Task = {
          id: `optimistic-${Date.now()}`,
          householdId: user?.householdId ?? '',
          createdBy: user?.id ?? '',
          kind: data.kind,
          title: data.title,
          description: data.description ?? undefined,
          assigneeUserId: data.assigneeUserId ?? undefined,
          assigneeGroupId: data.assigneeGroupId ?? undefined,
          dueDate: data.dueDate ?? undefined,
          cadenceDays: data.cadenceDays ?? undefined,
          recurrenceMode: data.recurrenceMode ?? undefined,
          recurrenceRule: data.recurrenceRule ?? undefined,
          status: 'pending',
          lastCompletedAt: undefined,
          lastCompletedBy: undefined,
          pinned: data.pinned ?? false,
          sortOrder: prev.tasks.length,
          rewardPoints: data.rewardPoints ?? 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        queryClient.setQueryData(allTasksQueryKey, {
          tasks: [...prev.tasks, optimistic],
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(allTasksQueryKey, ctx.prev);
      toast({
        title: 'Could not create task',
        description: 'Try again or open More options.',
      });
    },
    onSettled: () => {
      invalidate();
      setEditorOpen(false);
    },
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
      await queryClient.cancelQueries({ queryKey: allTasksQueryKey });
      const prev = queryClient.getQueryData<{ tasks: Task[] }>(
        allTasksQueryKey,
      );
      if (prev) {
        queryClient.setQueryData(allTasksQueryKey, {
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
    onSuccess: (result) => {
      const completed = result?.task;
      if (completed?.kind === 'chore' && completed?.dueDate) {
        toast({
          title: 'Marked done',
          description: `Next due ${nextDueLabel(completed.dueDate)}.`,
        });
      }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(allTasksQueryKey, ctx.prev);
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
    onError: invalidate,
  });

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
    // Dragging in any sort mode switches to Manual so the new order sticks.
    if (sortBy !== 'manual') updateSort('manual');
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

  // ===== Bulk =====
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

  const sortIcon = SORT_OPTIONS.find((o) => o.value === sortBy)?.icon ?? ArrowUpDown;
  const SortIcon = sortIcon;
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? 'Sort';

  return (
    <div>
      <PageHeader
        title="Tasks & Chores"
        description="One-shot tasks live alongside the chores that keep coming back."
        actions={
          <EditGate feature="tasks">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Sparkles className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">More options</span>
            </Button>
          </EditGate>
        }
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as TaskKind)}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="self-start">
            <TabsTrigger value="task">
              Tasks
              {taskCount > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {taskCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="chore">
              Chores
              {choreCount > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {choreCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border bg-card p-0.5">
              <Button
                variant={filter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7"
                onClick={() => setFilter('all')}
              >
                All
              </Button>
              <Button
                variant={filter === 'mine' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7"
                onClick={() => setFilter('mine')}
              >
                Mine
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <SortIcon className="mr-1.5 h-3.5 w-3.5" />
                  <span className="hidden md:inline">Sort: </span>
                  <span>{sortLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                {SORT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <DropdownMenuCheckboxItem
                      key={opt.value}
                      checked={sortBy === opt.value}
                      onCheckedChange={() => updateSort(opt.value)}
                    >
                      <Icon className="mr-2 h-3.5 w-3.5" />
                      {opt.label}
                    </DropdownMenuCheckboxItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowCompleted((v) => !v)}>
                  {showCompleted ? 'Hide completed' : 'Show completed'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <TabsContent value={kind} className="space-y-3">
          <EditGate feature="tasks">
            <QuickAddInput
              kind={kind}
              users={users}
              groups={groups}
              currentUserId={user?.id}
              onSubmit={handleQuickAdd}
              isSubmitting={createMutation.isPending}
            />
          </EditGate>

          {bulkMode && (
            <div
              className={cn(
                'sticky top-0 z-10 flex flex-wrap items-center gap-2',
                'rounded-md border bg-secondary/90 backdrop-blur p-2',
              )}
            >
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
                placeholder="Reassign…"
              />
              <Button size="sm" variant="destructive" onClick={bulkDelete}>
                Delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto"
                aria-label="Clear selection"
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
                kind === 'chore' ? 'No chores yet' : 'Nothing to do — nice work'
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
                      manualSort={sortBy === 'manual'}
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
