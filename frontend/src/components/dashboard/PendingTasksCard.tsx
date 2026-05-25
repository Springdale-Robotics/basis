import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi } from '@/api/tasks';
import { formatDate } from '@/lib/utils';

export function PendingTasksCard() {
  const queryClient = useQueryClient();

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks', 'pending'],
    queryFn: () => tasksApi.list({ status: 'pending', limit: 5 }),
  });

  const completeTaskMutation = useMutation({
    mutationFn: (taskId: string) => tasksApi.complete(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <Card className="md:col-span-2 lg:col-span-3 bg-secondary/30 border-secondary">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-semibold">Family To-Dos</CardTitle>
          <CardDescription>Things to check off together</CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/tasks">
            View All
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !tasksData?.tasks?.length ? (
          <p className="text-sm text-muted-foreground">Nothing on the list — nice work!</p>
        ) : (
          <div className="space-y-2">
            {tasksData.tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-lg bg-background/70 p-3"
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={false}
                    onCheckedChange={() => completeTaskMutation.mutate(task.id)}
                    disabled={completeTaskMutation.isPending}
                    className="h-5 w-5"
                  />
                  <div>
                    <p className="font-medium">{task.title}</p>
                    {task.dueDate && (
                      <p className="text-xs text-muted-foreground">
                        Due {formatDate(task.dueDate)}
                      </p>
                    )}
                  </div>
                </div>
                <Badge
                  variant={
                    task.priority === 'high'
                      ? 'warning'
                      : task.priority === 'medium'
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {task.priority}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
