import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { Clock, Star, User, MoreVertical, Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Task, User as UserType } from '@/types/models';

interface TaskCardProps {
  task: Task;
  assignee?: UserType | null;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
}

export function TaskCard({
  task,
  assignee,
  onComplete,
  onEdit,
  onDelete,
  onAssign,
}: TaskCardProps) {
  const isCompleted = task.status === 'completed';
  const isOverdue = task.dueDate && isPast(new Date(task.dueDate)) && !isCompleted;

  const getDueDateLabel = () => {
    if (!task.dueDate) return null;
    const date = new Date(task.dueDate);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    return format(date, 'MMM d');
  };

  const priorityColors = {
    low: 'bg-gray-100 text-gray-700',
    medium: 'bg-blue-100 text-blue-700',
    high: 'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };

  return (
    <Card className={cn(isCompleted && 'opacity-60')}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Button
            variant={isCompleted ? 'default' : 'outline'}
            size="icon"
            className={cn(
              'shrink-0 h-6 w-6 rounded-full',
              isCompleted && 'bg-green-500 hover:bg-green-600'
            )}
            onClick={onComplete}
          >
            {isCompleted && <Check className="h-3 w-3" />}
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3
                className={cn(
                  'font-medium',
                  isCompleted && 'line-through text-muted-foreground'
                )}
              >
                {task.title}
              </h3>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={onAssign}>Assign</DropdownMenuItem>
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {task.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {task.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {task.priority && (
                <Badge
                  className={cn('text-xs', priorityColors[task.priority])}
                  variant="secondary"
                >
                  {task.priority}
                </Badge>
              )}
              {task.dueDate && (
                <div
                  className={cn(
                    'flex items-center gap-1 text-xs',
                    isOverdue && 'text-destructive'
                  )}
                >
                  <Clock className="h-3 w-3" />
                  {getDueDateLabel()}
                </div>
              )}
              {task.points && task.points > 0 && (
                <div className="flex items-center gap-1 text-xs text-yellow-600">
                  <Star className="h-3 w-3 fill-current" />
                  {task.points} pts
                </div>
              )}
              {assignee ? (
                <div className="flex items-center gap-1 ml-auto">
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={assignee.avatarUrl} />
                    <AvatarFallback className="text-xs">
                      {assignee.displayName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground">
                    {assignee.displayName}
                  </span>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={onAssign}
                >
                  <User className="h-3 w-3 mr-1" />
                  Assign
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface TaskListProps {
  tasks: Task[];
  users: UserType[];
  onComplete: (taskId: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onAssign: (task: Task) => void;
}

export function TaskList({
  tasks,
  users,
  onComplete,
  onEdit,
  onDelete,
  onAssign,
}: TaskListProps) {
  const getAssignee = (assigneeId?: string) => {
    if (!assigneeId) return null;
    return users.find((u) => u.id === assigneeId) || null;
  };

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          assignee={getAssignee(task.assigneeId)}
          onComplete={() => onComplete(task.id)}
          onEdit={() => onEdit(task)}
          onDelete={() => onDelete(task.id)}
          onAssign={() => onAssign(task)}
        />
      ))}
    </div>
  );
}
