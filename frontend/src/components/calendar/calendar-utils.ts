import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';
import { getColorForIndex, type ColorPalette } from '@/lib/theme-presets';

const DEFAULT_COLOR = '#4A90D9';

export function resolveEventColor(
  event: CalendarEvent,
  calendars: CalendarType[],
  colorPalette: string,
): string {
  if (event.color) return event.color;
  const calendar = calendars.find((c) => c.id === event.calendarId);
  if (calendar?.colorIndex !== undefined && calendar.colorIndex >= 0) {
    return getColorForIndex(colorPalette as ColorPalette, calendar.colorIndex);
  }
  return calendar?.color || DEFAULT_COLOR;
}

export function resolveCalendarColor(
  calendar: CalendarType,
  colorPalette: string,
): string {
  if (calendar.colorIndex !== undefined && calendar.colorIndex >= 0) {
    return getColorForIndex(colorPalette as ColorPalette, calendar.colorIndex);
  }
  return calendar.color || DEFAULT_COLOR;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

// Subtle dim band for "night" hours (before 6am, after 9pm).
export function getTimeSlotBg(hour: number): string {
  if (hour < 6 || hour >= 21) return 'bg-muted/50';
  return 'bg-card';
}

export function eventTouchesDay(event: CalendarEvent, day: Date): boolean {
  const start = startOfDay(new Date(event.startTime));
  const end = startOfDay(new Date(event.endTime));
  const target = startOfDay(day);
  return target.getTime() >= start.getTime() && target.getTime() <= end.getTime();
}

// Layout an array of time-based events into non-overlapping columns. Returns
// each event's column index plus the total column count for that overlap
// cluster, so callers can size them as 1/cols of the day column width.
export interface LaidOutEvent {
  event: CalendarEvent;
  column: number;
  columns: number;
}

export function layoutTimedEvents(events: CalendarEvent[]): LaidOutEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => {
    const aStart = new Date(a.startTime).getTime();
    const bStart = new Date(b.startTime).getTime();
    if (aStart !== bStart) return aStart - bStart;
    return new Date(b.endTime).getTime() - new Date(a.endTime).getTime();
  });

  type Placed = { event: CalendarEvent; start: number; end: number; column: number };
  const out: LaidOutEvent[] = [];
  let cluster: Placed[] = [];

  const flush = () => {
    if (cluster.length === 0) return;
    const columns = Math.max(...cluster.map((c) => c.column)) + 1;
    for (const c of cluster) {
      out.push({ event: c.event, column: c.column, columns });
    }
    cluster = [];
  };

  for (const e of sorted) {
    const start = new Date(e.startTime).getTime();
    const end = new Date(e.endTime).getTime();

    // If this event starts after every event in the cluster ends, flush.
    const clusterMaxEnd = cluster.reduce((m, c) => Math.max(m, c.end), 0);
    if (cluster.length > 0 && start >= clusterMaxEnd) {
      flush();
    }

    // Find the lowest column index not used by any still-overlapping event.
    const used = new Set(cluster.filter((c) => c.end > start).map((c) => c.column));
    let column = 0;
    while (used.has(column)) column += 1;

    cluster.push({ event: e, start, end, column });
  }

  flush();
  return out;
}
