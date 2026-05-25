import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  resolveEventColor,
  isSameDay,
  formatHour,
  getTimeSlotBg,
  layoutTimedEvents,
} from './calendar-utils';
import type { CalendarEvent, Calendar as CalendarType } from '@/types/models';

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  colorPalette: string;
  onEventClick: (event: CalendarEvent) => void;
  onSlotDoubleClick: (date: Date) => void;
  onEventDrop?: (event: CalendarEvent, newStart: Date) => void;
}

const HOUR_HEIGHT = 56; // px per hour — matches min-h-14 from the original
const TIME_COL_WIDTH = 64; // px

export function WeekView({
  currentDate,
  events,
  calendars,
  colorPalette,
  onEventClick,
  onSlotDoubleClick,
  onEventDrop,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const [dragTarget, setDragTarget] = useState<{ dayIdx: number; minute: number } | null>(null);

  // Tick the now-indicator every minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll to 1 hour before current time on mount.
  useEffect(() => {
    if (!scrollRef.current) return;
    const target = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
    scrollRef.current.scrollTop = target;
    // Run on mount only; navigating between weeks shouldn't snap back to now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(() => {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      return d;
    });
  }, [currentDate]);

  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const eventsByDay = useMemo(() => {
    return days.map((day) => events.filter((e) => isSameDay(new Date(e.startTime), day)));
  }, [days, events]);

  const hasAllDay = eventsByDay.some((es) => es.some((e) => e.allDay));

  const handleDragStart = (event: CalendarEvent) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', event.id);
    (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent = event;
  };

  const handleColumnDragOver = (dayIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minute = Math.max(0, Math.min(24 * 60 - 1, Math.round((y / HOUR_HEIGHT) * 60 / 15) * 15));
    setDragTarget({ dayIdx, minute });
  };

  const handleColumnDrop = (dayIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const dragged = (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent;
    if (dragged && onEventDrop && dragTarget) {
      const day = days[dayIdx];
      const newStart = new Date(day);
      newStart.setHours(Math.floor(dragTarget.minute / 60), dragTarget.minute % 60, 0, 0);
      onEventDrop(dragged, newStart);
    }
    (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent = undefined;
    setDragTarget(null);
  };

  return (
    <div className="overflow-hidden rounded-xl bg-card border border-border">
      {/* Day headers */}
      <div className="grid grid-cols-[var(--time-col)_repeat(7,1fr)] gap-px bg-border" style={{ ['--time-col' as string]: `${TIME_COL_WIDTH}px` }}>
        <div className="bg-card p-3" />
        {days.map((date, i) => (
          <div
            key={i}
            className={cn(
              'bg-card p-3 text-center transition-colors',
              isSameDay(date, today) && 'bg-primary/10',
            )}
          >
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {date.toLocaleDateString(undefined, { weekday: 'short' })}
            </div>
            <div
              className={cn(
                'mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold transition-colors',
                isSameDay(date, today)
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground',
              )}
            >
              {date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div
          className="grid grid-cols-[var(--time-col)_repeat(7,1fr)] gap-px bg-border border-b border-border"
          style={{ ['--time-col' as string]: `${TIME_COL_WIDTH}px` }}
        >
          <div className="bg-card p-2 text-xs font-medium text-muted-foreground text-right pr-3">
            All day
          </div>
          {days.map((date, dayIdx) => {
            const allDayEvents = eventsByDay[dayIdx].filter((e) => e.allDay);
            return (
              <div
                key={dayIdx}
                className={cn(
                  'bg-card min-h-10 p-1',
                  isSameDay(date, today) && 'bg-primary/10',
                )}
              >
                {allDayEvents.map((event) => {
                  const color = resolveEventColor(event, calendars, colorPalette);
                  return (
                    <div
                      key={event.id}
                      draggable={!!onEventDrop}
                      onDragStart={handleDragStart(event)}
                      className="rounded-md px-2 py-1 text-xs font-semibold cursor-pointer transition-all duration-200 hover:scale-[1.02] truncate mb-1 border"
                      style={{
                        backgroundColor: `${color}35`,
                        color,
                        borderColor: `${color}50`,
                      }}
                      onClick={() => onEventClick(event)}
                    >
                      {event.title}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="overflow-auto max-h-[70vh]">
        <div
          className="grid grid-cols-[var(--time-col)_repeat(7,1fr)] gap-px bg-border"
          style={{ ['--time-col' as string]: `${TIME_COL_WIDTH}px` }}
        >
          {/* Time column */}
          <div className="bg-card">
            {hours.map((hour) => (
              <div
                key={hour}
                className={cn(
                  'text-xs font-medium text-muted-foreground text-right pr-3 pt-1',
                  getTimeSlotBg(hour),
                )}
                style={{ height: HOUR_HEIGHT }}
              >
                {hour === 0 ? '' : formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((date, dayIdx) => {
            const dayTimedEvents = eventsByDay[dayIdx].filter((e) => !e.allDay);
            const laid = layoutTimedEvents(dayTimedEvents);
            const isToday = isSameDay(date, today);

            return (
              <div
                key={dayIdx}
                className={cn('relative select-none', isToday && 'bg-primary/5')}
                style={{ height: HOUR_HEIGHT * 24 }}
                onDragOver={onEventDrop ? handleColumnDragOver(dayIdx) : undefined}
                onDrop={onEventDrop ? handleColumnDrop(dayIdx) : undefined}
                onDragLeave={() => setDragTarget(null)}
                onDoubleClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const totalMinutes = Math.max(
                    0,
                    Math.min(24 * 60 - 1, Math.round((y / HOUR_HEIGHT) * 60 / 30) * 30),
                  );
                  const clickedDate = new Date(date);
                  clickedDate.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
                  onSlotDoubleClick(clickedDate);
                }}
              >
                {/* Hour grid lines + night shading */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className={cn(
                      'absolute inset-x-0 border-t border-border',
                      getTimeSlotBg(hour),
                    )}
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}

                {/* Half-hour faint divider */}
                {hours.map((hour) => (
                  <div
                    key={`half-${hour}`}
                    className="absolute inset-x-0 border-t border-border/40 pointer-events-none"
                    style={{ top: hour * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                  />
                ))}

                {/* Events */}
                {laid.map(({ event, column, columns }) => {
                  const startMinutes = minutesSinceMidnight(event.startTime);
                  const endMinutes = minutesSinceMidnight(event.endTime);
                  const top = (startMinutes / 60) * HOUR_HEIGHT;
                  const height = Math.max(20, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT - 2);
                  const widthPct = 100 / columns;
                  const leftPct = column * widthPct;
                  const color = resolveEventColor(event, calendars, colorPalette);

                  return (
                    <div
                      key={event.id}
                      draggable={!!onEventDrop}
                      onDragStart={handleDragStart(event)}
                      className="absolute rounded-md px-2 py-0.5 text-xs font-semibold cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-md border z-10"
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        backgroundColor: `${color}35`,
                        color,
                        borderColor: `${color}50`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(event);
                      }}
                      title={event.title}
                    >
                      <div className="truncate">{event.title}</div>
                      {height >= 40 && (
                        <div className="text-[10px] opacity-80">
                          {formatEventRange(event)}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Now-indicator line (today only) */}
                {isToday && (
                  <div
                    className="absolute inset-x-0 pointer-events-none z-20"
                    style={{ top: (minutesSinceMidnight(now.toISOString()) / 60) * HOUR_HEIGHT }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
                      <div className="h-px bg-red-500" />
                    </div>
                  </div>
                )}

                {/* Drag preview marker */}
                {dragTarget && dragTarget.dayIdx === dayIdx && (
                  <div
                    className="absolute inset-x-0 pointer-events-none border-t-2 border-dashed border-primary z-30"
                    style={{ top: (dragTarget.minute / 60) * HOUR_HEIGHT }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function minutesSinceMidnight(iso: string | Date): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.getHours() * 60 + d.getMinutes();
}

function formatEventRange(event: CalendarEvent): string {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}
