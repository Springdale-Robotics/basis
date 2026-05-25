import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { resolveEventColor, isSameDay, startOfDay } from './calendar-utils';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  colorPalette: string;
  onEventClick: (event: CalendarEvent) => void;
  onSlotDoubleClick: (date: Date) => void;
  onEventDrop?: (event: CalendarEvent, newDay: Date) => void;
}

// Single horizontal event bar (single-day or a segment of a multi-day event).
function EventBar({
  event,
  color,
  rounded,
  continuesLeft,
  continuesRight,
  onClick,
  onDragStart,
}: {
  event: CalendarEvent;
  color: string;
  rounded: 'left' | 'right' | 'both' | 'none';
  continuesLeft?: boolean;
  continuesRight?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const rounding =
    rounded === 'both'
      ? 'rounded-md'
      : rounded === 'left'
      ? 'rounded-l-md'
      : rounded === 'right'
      ? 'rounded-r-md'
      : '';

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      className={cn(
        'h-[20px] truncate px-2 text-xs font-semibold leading-[20px] cursor-pointer transition-all duration-200 hover:shadow-md border',
        rounding,
      )}
      style={{
        backgroundColor: `${color}35`,
        color,
        borderColor: `${color}50`,
        borderLeftWidth: continuesLeft ? 0 : 1,
        borderRightWidth: continuesRight ? 0 : 1,
      }}
      onClick={onClick}
      title={event.title}
    >
      {!continuesLeft ? event.title : ' '}
    </div>
  );
}

interface WeekRowSegment {
  event: CalendarEvent;
  startCol: number; // 0-6 inclusive
  endCol: number; // 0-6 inclusive
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

// A "multi-day" event in month view is any event that spans more than one day
// (start day != end day). Timed single-day events render inside the day cell;
// multi-day events render as a continuous bar overlay across the week row.
function isMultiDay(event: CalendarEvent): boolean {
  const start = startOfDay(new Date(event.startTime));
  const end = startOfDay(new Date(event.endTime));
  return end.getTime() > start.getTime();
}

function layoutWeekRow(weekDays: Date[], events: CalendarEvent[]): WeekRowSegment[] {
  const weekStart = startOfDay(weekDays[0]);
  const weekEnd = startOfDay(weekDays[6]);

  const segments: Omit<WeekRowSegment, 'lane'>[] = [];

  for (const event of events) {
    if (!isMultiDay(event)) continue;

    const evStart = startOfDay(new Date(event.startTime));
    const evEnd = startOfDay(new Date(event.endTime));

    // No overlap with this week?
    if (evEnd.getTime() < weekStart.getTime()) continue;
    if (evStart.getTime() > weekEnd.getTime()) continue;

    const startCol = Math.max(
      0,
      Math.floor((evStart.getTime() - weekStart.getTime()) / (24 * 3600 * 1000)),
    );
    const endCol = Math.min(
      6,
      Math.floor((evEnd.getTime() - weekStart.getTime()) / (24 * 3600 * 1000)),
    );

    segments.push({
      event,
      startCol,
      endCol,
      continuesLeft: evStart.getTime() < weekStart.getTime(),
      continuesRight: evEnd.getTime() > weekEnd.getTime(),
    });
  }

  // Sort by start col so we lane them left-to-right.
  segments.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return b.endCol - b.startCol - (a.endCol - a.startCol);
  });

  // Assign lanes: lowest free lane that doesn't overlap any prior segment.
  const laneEnds: number[] = [];
  const result: WeekRowSegment[] = [];
  for (const seg of segments) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= seg.startCol) lane += 1;
    laneEnds[lane] = seg.endCol;
    result.push({ ...seg, lane });
  }
  return result;
}

export function MonthView({
  currentDate,
  events,
  calendars,
  colorPalette,
  onEventClick,
  onSlotDoubleClick,
  onEventDrop,
}: MonthViewProps) {
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // Build a 6-week grid (always show 6 rows, like Google Calendar).
  const weeks = useMemo<Date[][]>(() => {
    const first = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    const out: Date[][] = [];
    for (let w = 0; w < 6; w += 1) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d += 1) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + d);
        row.push(day);
      }
      out.push(row);
    }
    return out;
  }, [currentDate]);

  const today = new Date();

  const handleDragStart = (event: CalendarEvent) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', event.id);
    (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent = event;
  };

  const handleDayDrop = (day: Date) => (e: React.DragEvent) => {
    e.preventDefault();
    const dragged = (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent;
    if (dragged && onEventDrop) onEventDrop(dragged, day);
    (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent = undefined;
    setDragOverDay(null);
  };

  return (
    <div>
      {/* Day-of-week headers */}
      <div className="mb-2 grid grid-cols-7 gap-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-3 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="space-y-1">
        {weeks.map((week, wi) => {
          const segments = layoutWeekRow(week, events);
          const laneCount = segments.reduce((m, s) => Math.max(m, s.lane + 1), 0);
          // Reserve 22px per multi-day lane (20px bar + 2px gap).
          const reservedTop = laneCount * 22;

          return (
            <div key={wi} className="relative grid grid-cols-7 gap-1">
              {week.map((day) => {
                const inMonth = day.getMonth() === currentDate.getMonth();
                const today_ = isSameDay(day, today);
                const dayKey = day.toISOString();
                const dayCol = getColForDay(week, day);

                // Per-cell single-day events.
                const singleDayEvents = events.filter((e) => {
                  if (isMultiDay(e)) return false;
                  return isSameDay(new Date(e.startTime), day);
                });

                // Multi-day events that touch this day (visible as bars).
                const multiDayForDay = segments
                  .filter((s) => s.startCol <= dayCol && s.endCol >= dayCol)
                  .map((s) => s.event);

                // All events touching this day, sorted by start time, for the
                // overflow popover.
                const allDayEvents = [...multiDayForDay, ...singleDayEvents].sort(
                  (a, b) =>
                    new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
                );

                const remainingSlots = Math.max(0, 3 - multiDayForDay.length);
                const visibleSingles = singleDayEvents.slice(0, remainingSlots);
                const hiddenCount =
                  singleDayEvents.length - visibleSingles.length;

                return (
                  <div
                    key={dayKey}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverDay(dayKey);
                    }}
                    onDragLeave={() => setDragOverDay((cur) => (cur === dayKey ? null : cur))}
                    onDrop={handleDayDrop(day)}
                    className={cn(
                      'min-h-28 rounded-xl p-2 transition-all duration-200 border',
                      inMonth
                        ? 'bg-card border-border'
                        : 'bg-muted/50 border-transparent text-muted-foreground',
                      today_ && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                      dragOverDay === dayKey && 'ring-2 ring-primary',
                    )}
                    onDoubleClick={() => {
                      if (inMonth) {
                        const clicked = new Date(
                          day.getFullYear(),
                          day.getMonth(),
                          day.getDate(),
                          9,
                          0,
                          0,
                        );
                        onSlotDoubleClick(clicked);
                      }
                    }}
                  >
                    <span
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                        today_
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-foreground hover:bg-muted',
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {/* Spacer for multi-day bars rendered in overlay */}
                    <div style={{ height: reservedTop }} className="mt-2" />
                    {/* Single-day events */}
                    <div className="space-y-1">
                      {visibleSingles.map((event) => {
                        const color = resolveEventColor(event, calendars, colorPalette);
                        return (
                          <EventBar
                            key={event.id}
                            event={event}
                            color={color}
                            rounded="both"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEventClick(event);
                            }}
                            onDragStart={onEventDrop ? handleDragStart(event) : undefined}
                          />
                        );
                      })}
                      {hiddenCount > 0 && (
                        <DayMorePopover
                          day={day}
                          events={allDayEvents}
                          calendars={calendars}
                          colorPalette={colorPalette}
                          onEventClick={onEventClick}
                          hiddenCount={hiddenCount}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Multi-day overlay — absolute over the week row */}
              {laneCount > 0 && (
                <div className="pointer-events-none absolute inset-0">
                  {segments.map((seg, idx) => {
                    const color = resolveEventColor(seg.event, calendars, colorPalette);
                    // Cell: 8px padding + 32px day-number + 8px margin = 48px.
                    const topOffset = 48 + seg.lane * 22;
                    const leftPct = (seg.startCol / 7) * 100;
                    const widthPct = ((seg.endCol - seg.startCol + 1) / 7) * 100;
                    return (
                      <div
                        key={`${seg.event.id}-${idx}`}
                        className="absolute pointer-events-auto px-1"
                        style={{
                          top: topOffset,
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                      >
                        <EventBar
                          event={seg.event}
                          color={color}
                          rounded={
                            !seg.continuesLeft && !seg.continuesRight
                              ? 'both'
                              : !seg.continuesLeft
                              ? 'left'
                              : !seg.continuesRight
                              ? 'right'
                              : 'none'
                          }
                          continuesLeft={seg.continuesLeft}
                          continuesRight={seg.continuesRight}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick(seg.event);
                          }}
                          onDragStart={onEventDrop ? handleDragStart(seg.event) : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getColForDay(week: Date[], day: Date): number {
  for (let i = 0; i < week.length; i += 1) {
    if (isSameDay(week[i], day)) return i;
  }
  return -1;
}

function DayMorePopover({
  day,
  events,
  calendars,
  colorPalette,
  onEventClick,
  hiddenCount,
}: {
  day: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  colorPalette: string;
  onEventClick: (event: CalendarEvent) => void;
  hiddenCount: number;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline px-1"
          onClick={(e) => e.stopPropagation()}
        >
          +{hiddenCount} more
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-sm font-semibold">
          {format(day, 'EEEE, MMMM d')}
        </div>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {events.map((event) => {
            const color = resolveEventColor(event, calendars, colorPalette);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onEventClick(event)}
                className="w-full text-left rounded-md px-2 py-1.5 text-xs font-semibold transition-all hover:shadow-sm border"
                style={{
                  backgroundColor: `${color}35`,
                  color,
                  borderColor: `${color}50`,
                }}
              >
                <div className="truncate">{event.title}</div>
                {!event.allDay && (
                  <div className="text-[10px] opacity-80 mt-0.5">
                    {format(new Date(event.startTime), 'h:mm a')}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
