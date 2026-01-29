import { useState } from 'react';
import { Plus, Trash2, MapPin, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import type { ParsedCalendarContent, ParsedCalendarEvent } from '@/api/image-parse';

interface CalendarEventsPreviewProps {
  content: ParsedCalendarContent;
  onContentChange?: (content: ParsedCalendarContent) => void;
}

export function CalendarEventsPreview({
  content,
  onContentChange,
}: CalendarEventsPreviewProps) {
  const [localContent, setLocalContent] = useState<ParsedCalendarContent>(content);

  const updateContent = (updates: Partial<ParsedCalendarContent>) => {
    const updated = { ...localContent, ...updates };
    setLocalContent(updated);
    onContentChange?.(updated);
  };

  const updateEvent = (index: number, updates: Partial<ParsedCalendarEvent>) => {
    const events = [...localContent.events];
    events[index] = { ...events[index], ...updates };
    updateContent({ events });
  };

  const removeEvent = (index: number) => {
    const events = localContent.events.filter((_, i) => i !== index);
    updateContent({ events });
  };

  const addEvent = () => {
    const events: ParsedCalendarEvent[] = [
      ...localContent.events,
      {
        title: '',
        allDay: false,
        confidence: 1,
      },
    ];
    updateContent({ events });
  };

  // Format datetime-local input value
  const formatDateTimeForInput = (isoString?: string): string => {
    if (!isoString) return '';
    try {
      // Handle both full ISO and date-only strings
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      return date.toISOString().slice(0, 16);
    } catch {
      return '';
    }
  };

  // Format date input value
  const formatDateForInput = (isoString?: string): string => {
    if (!isoString) return '';
    try {
      // Extract just the date part
      return isoString.split('T')[0];
    } catch {
      return '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Events ({localContent.events.length})</Label>
        <Button variant="ghost" size="sm" onClick={addEvent}>
          <Plus className="mr-1 h-4 w-4" />
          Add Event
        </Button>
      </div>

      <div className="max-h-[400px] space-y-3 overflow-y-auto">
        {localContent.events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No events extracted. Add events manually.
          </p>
        ) : (
          localContent.events.map((event, index) => (
            <Card key={index} className="relative">
              <CardContent className="space-y-3 p-4">
                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2"
                  onClick={() => removeEvent(index)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>

                {/* Title */}
                <div className="space-y-1">
                  <Label className="text-xs">Title</Label>
                  <Input
                    value={event.title}
                    onChange={(e) => updateEvent(index, { title: e.target.value })}
                    placeholder="Event title..."
                  />
                </div>

                {/* All Day toggle */}
                <div className="flex items-center gap-2">
                  <Switch
                    checked={event.allDay}
                    onCheckedChange={(checked) => updateEvent(index, { allDay: checked })}
                  />
                  <Label className="text-sm">All Day Event</Label>
                </div>

                {/* Date/Time */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">
                      <Clock className="mr-1 inline h-3 w-3" />
                      {event.allDay ? 'Date' : 'Start'}
                    </Label>
                    {event.allDay ? (
                      <Input
                        type="date"
                        value={formatDateForInput(event.startTime)}
                        onChange={(e) =>
                          updateEvent(index, { startTime: e.target.value || undefined })
                        }
                      />
                    ) : (
                      <Input
                        type="datetime-local"
                        value={formatDateTimeForInput(event.startTime)}
                        onChange={(e) =>
                          updateEvent(index, {
                            startTime: e.target.value
                              ? new Date(e.target.value).toISOString()
                              : undefined,
                          })
                        }
                      />
                    )}
                  </div>
                  {!event.allDay && (
                    <div className="space-y-1">
                      <Label className="text-xs">End</Label>
                      <Input
                        type="datetime-local"
                        value={formatDateTimeForInput(event.endTime)}
                        onChange={(e) =>
                          updateEvent(index, {
                            endTime: e.target.value
                              ? new Date(e.target.value).toISOString()
                              : undefined,
                          })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Location */}
                <div className="space-y-1">
                  <Label className="text-xs">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    Location (optional)
                  </Label>
                  <Input
                    value={event.location || ''}
                    onChange={(e) =>
                      updateEvent(index, { location: e.target.value || undefined })
                    }
                    placeholder="Event location..."
                  />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <Label className="text-xs">Description (optional)</Label>
                  <Textarea
                    value={event.description || ''}
                    onChange={(e) =>
                      updateEvent(index, { description: e.target.value || undefined })
                    }
                    placeholder="Additional notes..."
                    rows={2}
                  />
                </div>

                {/* Recurrence hint */}
                {event.recurrenceHint && (
                  <Badge variant="outline" className="text-xs">
                    Recurrence: {event.recurrenceHint}
                  </Badge>
                )}

                {/* Confidence */}
                {event.confidence < 0.7 && (
                  <Badge variant="secondary" className="text-xs">
                    Low confidence - please verify
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
