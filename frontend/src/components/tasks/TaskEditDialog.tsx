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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AssigneePicker, type AssigneeValue } from './AssigneePicker';
import { cn } from '@/lib/utils';
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
type ScheduleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const WEEKDAYS: { code: string; label: string }[] = [
  { code: 'SU', label: 'S' },
  { code: 'MO', label: 'M' },
  { code: 'TU', label: 'T' },
  { code: 'WE', label: 'W' },
  { code: 'TH', label: 'T' },
  { code: 'FR', label: 'F' },
  { code: 'SA', label: 'S' },
];

function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
}

// Parse an RRULE string into pickable parts. Returns sensible defaults on
// unparseable input.
function parseRule(rule: string | null | undefined): {
  freq: ScheduleFreq;
  interval: number;
  byday: string[];
} {
  const fallback = { freq: 'WEEKLY' as ScheduleFreq, interval: 1, byday: [] as string[] };
  if (!rule) return fallback;
  const m = rule.match(/FREQ=(\w+)(?:;INTERVAL=(\d+))?(?:;BYDAY=([\w,]+))?/);
  if (!m) return fallback;
  const freq = m[1] as ScheduleFreq;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return fallback;
  return {
    freq,
    interval: m[2] ? Math.max(1, parseInt(m[2], 10)) : 1,
    byday: m[3] ? m[3].split(',') : [],
  };
}

function buildRule(
  freq: ScheduleFreq,
  interval: number,
  byday: string[],
): string {
  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (freq === 'WEEKLY' && byday.length > 0) {
    // Sort to keep RRULE deterministic: SU, MO, TU, WE, TH, FR, SA.
    const order = WEEKDAYS.map((w) => w.code);
    const sorted = [...byday].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    parts.push(`BYDAY=${sorted.join(',')}`);
  }
  return parts.join(';');
}

// Default time helper: returns today at 9am as an ISO datetime-local string.
// Used as a polite default for new tasks where the user hasn't picked a time.
function defaultDateTimeLocal(): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return format(d, "yyyy-MM-dd'T'HH:mm");
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
  const [scheduleFreq, setScheduleFreq] = useState<ScheduleFreq>('WEEKLY');
  const [scheduleInterval, setScheduleInterval] = useState<number>(1);
  const [scheduleByDay, setScheduleByDay] = useState<string[]>([]);
  const [cadenceDays, setCadenceDays] = useState<number>(task?.cadenceDays ?? 7);
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
    const parsed = parseRule(task?.recurrenceRule);
    setScheduleFreq(parsed.freq);
    setScheduleInterval(parsed.interval);
    setScheduleByDay(parsed.byday);
    setCadenceDays(task?.cadenceDays ?? 7);
    setPinned(task?.pinned ?? false);
    setRewardPoints(task?.rewardPoints ?? 0);
  }, [open, task, defaultKind]);

  const toggleByDay = (code: string) => {
    setScheduleByDay((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    let finalRule: string | null = null;
    let finalCadence: number | null = null;
    if (recurrenceChoice === 'schedule') {
      finalRule = buildRule(scheduleFreq, scheduleInterval, scheduleByDay);
    } else if (recurrenceChoice === 'reset_on_complete') {
      finalCadence = Math.max(1, cadenceDays);
    }

    const payload: CreateTaskRequest = {
      kind,
      title: trimmed,
      description: description.trim() || undefined,
      assigneeUserId: assignee.userId ?? null,
      assigneeGroupId: assignee.groupId ?? null,
      // For new chores that recur but have no due date, seed with today 9am so
      // the first occurrence is visible.
      dueDate: dueDate
        ? new Date(dueDate).toISOString()
        : !isEditing && recurrenceChoice !== 'none'
        ? new Date(defaultDateTimeLocal()).toISOString()
        : null,
      pinned,
      rewardPoints: Number(rewardPoints) || 0,
      recurrenceMode: recurrenceChoice === 'none' ? null : recurrenceChoice,
      recurrenceRule: finalRule,
      cadenceDays: finalCadence,
    };

    if (isEditing && task && onUpdate) {
      onUpdate(task.id, payload);
    } else if (onCreate) {
      onCreate(payload);
    }
  };

  const unit = (singular: string) =>
    scheduleInterval === 1 ? singular : `${singular}s`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
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
                  className={cn(
                    'flex-1 rounded px-3 py-1 text-sm capitalize transition-colors',
                    kind === k
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div className="flex gap-1">
                <Input
                  id="dueDate"
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {dueDate && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDueDate('')}
                    aria-label="Clear due date"
                  >
                    Clear
                  </Button>
                )}
              </div>
              {!dueDate && (
                <button
                  type="button"
                  onClick={() => setDueDate(defaultDateTimeLocal())}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  Set to today 9:00 AM
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <Label>Repeat</Label>
            <RadioGroup
              value={recurrenceChoice}
              onValueChange={(v) => setRecurrenceChoice(v as RecurrenceChoice)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="none" id="rec-none" />
                <Label htmlFor="rec-none" className="font-normal cursor-pointer">
                  Doesn't repeat
                </Label>
              </div>

              {/* Schedule mode */}
              <div className="flex items-start gap-2">
                <RadioGroupItem value="schedule" id="rec-schedule" />
                <div className="flex-1 space-y-2">
                  <Label
                    htmlFor="rec-schedule"
                    className="font-normal cursor-pointer"
                  >
                    Repeats on a schedule
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Calendar-anchored — next due stays fixed regardless of when
                    you complete it.
                  </p>
                  {recurrenceChoice === 'schedule' && (
                    <div className="space-y-3 pt-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>Every</span>
                        <Input
                          type="number"
                          min={1}
                          value={scheduleInterval}
                          onChange={(e) =>
                            setScheduleInterval(
                              Math.max(1, Number(e.target.value)),
                            )
                          }
                          className="h-8 w-16"
                        />
                        <div className="flex rounded-md border bg-card p-0.5">
                          {(
                            [
                              ['DAILY', 'day'],
                              ['WEEKLY', 'week'],
                              ['MONTHLY', 'month'],
                              ['YEARLY', 'year'],
                            ] as const
                          ).map(([f, singular]) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setScheduleFreq(f)}
                              className={cn(
                                'h-7 px-2 text-xs rounded transition-colors',
                                scheduleFreq === f
                                  ? 'bg-secondary text-secondary-foreground'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              {unit(singular)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {scheduleFreq === 'WEEKLY' && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">
                            On these days (leave empty for any day):
                          </p>
                          <div className="flex gap-1">
                            {WEEKDAYS.map((w) => (
                              <button
                                key={w.code}
                                type="button"
                                onClick={() => toggleByDay(w.code)}
                                className={cn(
                                  'h-8 w-8 rounded-full text-xs font-medium border transition-colors',
                                  scheduleByDay.includes(w.code)
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'border-input text-muted-foreground hover:border-foreground hover:text-foreground',
                                )}
                                aria-pressed={scheduleByDay.includes(w.code)}
                                aria-label={w.code}
                              >
                                {w.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Reset-on-complete mode */}
              <div className="flex items-start gap-2">
                <RadioGroupItem value="reset_on_complete" id="rec-reset" />
                <div className="flex-1 space-y-2">
                  <Label
                    htmlFor="rec-reset"
                    className="font-normal cursor-pointer"
                  >
                    Repeats N days after I complete it
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Forgiving — the clock resets each time you finish it.
                  </p>
                  {recurrenceChoice === 'reset_on_complete' && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-sm">Every</span>
                      <Input
                        type="number"
                        min={1}
                        value={cadenceDays}
                        onChange={(e) =>
                          setCadenceDays(Math.max(1, Number(e.target.value)))
                        }
                        className="h-8 w-16"
                      />
                      <span className="text-sm">
                        day{cadenceDays === 1 ? '' : 's'} after completion
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="pinned" className="cursor-pointer">
                Pin to top
              </Label>
              <Switch
                id="pinned"
                checked={pinned}
                onCheckedChange={setPinned}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3 gap-3">
              <Label htmlFor="points">Reward points</Label>
              <Input
                id="points"
                type="number"
                min={0}
                value={rewardPoints}
                onChange={(e) => setRewardPoints(Number(e.target.value))}
                className="h-8 w-20"
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
