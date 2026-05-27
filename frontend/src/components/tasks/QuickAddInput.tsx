import { useMemo, useState, useRef, useEffect } from 'react';
import { Calendar, Repeat, Plus, X } from 'lucide-react';
import { format, isToday, isTomorrow } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  parseTaskInput,
  flipRecurrenceMode,
  type DateSuggestion,
  type RecurrenceSuggestion,
} from '@/lib/taskParser';
import type { CreateTaskRequest } from '@/api/tasks';
import type { TaskKind } from '@/types/models';

interface QuickAddInputProps {
  kind: TaskKind;
  onSubmit: (data: CreateTaskRequest) => void;
  isSubmitting?: boolean;
  /** Optional autofocus on mount (e.g. when user presses N keyboard shortcut). */
  autoFocus?: boolean;
}

function formatDateChip(d: Date, hasTime: boolean): string {
  if (isToday(d)) return hasTime ? `Today ${format(d, 'h:mma')}` : 'Today';
  if (isTomorrow(d)) return hasTime ? `Tomorrow ${format(d, 'h:mma')}` : 'Tomorrow';
  return hasTime ? format(d, 'MMM d h:mma') : format(d, 'MMM d');
}

export function QuickAddInput({
  kind,
  onSubmit,
  isSubmitting,
  autoFocus,
}: QuickAddInputProps) {
  const [title, setTitle] = useState('');
  // `null` means "use whatever the parser detected." A non-null value is a
  // user-edited override (e.g. flipped recurrence mode). `dismissed` means the
  // user clicked X to suppress the parser's suggestion entirely.
  const [recurrenceOverride, setRecurrenceOverride] =
    useState<RecurrenceSuggestion | null>(null);
  const [dateDismissed, setDateDismissed] = useState(false);
  const [recurrenceDismissed, setRecurrenceDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Detect suggestions on every keystroke.
  const parsed = useMemo(() => parseTaskInput(title), [title]);

  // Effective values used at submit and shown in the chip row. The parser's
  // output applies by default; the user opts out via the X button.
  const effectiveDate: DateSuggestion | null = dateDismissed
    ? null
    : parsed.date ?? null;
  const effectiveRecurrence: RecurrenceSuggestion | null =
    recurrenceOverride ??
    (recurrenceDismissed ? null : parsed.recurrence ?? null);

  const reset = () => {
    setTitle('');
    setRecurrenceOverride(null);
    setDateDismissed(false);
    setRecurrenceDismissed(false);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const payload: CreateTaskRequest = {
      kind,
      title: trimmed,
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
              : 'Add a task… (try "Renew passport by Mar 12")'
          }
          className="min-w-0 flex-1 border-0 shadow-none focus-visible:ring-0 px-1"
          disabled={isSubmitting}
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={!title.trim() || isSubmitting}
        >
          Add
        </Button>
      </div>

      {(effectiveDate || effectiveRecurrence) && (
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
        </div>
      )}
    </div>
  );
}
