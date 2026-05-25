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

interface DayViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: CalendarType[];
  colorPalette: string;
  onEventClick: (event: CalendarEvent) => void;
  onSlotDoubleClick: (date: Date) => void;
  onEventDrop?: (event: CalendarEvent, newStart: Date) => void;
}

const HOUR_HEIGHT = 56;
const TIME_COL_WIDTH = 96;

export function DayView({
  currentDate,
  events,
  calendars,
  colorPalette,
  onEventClick,
  onSlotDoubleClick,
  onEventDrop,
}: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const [dragMinute, setDragMinute] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = Math.max(0, (now.getHours() - 1) * HOUR_HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isToday = isSameDay(currentDate, new Date());
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const dayEvents = useMemo(
    () => events.filter((e) => isSameDay(new Date(e.startTime), currentDate)),
    [events, currentDate],
  );
  const allDayEvents = dayEvents.filter((e) => e.allDay);
  const timedEvents = dayEvents.filter((e) => !e.allDay);
  const laid = useMemo(() => layoutTimedEvents(timedEvents), [timedEvents]);

  const handleDragStart = (event: CalendarEvent) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', event.id);
    (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent = event;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDragMinute(
      Math.max(0, Math.min(24 * 60 - 1, Math.round((y / HOUR_HEIGHT) * 60 / 15) * 15)),
    );
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dragged = (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent;
    if (dragged && onEventDrop && dragMinute !== null) {
      const newStart = new Date(currentDate);
      newStart.setHours(Math.floor(dragMinute / 60), dragMinute % 60, 0, 0);
      onEventDrop(dragged, newStart);
    }
    (window as unknown as { __draggedEvent?: CalendarEvent }).__draggedEvent = undefined;
    setDragMinute(null);
  };

  return (
    <div className="overflow-hidden rounded-xl bg-card border border-border">
      {/* Day header */}
      <div className="flex border-b border-border">
        <div className="bg-card p-3" style={{ width: TIME_COL_WIDTH }} />
        <div
          className={cn(
            'flex-1 p-3 text-center transition-colors bg-card',
            isToday && 'bg-primary/10',
          )}
        >
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {currentDate.toLocaleDateString(undefined, { weekday: 'long' })}
          </div>
          <div
            className={cn(
              'mt-1 inline-flex h-10 min-w-10 px-3 items-center justify-center rounded-full text-lg font-semibold transition-colors',
              isToday
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-foreground',
            )}
          >
            {currentDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div className="flex border-b border-border bg-muted/30">
          <div
            className="p-2 text-xs font-medium text-muted-foreground text-right pr-4"
            style={{ width: TIME_COL_WIDTH }}
          >
            All day
          </div>
          <div className="flex-1 p-1 space-y-1">
            {allDayEvents.map((event) => {
              const color = resolveEventColor(event, calendars, colorPalette);
              return (
                <div
                  key={event.id}
                  draggable={!!onEventDrop}
                  onDragStart={handleDragStart(event)}
                  className="rounded-md px-3 py-1 text-sm font-semibold cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-md border"
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
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="overflow-auto max-h-[70vh]">
        <div className="flex" style={{ height: HOUR_HEIGHT * 24 }}>
          {/* Time column */}
          <div className="shrink-0" style={{ width: TIME_COL_WIDTH }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className={cn(
                  'text-xs font-medium text-muted-foreground text-right pr-4 pt-1 border-r border-border',
                  getTimeSlotBg(hour),
                )}
                style={{ height: HOUR_HEIGHT }}
              >
                {hour === 0 ? '' : formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Event canvas */}
          <div
            className="relative flex-1"
            onDragOver={onEventDrop ? handleDragOver : undefined}
            onDrop={onEventDrop ? handleDrop : undefined}
            onDragLeave={() => setDragMinute(null)}
            onDoubleClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const totalMinutes = Math.max(
                0,
                Math.min(24 * 60 - 1, Math.round((y / HOUR_HEIGHT) * 60 / 30) * 30),
              );
              const clicked = new Date(currentDate);
              clicked.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
              onSlotDoubleClick(clicked);
            }}
          >
            {/* Hour bands */}
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

            {/* Half-hour dividers */}
            {hours.map((hour) => (
              <div
                key={`half-${hour}`}
                className="absolute inset-x-0 border-t border-border/40 pointer-events-none"
                style={{ top: hour * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
              />
            ))}

            {/* Events */}
            {laid.map(({ event, column, columns }) => {
              const startMin = minutesSinceMidnight(event.startTime);
              const endMin = minutesSinceMidnight(event.endTime);
              const top = (startMin / 60) * HOUR_HEIGHT;
              const height = Math.max(24, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);
              const widthPct = 100 / columns;
              const leftPct = column * widthPct;
              const color = resolveEventColor(event, calendars, colorPalette);

              return (
                <div
                  key={event.id}
                  draggable={!!onEventDrop}
                  onDragStart={handleDragStart(event)}
                  className="absolute rounded-lg px-3 py-1 text-sm cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-md border z-10"
                  style={{
                    top,
                    height,
                    left: `calc(${leftPct}% + 4px)`,
                    width: `calc(${widthPct}% - 8px)`,
                    backgroundColor: `${color}35`,
                    color,
                    borderColor: `${color}50`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick(event);
                  }}
                >
                  <div className="font-semibold truncate">{event.title}</div>
                  {height >= 40 && (
                    <div className="text-xs opacity-80 mt-0.5">
                      {formatEventRange(event)}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Now-indicator */}
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

            {/* Drag preview */}
            {dragMinute !== null && (
              <div
                className="absolute inset-x-0 pointer-events-none border-t-2 border-dashed border-primary z-30"
                style={{ top: (dragMinute / 60) * HOUR_HEIGHT }}
              />
            )}
          </div>
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
