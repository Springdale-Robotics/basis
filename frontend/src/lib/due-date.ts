import { format, isPast, isToday, isTomorrow } from 'date-fns';

export interface FormatDueDateOptions {
  /** Use lowercase 'today'/'tomorrow' for mid-sentence copy. */
  lowercase?: boolean;
  /** Append the time (h:mma) to the label. */
  withTime?: boolean;
}

/**
 * Human label for a due date: Today, Tomorrow, or a short date
 * (with the year when it falls outside the current year).
 */
export function formatDueDate(
  dueDate: string | Date,
  options: FormatDueDateOptions = {},
): string {
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const { lowercase = false, withTime = false } = options;
  const time = withTime ? ` ${format(d, 'h:mma')}` : '';

  if (isToday(d)) return (lowercase ? 'today' : 'Today') + time;
  if (isTomorrow(d)) return (lowercase ? 'tomorrow' : 'Tomorrow') + time;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? 'MMM d' : 'MMM d, yyyy') + time;
}

/** A due date counts as overdue once it is in the past and not today. */
export function isDueDateOverdue(dueDate: string | Date): boolean {
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  return isPast(d) && !isToday(d);
}
