import { useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Search,
  X,
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Filter,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { calendarsApi } from '@/api/calendars';
import type { Calendar as CalendarType, CalendarEvent } from '@/types/models';
import { cn } from '@/lib/utils';

interface CalendarSearchProps {
  calendars: CalendarType[];
  onEventSelect?: (event: CalendarEvent) => void;
}

export interface CalendarSearchRef {
  open: () => void;
}

export const CalendarSearch = forwardRef<CalendarSearchRef, CalendarSearchProps>(
  function CalendarSearch({ calendars, onEventSelect }, ref) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [showFilters, setShowFilters] = useState(false);

  // Expose open method via ref
  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
  }));

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceTimeout = useCallback(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  // Clear debounce on query change
  useState(() => {
    const cleanup = debounceTimeout();
    return cleanup;
  });

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['events', 'search', debouncedQuery, selectedCalendarIds, startDate, endDate],
    queryFn: () =>
      calendarsApi.searchEvents({
        q: debouncedQuery || undefined,
        calendarIds: selectedCalendarIds.length > 0 ? selectedCalendarIds.join(',') : undefined,
        start: startDate?.toISOString(),
        end: endDate?.toISOString(),
        limit: 50,
      }),
    enabled: open && (debouncedQuery.length >= 2 || selectedCalendarIds.length > 0 || !!startDate || !!endDate),
  });

  const handleCalendarToggle = (calendarId: string, checked: boolean) => {
    if (checked) {
      setSelectedCalendarIds((prev) => [...prev, calendarId]);
    } else {
      setSelectedCalendarIds((prev) => prev.filter((id) => id !== calendarId));
    }
  };

  const clearFilters = () => {
    setSelectedCalendarIds([]);
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const hasActiveFilters = selectedCalendarIds.length > 0 || !!startDate || !!endDate;

  const handleEventClick = (event: CalendarEvent) => {
    onEventSelect?.(event);
    setOpen(false);
  };

  const formatEventTime = (event: CalendarEvent) => {
    if (event.allDay) {
      return format(new Date(event.startTime), 'MMM d, yyyy');
    }
    return `${format(new Date(event.startTime), 'MMM d, yyyy h:mm a')} - ${format(
      new Date(event.endTime),
      'h:mm a'
    )}`;
  };

  const getCalendarColor = (calendarId: string) => {
    const calendar = calendars.find((c) => c.id === calendarId);
    return calendar?.color || '#6366f1';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Search className="h-4 w-4" />
          Search Events
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Search Events</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, description, or location..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                  onClick={() => setQuery('')}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="icon"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4" />
            </Button>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Filters</h4>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear all
                  </Button>
                )}
              </div>

              {/* Calendar filter */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Calendars</Label>
                <div className="flex flex-wrap gap-2">
                  {calendars.map((calendar) => (
                    <label
                      key={calendar.id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer transition-colors',
                        selectedCalendarIds.includes(calendar.id)
                          ? 'bg-primary/10 border-primary'
                          : 'hover:bg-muted'
                      )}
                    >
                      <Checkbox
                        checked={selectedCalendarIds.includes(calendar.id)}
                        onCheckedChange={(checked) =>
                          handleCalendarToggle(calendar.id, checked as boolean)
                        }
                        className="hidden"
                      />
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: calendar.color }}
                      />
                      <span className="text-sm">{calendar.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Date range filter */}
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-[180px] justify-start text-left font-normal',
                          !startDate && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, 'MMM d, yyyy') : 'Start date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-[180px] justify-start text-left font-normal',
                          !endDate && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, 'MMM d, yyyy') : 'End date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          )}

          {/* Active filter badges */}
          {hasActiveFilters && !showFilters && (
            <div className="flex flex-wrap gap-2">
              {selectedCalendarIds.map((id) => {
                const calendar = calendars.find((c) => c.id === id);
                return calendar ? (
                  <Badge key={id} variant="secondary" className="gap-1">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    {calendar.name}
                    <button
                      onClick={() => handleCalendarToggle(id, false)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : null;
              })}
              {startDate && (
                <Badge variant="secondary" className="gap-1">
                  From: {format(startDate, 'MMM d')}
                  <button
                    onClick={() => setStartDate(undefined)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {endDate && (
                <Badge variant="secondary" className="gap-1">
                  To: {format(endDate, 'MMM d')}
                  <button
                    onClick={() => setEndDate(undefined)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}

          {/* Search results */}
          <ScrollArea className="h-[400px] border rounded-lg">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !debouncedQuery && !hasActiveFilters ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Enter a search term or apply filters</p>
              </div>
            ) : searchResults?.events?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <CalendarIcon className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No events found</p>
              </div>
            ) : (
              <div className="divide-y">
                {searchResults?.events?.map((event) => (
                  <div
                    key={event.id}
                    className="p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => handleEventClick(event)}
                  >
                    <div className="flex gap-3">
                      <div
                        className="w-1 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getCalendarColor(event.calendarId) }}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{event.title}</h4>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatEventTime(event)}
                          </span>
                          {event.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {event.location}
                            </span>
                          )}
                        </div>
                        {event.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {event.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Results count */}
          {searchResults && searchResults.total > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Showing {searchResults.events.length} of {searchResults.total} results
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
