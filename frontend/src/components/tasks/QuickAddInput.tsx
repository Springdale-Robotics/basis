import { useMemo, useState, useRef, useEffect } from 'react';
import { Calendar, Repeat, Plus, X, User as UserIcon, Users } from 'lucide-react';
import { format, isToday, isTomorrow } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  parseTaskInput,
  flipRecurrenceMode,
  type DateSuggestion,
  type RecurrenceSuggestion,
  type AssigneeSuggestion,
  type AssigneeCandidate,
} from '@/lib/taskParser';
import { AssigneePicker, type AssigneeValue } from './AssigneePicker';
import type { CreateTaskRequest } from '@/api/tasks';
import type { TaskKind, User } from '@/types/models';
import type { Group } from '@/api/groups';

interface QuickAddInputProps {
  kind: TaskKind;
  users: User[];
  groups: Group[];
  currentUserId?: string;
  onSubmit: (data: CreateTaskRequest) => void;
  isSubmitting?: boolean;
  autoFocus?: boolean;
}

function formatDateChip(d: Date, hasTime: boolean): string {
  if (isToday(d)) return hasTime ? `Today ${format(d, 'h:mma')}` : 'Today';
  if (isTomorrow(d)) return hasTime ? `Tomorrow ${format(d, 'h:mma')}` : 'Tomorrow';
  return hasTime ? format(d, 'MMM d h:mma') : format(d, 'MMM d');
}

export function QuickAddInput({
  kind,
  users,
  groups,
  currentUserId,
  onSubmit,
  isSubmitting,
  autoFocus,
}: QuickAddInputProps) {
  const [title, setTitle] = useState('');
  const [recurrenceOverride, setRecurrenceOverride] =
    useState<RecurrenceSuggestion | null>(null);
  const [dateDismissed, setDateDismissed] = useState(false);
  const [recurrenceDismissed, setRecurrenceDismissed] = useState(false);
  // Sensible default: tasks go to the current user; chores stay unassigned
  // (anyone in the house can pick them up).
  const defaultAssignee: AssigneeValue =
    kind === 'task' && currentUserId
      ? { userId: currentUserId, groupId: null }
      : { userId: null, groupId: null };
  const [assigneeOverride, setAssigneeOverride] =
    useState<AssigneeValue | null>(null);
  const [assigneeDismissed, setAssigneeDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Reset assignee override when kind changes (default flips between
  // current-user and unassigned).
  useEffect(() => {
    setAssigneeOverride(null);
  }, [kind]);

  // Candidates for assignee detection. Groups first so an "@kids" wins
  // over a user named "Kid…".
  const candidates: AssigneeCandidate[] = useMemo(
    () => [
      ...groups.map((g) => ({ kind: 'group' as const, id: g.id, name: g.name })),
      ...users.map((u) => ({
        kind: 'user' as const,
        id: u.id,
        name: u.displayName ?? '',
      })),
    ],
    [users, groups],
  );

  const parsed = useMemo(
    () => parseTaskInput(title, undefined, candidates),
    [title, candidates],
  );

  const effectiveDate: DateSuggestion | null = dateDismissed
    ? null
    : parsed.date ?? null;
  const effectiveRecurrence: RecurrenceSuggestion | null =
    recurrenceOverride ??
    (recurrenceDismissed ? null : parsed.recurrence ?? null);

  // Effective assignee priority:
  //   1. explicit override from the inline picker
  //   2. parser-detected assignee (unless user dismissed)
  //   3. sensible default (current user for tasks)
  const parsedAssignee: AssigneeValue | null = parsed.assignee
    ? parsed.assignee.kind === 'user'
      ? { userId: parsed.assignee.id, groupId: null }
      : { userId: null, groupId: parsed.assignee.id }
    : null;
  const effectiveAssignee: AssigneeValue =
    assigneeOverride ??
    (parsedAssignee && !assigneeDismissed ? parsedAssignee : defaultAssignee);

  const assigneeFromParser = !assigneeOverride && !assigneeDismissed && !!parsedAssignee;

  const reset = () => {
    setTitle('');
    setRecurrenceOverride(null);
    setDateDismissed(false);
    setRecurrenceDismissed(false);
    setAssigneeOverride(null);
    setAssigneeDismissed(false);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const payload: CreateTaskRequest = {
      kind,
      title: trimmed,
      assigneeUserId: effectiveAssignee.userId ?? null,
      assigneeGroupId: effectiveAssignee.groupId ?? null,
    };
    if (effectiveDate) payload.dueDate = effectiveDate.dueDate.toISOString();
    if (effectiveRecurrence) {
      payload.recurrenceMode = effectiveRecurrence.mode;
      if (effectiveRecurrence.mode === 'schedule') {
        payload.recurrenceRule = effectiveRecurrence.rule;
      } else {
        payload.cadenceDays = effectiveRecurrence.cadenceDays;
      }
    }
    onSubmit(payload);
    reset();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      reset();
      inputRef.current?.blur();
    }
  };

  // Resolve names for chip display.
  const assigneeUser = effectiveAssignee.userId
    ? users.find((u) => u.id === effectiveAssignee.userId)
    : null;
  const assigneeGroup = effectiveAssignee.groupId
    ? groups.find((g) => g.id === effectiveAssignee.groupId)
    : null;

  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            kind === 'chore'
              ? 'Add a chore… (try "Take out trash every Tuesday")'
              : 'Add a task… (try "Renew passport by Mar 12 @kids")'
          }
          className="min-w-0 flex-1 border-0 shadow-none focus-visible:ring-0 px-1"
          disabled={isSubmitting}
        />
        <AssigneePicker
          users={users}
          groups={groups}
          value={effectiveAssignee}
          onChange={(v) => {
            setAssigneeOverride(v);
            setAssigneeDismissed(false);
          }}
          compact
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={!title.trim() || isSubmitting}
        >
          Add
        </Button>
      </div>

      {(effectiveDate || effectiveRecurrence || assigneeFromParser) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
          {effectiveDate && (
            <Badge
              variant="default"
              className="gap-1 pl-2 pr-1 py-0.5 cursor-default"
            >
              <Calendar className="h-3 w-3" />
              {formatDateChip(effectiveDate.dueDate, effectiveDate.hasTime)}
              <button
                type="button"
                onClick={() => setDateDismissed(true)}
                className="ml-0.5 rounded-sm hover:bg-foreground/20 p-0.5"
                aria-label="Don't use this date"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {effectiveRecurrence && (
            <Badge
              variant="default"
              className="gap-1 pl-2 pr-1 py-0.5 cursor-default"
            >
              <Repeat className="h-3 w-3" />
              {effectiveRecurrence.label}
              {flipRecurrenceMode(effectiveRecurrence) && (
                <button
                  type="button"
                  onClick={() => {
                    const flipped = flipRecurrenceMode(effectiveRecurrence);
                    if (flipped) setRecurrenceOverride(flipped);
                  }}
                  className="ml-1 rounded-sm bg-background/30 px-1 text-[10px] hover:bg-background/50"
                  aria-label="Toggle recurrence mode"
                >
                  flip
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRecurrenceOverride(null);
                  setRecurrenceDismissed(true);
                }}
                className="ml-0.5 rounded-sm hover:bg-foreground/20 p-0.5"
                aria-label="Don't repeat"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {assigneeFromParser && (assigneeUser || assigneeGroup) && (
            <Badge
              variant="default"
              className="gap-1 pl-2 pr-1 py-0.5 cursor-default"
            >
              {assigneeUser ? (
                <UserIcon className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              {assigneeUser?.displayName ?? assigneeGroup?.name}
              <button
                type="button"
                onClick={() => {
                  setAssigneeDismissed(true);
                  setAssigneeOverride(null);
                }}
                className="ml-0.5 rounded-sm hover:bg-foreground/20 p-0.5"
                aria-label="Don't auto-assign"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
