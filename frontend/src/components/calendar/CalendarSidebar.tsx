import { Plus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Calendar } from '@/types/models';

interface CalendarSidebarProps {
  calendars: Calendar[];
  visibleCalendars: string[];
  onToggleCalendar: (calendarId: string) => void;
  onCreateCalendar: () => void;
  onEditCalendar: (calendar: Calendar) => void;
}

export function CalendarSidebar({
  calendars,
  visibleCalendars,
  onToggleCalendar,
  onCreateCalendar,
  onEditCalendar,
}: CalendarSidebarProps) {
  const myCalendars = calendars.filter((cal) => !cal.syncProvider);
  const syncedCalendars = calendars.filter((cal) => cal.syncProvider);

  return (
    <div className="w-64 border-r flex flex-col h-full">
      <div className="p-4">
        <Button onClick={onCreateCalendar} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          Create Calendar
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 pb-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              My Calendars
            </h3>
            <div className="space-y-1">
              {myCalendars.length === 0 ? (
                <p className="text-sm text-muted-foreground">No calendars</p>
              ) : (
                myCalendars.map((calendar) => (
                  <CalendarItem
                    key={calendar.id}
                    calendar={calendar}
                    isVisible={visibleCalendars.includes(calendar.id)}
                    onToggle={() => onToggleCalendar(calendar.id)}
                    onEdit={() => onEditCalendar(calendar)}
                  />
                ))
              )}
            </div>
          </div>

          {syncedCalendars.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Synced Calendars
                </h3>
                <div className="space-y-1">
                  {syncedCalendars.map((calendar) => (
                    <CalendarItem
                      key={calendar.id}
                      calendar={calendar}
                      isVisible={visibleCalendars.includes(calendar.id)}
                      onToggle={() => onToggleCalendar(calendar.id)}
                      onEdit={() => onEditCalendar(calendar)}
                      isSynced
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface CalendarItemProps {
  calendar: Calendar;
  isVisible: boolean;
  onToggle: () => void;
  onEdit: () => void;
  isSynced?: boolean;
}

function CalendarItem({
  calendar,
  isVisible,
  onToggle,
  onEdit,
  isSynced,
}: CalendarItemProps) {
  return (
    <div className="flex items-center justify-between group rounded-md px-2 py-1.5 hover:bg-muted">
      <div className="flex items-center gap-2 min-w-0">
        <Checkbox
          checked={isVisible}
          onCheckedChange={onToggle}
          className="shrink-0"
          style={{
            borderColor: calendar.color,
            backgroundColor: isVisible ? calendar.color : 'transparent',
          }}
        />
        <span className={cn('text-sm truncate', !isVisible && 'text-muted-foreground')}>
          {calendar.name}
        </span>
        {isSynced && calendar.syncProvider && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({calendar.syncProvider})
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
        onClick={onEdit}
      >
        <Settings className="h-3 w-3" />
      </Button>
    </div>
  );
}
