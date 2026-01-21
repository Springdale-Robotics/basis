import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckSquare, Filter } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { TaskForm } from '@/components/tasks/TaskForm';
import { tasksApi } from '@/api/tasks';
import { householdsApi } from '@/api/households';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/models';
import type { TaskFormData } from '@/types/forms';

export function TasksPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'mine' | 'chores'>('all');
  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', filter],
    queryFn: () =>
      tasksApi.list({
        isChore: filter === 'chores' ? true : undefined,
      }),
  });

  const { data: usersData } = useQuery({
    queryKey: ['household-members'],
    queryFn: () => householdsApi.getMembers(),
  });

  const completeMutation = useMutation({
    mutationFn: tasksApi.complete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: TaskFormData) => {
      // Transform form data to match API expected format
      const apiData = {
        title: data.title,
        description: data.description,
        priority: data.priority === 'urgent' ? 'high' : data.priority as 'low' | 'medium' | 'high',
        dueDate: data.dueDate || undefined,
        isChore: data.isChore,
        assignedTo: data.assigneeId || undefined,
        rewardPoints: data.points || undefined,
        recurrenceRule: data.recurrence === 'none' ? undefined : data.recurrence,
      };
      return tasksApi.create(apiData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setFormOpen(false);
    },
  });

  const tasks = data?.tasks || [];
  const users = usersData?.members || [];
  const pendingTasks = tasks.filter((t: { status: string }) => t.status !== 'completed');
  const completedTasks = tasks.filter((t: { status: string }) => t.status === 'completed');

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Manage your household tasks and chores"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Task
          </Button>
        }
      />

      <Tabs defaultValue="pending">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="pending">
              Pending
              {pendingTasks.length > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {pendingTasks.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
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
              variant={filter === 'chores' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('chores')}
            >
              Chores
            </Button>
          </div>
        </div>

        <TabsContent value="pending">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : pendingTasks.length === 0 ? (
            <EmptyState
              icon={<CheckSquare className="h-12 w-12" />}
              title="No pending tasks"
              description="All caught up! Add a new task to get started."
              action={
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Task
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {pendingTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onComplete={() => completeMutation.mutate(task.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed">
          {completedTasks.length === 0 ? (
            <EmptyState
              title="No completed tasks"
              description="Complete some tasks to see them here"
            />
          ) : (
            <div className="space-y-2">
              {completedTasks.map((task) => (
                <TaskCard key={task.id} task={task} completed />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <TaskForm
        open={formOpen}
        onOpenChange={setFormOpen}
        users={users}
        onSubmit={(data) => createMutation.mutate(data)}
        isSubmitting={createMutation.isPending}
      />
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  completed?: boolean;
  onComplete?: () => void;
}

function TaskCard({ task, completed, onComplete }: TaskCardProps) {
  return (
    <Card className={cn(completed && 'opacity-60')}>
      <CardContent className="flex items-center gap-4 p-4">
        <Checkbox
          checked={completed}
          onCheckedChange={onComplete}
          disabled={completed}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('font-medium', completed && 'line-through')}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-sm text-muted-foreground line-clamp-1">
              {task.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {task.dueDate && (
              <span className="text-xs text-muted-foreground">
                Due {formatDate(task.dueDate)}
              </span>
            )}
            {task.isChore && (
              <Badge variant="outline" className="text-xs">
                Chore
              </Badge>
            )}
            {task.rewardPoints && (
              <Badge variant="secondary" className="text-xs">
                {task.rewardPoints} pts
              </Badge>
            )}
          </div>
        </div>
        <Badge
          variant={
            task.priority === 'high'
              ? 'destructive'
              : task.priority === 'medium'
              ? 'default'
              : 'secondary'
          }
        >
          {task.priority}
        </Badge>
      </CardContent>
    </Card>
  );
}
