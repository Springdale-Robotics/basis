import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import { AssigneePicker, type AssigneeValue } from './AssigneePicker';
import { flipRecurrenceMode } from '@/lib/taskParser';
import type { Task, User, RecurrenceMode, TaskKind } from '@/types/models';
import type { Group } from '@/api/groups';
import type { CreateTaskRequest, UpdateTaskRequest } from '@/api/tasks';

interface TaskEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  defaultKind: TaskKind;
  users: User[];
  groups: Group[];
  onCreate?: (data: CreateTaskRequest) => void;
  onUpdate?: (id: string, data: UpdateTaskRequest) => void;
  onDelete?: (id: string) => void;
  isSubmitting?: boolean;
}

type RecurrenceChoice = 'none' | RecurrenceMode;

function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

export function TaskEditDialog({
  open,
  onOpenChange,
  task,
  defaultKind,
  users,
  groups,
  onCreate,
  onUpdate,
  onDelete,
  isSubmitting,
}: TaskEditDialogProps) {
  const isEditing = !!task;
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? defaultKind);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assignee, setAssignee] = useState<AssigneeValue>({
    userId: task?.assigneeUserId,
    groupId: task?.assigneeGroupId,
  });
  const [dueDate, setDueDate] = useState(toLocalDateTime(task?.dueDate));
  const [recurrenceChoice, setRecurrenceChoice] = useState<RecurrenceChoice>(
    task?.recurrenceMode ?? 'none',
  );
  const [recurrenceRule, setRecurrenceRule] = useState(
    task?.recurrenceRule ?? 'FREQ=WEEKLY',
  );
  const [cadenceDays, setCadenceDays] = useState<number>(
    task?.cadenceDays ?? 7,
  );
  const [pinned, setPinned] = useState(task?.pinned ?? false);
  const [rewardPoints, setRewardPoints] = useState(task?.rewardPoints ?? 0);

  // Re-sync local state whenever the dialog opens with a different task.
  useEffect(() => {
    if (!open) return;
    setKind(task?.kind ?? defaultKind);
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setAssignee({
      userId: task?.assigneeUserId,
      groupId: task?.assigneeGroupId,
    });
    setDueDate(toLocalDateTime(task?.dueDate));
    setRecurrenceChoice(task?.recurrenceMode ?? 'none');
    setRecurrenceRule(task?.recurrenceRule ?? 'FREQ=WEEKLY');
    setCadenceDays(task?.cadenceDays ?? 7);
    setPinned(task?.pinned ?? false);
    setRewardPoints(task?.rewardPoints ?? 0);
  }, [open, task, defaultKind]);

  const switchRecurrence = (choice: RecurrenceChoice) => {
    // When switching between schedule and reset_on_complete, try to keep the
    // rule equivalent so the user doesn't lose their cadence.
    if (
      (recurrenceChoice === 'schedule' && choice === 'reset_on_complete') ||
      (recurrenceChoice === 'reset_on_complete' && choice === 'schedule')
    ) {
      const flipped = flipRecurrenceMode({
        mode: recurrenceChoice,
        rule: recurrenceRule,
        cadenceDays,
        matchedText: '',
        label: '',
      });
      if (flipped?.mode === 'schedule' && flipped.rule) {
        setRecurrenceRule(flipped.rule);
      } else if (flipped?.mode === 'reset_on_complete' && flipped.cadenceDays) {
        setCadenceDays(flipped.cadenceDays);
      }
    }
    setRecurrenceChoice(choice);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const payload: CreateTaskRequest = {
      kind,
      title: trimmed,
      description: description.trim() || undefined,
      assigneeUserId: assignee.userId ?? null,
      assigneeGroupId: assignee.groupId ?? null,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      pinned,
      rewardPoints: Number(rewardPoints) || 0,
      recurrenceMode: recurrenceChoice === 'none' ? null : recurrenceChoice,
      recurrenceRule:
        recurrenceChoice === 'schedule' ? recurrenceRule : null,
      cadenceDays:
        recurrenceChoice === 'reset_on_complete' ? cadenceDays : null,
    };

    if (isEditing && task && onUpdate) {
      onUpdate(task.id, payload);
    } else if (onCreate) {
      onCreate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? `Edit ${task?.kind === 'chore' ? 'chore' : 'task'}`
              : `New ${kind === 'chore' ? 'chore' : 'task'}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isEditing && (
            <div className="flex gap-2 rounded-md bg-muted p-1">
              {(['task', 'chore'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded px-3 py-1 text-sm capitalize transition-colors ${
                    kind === k
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder={
                kind === 'chore' ? 'Take out trash' : 'Renew passport'
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Notes (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Assign to</Label>
              <AssigneePicker
                users={users}
                groups={groups}
                value={assignee}
                onChange={setAssignee}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">
                {kind === 'chore' ? 'Next due' : 'Due'}
              </Label>
              <Input
                id="dueDate"
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <Label>Repeat</Label>
            <RadioGroup
              value={recurrenceChoice}
              onValueChange={(v) => switchRecurrence(v as RecurrenceChoice)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="none" id="rec-none" />
                <Label htmlFor="rec-none" className="font-normal cursor-pointer">
                  Doesn't repeat
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="schedule" id="rec-schedule" />
                <div className="flex-1">
                  <Label
                    htmlFor="rec-schedule"
                    className="font-normal cursor-pointer"
                  >
                    Repeats on a schedule
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    e.g. every Tuesday — next due stays fixed regardless of when
                    you complete it.
                  </p>
                  {recurrenceChoice === 'schedule' && (
                    <Input
                      value={recurrenceRule}
                      onChange={(e) => setRecurrenceRule(e.target.value)}
                      placeholder="FREQ=WEEKLY;BYDAY=TU"
                      className="mt-2 font-mono text-xs"
                    />
                  )}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value="reset_on_complete"
                  id="rec-reset"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="rec-reset"
                    className="font-normal cursor-pointer"
                  >
                    Repeats N days after I complete it
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    e.g. take out trash every 3 days — clock resets each time
                    you finish it.
                  </p>
                  {recurrenceChoice === 'reset_on_complete' && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Every
                      </span>
                      <Input
                        type="number"
                        min={1}
                        value={cadenceDays}
                        onChange={(e) =>
                          setCadenceDays(Math.max(1, Number(e.target.value)))
                        }
                        className="w-20"
                      />
                      <span className="text-sm text-muted-foreground">
                        day{cadenceDays === 1 ? '' : 's'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="pinned" className="cursor-pointer">
                Pin to top
              </Label>
              <Switch id="pinned" checked={pinned} onCheckedChange={setPinned} />
            </div>
            <div className="space-y-1 rounded-md border p-3">
              <Label htmlFor="points" className="text-xs">
                Reward points
              </Label>
              <Input
                id="points"
                type="number"
                min={0}
                value={rewardPoints}
                onChange={(e) => setRewardPoints(Number(e.target.value))}
                className="h-8"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {isEditing && onDelete ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => task && onDelete(task.id)}
              disabled={isSubmitting}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={!title.trim() || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save' : 'Create'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
