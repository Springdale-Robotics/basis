import { Plus, Settings, Share2, RefreshCw, AlertCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { getColorForIndex, type ColorPalette } from '@/lib/theme-presets';
import type { Calendar } from '@/types/models';
import type { SharedCalendar } from '@/api/calendars';

interface CalendarSidebarProps {
  calendars: Calendar[];
  sharedCalendars?: SharedCalendar[];
  visibleCalendars: string[];
  onToggleCalendar: (calendarId: string) => void;
  onCreateCalendar: () => void;
  onEditCalendar: (calendar: Calendar) => void;
  onShareCalendar?: (calendar: Calendar) => void;
}

export function CalendarSidebar({
  calendars,
  sharedCalendars = [],
  visibleCalendars,
  onToggleCalendar,
  onCreateCalendar,
  onEditCalendar,
  onShareCalendar,
}: CalendarSidebarProps) {
  const { colorPalette } = useTheme();
  const myCalendars = calendars.filter((cal) => !cal.syncProvider);
  const syncedCalendars = calendars.filter((cal) => cal.syncProvider);

  // Helper to get calendar color from colorIndex
  const getCalendarColor = (calendar: Calendar | SharedCalendar): string => {
    if (calendar.colorIndex !== undefined && calendar.colorIndex >= 0) {
      return getColorForIndex(colorPalette as ColorPalette, calendar.colorIndex);
    }
    return calendar.color || '#4A90D9';
  };

  return (
    <TooltipProvider>
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
                      calendarColor={getCalendarColor(calendar)}
                      isVisible={visibleCalendars.includes(calendar.id)}
                      onToggle={() => onToggleCalendar(calendar.id)}
                      onEdit={() => onEditCalendar(calendar)}
                      onShare={onShareCalendar ? () => onShareCalendar(calendar) : undefined}
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
                        calendarColor={getCalendarColor(calendar)}
                        isVisible={visibleCalendars.includes(calendar.id)}
                        onToggle={() => onToggleCalendar(calendar.id)}
                        onEdit={() => onEditCalendar(calendar)}
                        onShare={onShareCalendar ? () => onShareCalendar(calendar) : undefined}
                        isSynced
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {sharedCalendars.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Shared with Me
                  </h3>
                  <div className="space-y-1">
                    {sharedCalendars.map((calendar) => (
                      <CalendarItem
                        key={calendar.id}
                        calendar={calendar}
                        calendarColor={getCalendarColor(calendar)}
                        isVisible={visibleCalendars.includes(calendar.id)}
                        onToggle={() => onToggleCalendar(calendar.id)}
                        onEdit={() => onEditCalendar(calendar)}
                        isShared
                        sharedByName={calendar.sharedBy.householdName}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}

interface CalendarItemProps {
  calendar: Calendar;
  calendarColor: string;
  isVisible: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onShare?: () => void;
  isSynced?: boolean;
  isShared?: boolean;
  sharedByName?: string;
}

function CalendarItem({
  calendar,
  calendarColor,
  isVisible,
  onToggle,
  onEdit,
  onShare,
  isSynced,
  isShared,
  sharedByName,
}: CalendarItemProps) {
  const getSyncStatusIndicator = () => {
    if (!isSynced) return null;

    if (calendar.syncError) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
          </TooltipTrigger>
          <TooltipContent>
            <p>Sync error: {calendar.syncError.split('|count:')[0]}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    if (calendar.lastSyncAt) {
      const lastSync = new Date(calendar.lastSyncAt);
      const hoursSince = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 2) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Synced recently</p>
            </TooltipContent>
          </Tooltip>
        );
      }
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Sync pending</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="flex items-center justify-between group rounded-md px-2 py-1.5 hover:bg-muted">
      <div className="flex items-center gap-2 min-w-0">
        <Checkbox
          checked={isVisible}
          onCheckedChange={onToggle}
          className="shrink-0"
          style={{
            borderColor: calendarColor,
            backgroundColor: isVisible ? calendarColor : 'transparent',
          }}
        />
        <span className={cn('text-sm truncate', !isVisible && 'text-muted-foreground')}>
          {calendar.name}
        </span>
        {isSynced && getSyncStatusIndicator()}
        {isShared && sharedByName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Users className="h-3 w-3 text-muted-foreground shrink-0" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Shared by {sharedByName}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center opacity-0 group-hover:opacity-100">
        {onShare && !isShared && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onShare}
          >
            <Share2 className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onEdit}
        >
          <Settings className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
