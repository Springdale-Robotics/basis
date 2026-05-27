import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  Link2,
  Unlink,
  Check,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { calendarsApi } from '@/api/calendars';
import type { Calendar } from '@/types/models';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/hooks/useToast';
import { useTheme } from '@/hooks/useTheme';
import { getColorForIndex, type ColorPalette } from '@/lib/theme-presets';

interface CalendarSyncSettingsProps {
  calendars: Calendar[];
}

export function CalendarSyncSettings({ calendars }: CalendarSyncSettingsProps) {
  const queryClient = useQueryClient();
  const [selectCalendarOpen, setSelectCalendarOpen] = useState(false);
  const [selectedGoogleCalendar, setSelectedGoogleCalendar] = useState<string>('');
  const { colorPalette } = useTheme();

  // Helper to get calendar color from colorIndex
  const getCalendarColor = (calendar: Calendar): string => {
    if (calendar.colorIndex !== undefined && calendar.colorIndex >= 0) {
      return getColorForIndex(colorPalette as ColorPalette, calendar.colorIndex);
    }
    return calendar.color || '#4A90D9';
  };
  const [calendarName, setCalendarName] = useState('');
  const [calendarColor, setCalendarColor] = useState('#4285F4');

  // Check if Google sync is configured
  const { data: googleStatus } = useQuery({
    queryKey: ['google-sync-status'],
    queryFn: calendarsApi.getGoogleSyncStatus,
  });

  // Get Google calendars when selecting
  const { data: googleCalendars, isLoading: loadingGoogleCalendars } = useQuery({
    queryKey: ['google-calendars'],
    queryFn: calendarsApi.getGoogleCalendars,
    enabled: selectCalendarOpen,
  });

  // Start Google OAuth flow
  const connectMutation = useMutation({
    mutationFn: calendarsApi.startGoogleConnect,
    onSuccess: (data) => {
      // Redirect to Google OAuth
      window.location.href = data.authUrl;
    },
    onError: () => {
      toast({
        title: 'Connection Failed',
        description: 'Could not start Google Calendar connection.',
        variant: 'destructive',
      });
    },
  });

  // Complete Google Calendar sync
  const completeMutation = useMutation({
    mutationFn: calendarsApi.completeGoogleSync,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      setSelectCalendarOpen(false);
      setSelectedGoogleCalendar('');
      setCalendarName('');

      if (data.syncError) {
        toast({
          title: 'Calendar Connected',
          description: data.syncError,
        });
      } else {
        toast({
          title: 'Calendar Synced',
          description: `Synced ${data.syncResult?.created || 0} events from Google Calendar.`,
        });
      }
    },
    onError: () => {
      toast({
        title: 'Sync Failed',
        description: 'Could not complete Google Calendar sync.',
        variant: 'destructive',
      });
    },
  });

  // Trigger manual sync
  const syncMutation = useMutation({
    mutationFn: calendarsApi.triggerSync,
    onSuccess: (data, calendarId) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast({
        title: 'Sync Complete',
        description: `Updated ${data.syncResult.created + data.syncResult.updated} events.`,
      });
    },
    onError: () => {
      toast({
        title: 'Sync Failed',
        description: 'Could not sync calendar.',
        variant: 'destructive',
      });
    },
  });

  // Disconnect sync
  const disconnectMutation = useMutation({
    mutationFn: calendarsApi.disconnectSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      toast({
        title: 'Disconnected',
        description: 'Calendar sync has been disconnected.',
      });
    },
  });

  const syncedCalendars = calendars.filter((c) => c.isSynced);
  const isGoogleConfigured = googleStatus?.configured ?? false;

  // Check URL params for errors from OAuth callback
  const urlParams = new URLSearchParams(window.location.search);
  const oauthError = urlParams.get('error');

  const handleGoogleCalendarSelect = (googleCalId: string) => {
    setSelectedGoogleCalendar(googleCalId);
    const cal = googleCalendars?.calendars.find((c) => c.id === googleCalId);
    if (cal) {
      setCalendarName(cal.summary);
      if (cal.backgroundColor) {
        setCalendarColor(cal.backgroundColor);
      }
    }
  };

  const handleCompleteSync = () => {
    if (!selectedGoogleCalendar || !calendarName) return;
    completeMutation.mutate({
      googleCalendarId: selectedGoogleCalendar,
      name: calendarName,
      color: calendarColor,
    });
  };

  return (
    <div className="space-y-6">
      {/* OAuth Error Alert */}
      {oauthError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>
                {oauthError === 'access_denied'
                  ? 'You cancelled the Google Calendar connection.'
                  : 'Failed to connect to Google Calendar. Please try again.'}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Google Calendar Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Google Calendar
          </CardTitle>
          <CardDescription>
            Sync your Google Calendar events to view them alongside your Home
            Manager calendars.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isGoogleConfigured ? (
            <div className="text-sm text-muted-foreground">
              Google Calendar sync is not configured. Contact your administrator
              to set up Google OAuth credentials.
            </div>
          ) : (
            <>
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                Connect Google Calendar
              </Button>

              {/* Synced calendars list */}
              {syncedCalendars.filter((c) => c.syncProvider === 'google').length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-medium">Connected Calendars</h4>
                  {syncedCalendars
                    .filter((c) => c.syncProvider === 'google')
                    .map((calendar) => (
                      <div
                        key={calendar.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getCalendarColor(calendar) }}
                          />
                          <div>
                            <div className="font-medium">{calendar.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {calendar.lastSyncAt
                                ? `Last synced ${formatDistanceToNow(new Date(calendar.lastSyncAt))} ago`
                                : 'Never synced'}
                            </div>
                            {calendar.syncError && (
                              <div className="text-xs text-destructive flex items-center gap-1 mt-1">
                                <AlertCircle className="h-3 w-3" />
                                {calendar.syncError}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => syncMutation.mutate(calendar.id)}
                            disabled={syncMutation.isPending}
                          >
                            {syncMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => disconnectMutation.mutate(calendar.id)}
                            disabled={disconnectMutation.isPending}
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Calendar Selection Dialog */}
      <Dialog open={selectCalendarOpen} onOpenChange={setSelectCalendarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Google Calendar</DialogTitle>
            <DialogDescription>
              Choose which Google Calendar to sync with Basis.
            </DialogDescription>
          </DialogHeader>

          {loadingGoogleCalendars ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Google Calendar</Label>
                <Select
                  value={selectedGoogleCalendar}
                  onValueChange={handleGoogleCalendarSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {googleCalendars?.calendars.map((cal) => (
                      <SelectItem key={cal.id} value={cal.id}>
                        <div className="flex items-center gap-2">
                          {cal.backgroundColor && (
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: cal.backgroundColor }}
                            />
                          )}
                          {cal.summary}
                          {cal.primary && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              Primary
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Calendar Name</Label>
                <Input
                  value={calendarName}
                  onChange={(e) => setCalendarName(e.target.value)}
                  placeholder="Enter calendar name"
                />
              </div>

              <div className="space-y-2">
                <Label>Calendar Color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={calendarColor}
                    onChange={(e) => setCalendarColor(e.target.value)}
                    className="w-12 h-10 p-1 cursor-pointer"
                  />
                  <Input
                    value={calendarColor}
                    onChange={(e) => setCalendarColor(e.target.value)}
                    placeholder="#4285F4"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectCalendarOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCompleteSync}
              disabled={!selectedGoogleCalendar || !calendarName || completeMutation.isPending}
            >
              {completeMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Connect & Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Helper component to detect OAuth redirect and open calendar selection
export function useGoogleCalendarOAuthHandler() {
  const [showCalendarSelect, setShowCalendarSelect] = useState(false);

  // Check if we're returning from OAuth
  const isOAuthReturn = window.location.pathname === '/settings/calendars/google/select';

  return {
    showCalendarSelect: showCalendarSelect || isOAuthReturn,
    setShowCalendarSelect,
  };
}
