import { useState, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import {
  Check,
  Clock,
  GripVertical,
  MoreVertical,
  Pin,
  Repeat,
  Star,
  Users,
  Hand,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { AssigneePicker, type AssigneeValue } from './AssigneePicker';
import { ChoreDecayMeter } from './ChoreDecayMeter';
import { cn } from '@/lib/utils';
import type { Task, User } from '@/types/models';
import type { Group } from '@/api/groups';

interface TaskRowProps {
  task: Task;
  users: User[];
  groups: Group[];
  currentUserId: string;
  currentUserGroups: string[];
  selected: boolean;
  bulkMode: boolean;
  onToggleSelect: () => void;
  onComplete: () => void;
  onClaim: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onAssign: (value: AssigneeValue) => void;
}

function dueLabel(dueDate: string): { text: string; overdue: boolean } {
  const d = new Date(dueDate);
  const overdue = isPast(d) && !isToday(d);
  if (isToday(d)) return { text: 'Today', overdue: false };
  if (isTomorrow(d)) return { text: 'Tomorrow', overdue: false };
  return { text: format(d, 'MMM d'), overdue };
}

export function TaskRow({
  task,
  users,
  groups,
  currentUserId,
  currentUserGroups,
  selected,
  bulkMode,
  onToggleSelect,
  onComplete,
  onClaim,
  onEdit,
  onDelete,
  onTogglePin,
  onAssign,
}: TaskRowProps) {
  const sortable = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 10 : undefined,
    opacity: sortable.isDragging ? 0.5 : undefined,
  };

  // Touch swipe state — left to complete, right to snooze.
  const [swipeX, setSwipeX] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      setSwipeX(Math.max(-120, Math.min(120, dx)));
    }
  };
  const onTouchEnd = () => {
    if (swipeX < -80) onComplete();
    setSwipeX(0);
    touchStart.current = null;
  };

  const assignee = task.assigneeUserId
    ? users.find((u) => u.id === task.assigneeUserId)
    : null;
  const assigneeGroup = task.assigneeGroupId
    ? groups.find((g) => g.id === task.assigneeGroupId)
    : null;

  const isCompleted = task.status === 'completed';
  const due = task.dueDate ? dueLabel(task.dueDate) : null;
  const canClaim =
    !!task.assigneeGroupId &&
    currentUserGroups.includes(task.assigneeGroupId) &&
    task.assigneeUserId !== currentUserId;

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className="relative touch-pan-y"
    >
      {/* Swipe-action backdrop */}
      {swipeX < 0 && (
        <div className="absolute inset-y-0 right-0 flex items-center bg-success px-4 text-success-foreground rounded-r-lg">
          <Check className="h-5 w-5" />
        </div>
      )}

      <Card
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${swipeX}px)` }}
        className={cn(
          'flex items-center gap-2 p-3 transition-transform',
          isCompleted && 'opacity-60',
          selected && 'ring-2 ring-primary',
        )}
      >
        {bulkMode ? (
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        ) : (
          <button
            type="button"
            aria-label="Drag to reorder"
            className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onComplete}
          aria-label={isCompleted ? 'Mark incomplete' : 'Complete'}
          className={cn(
            'shrink-0 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors',
            isCompleted
              ? 'bg-success border-success text-success-foreground'
              : 'border-muted-foreground/30 hover:border-foreground',
          )}
        >
          {isCompleted && <Check className="h-3 w-3" />}
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onEdit}
            className="block w-full text-left"
          >
            <div className="flex items-center gap-1.5">
              {task.pinned && (
                <Pin className="h-3 w-3 fill-current text-muted-foreground shrink-0" />
              )}
              <span
                className={cn(
                  'font-medium truncate',
                  isCompleted && 'line-through text-muted-foreground',
                )}
              >
                {task.title}
              </span>
            </div>
            {task.kind === 'chore' && task.recurrenceMode === 'reset_on_complete' && (
              <div className="mt-1.5 max-w-[160px]">
                <ChoreDecayMeter
                  lastCompletedAt={task.lastCompletedAt}
                  cadenceDays={task.cadenceDays}
                />
              </div>
            )}
          </button>

          <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
            {due && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-muted-foreground',
                  due.overdue && 'text-destructive font-medium',
                )}
              >
                <Clock className="h-3 w-3" />
                {due.text}
              </span>
            )}
            {task.recurrenceMode && (
              <span className="flex items-center gap-0.5 text-muted-foreground">
                <Repeat className="h-3 w-3" />
              </span>
            )}
            {task.rewardPoints > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs gap-0.5">
                <Star className="h-3 w-3" />
                {task.rewardPoints}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canClaim && (
            <Button
              size="sm"
              variant="outline"
              onClick={onClaim}
              className="h-7 px-2 text-xs gap-1"
            >
              <Hand className="h-3 w-3" />
              Claim
            </Button>
          )}
          {!canClaim && (assignee || assigneeGroup) && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {assignee ? (
                <Avatar className="h-5 w-5">
                  <AvatarImage src={assignee.avatarUrl} />
                  <AvatarFallback className="text-[10px]">
                    {assignee.displayName?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <Users className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {assignee?.displayName ?? assigneeGroup?.name}
              </span>
            </span>
          )}
          {!canClaim && !assignee && !assigneeGroup && (
            <AssigneePicker
              users={users}
              groups={groups}
              value={{
                userId: task.assigneeUserId,
                groupId: task.assigneeGroupId,
              }}
              onChange={onAssign}
              compact
            />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Task actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem onClick={onTogglePin}>
                {task.pinned ? 'Unpin' : 'Pin to top'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
    </div>
  );
}
