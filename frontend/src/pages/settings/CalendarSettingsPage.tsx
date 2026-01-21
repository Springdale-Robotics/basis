import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  RefreshCw,
  Link2,
  Unlink,
  Check,
  AlertCircle,
  Loader2,
  Upload,
  Download,
  Calendar as CalendarIcon,
  Share2,
  Globe,
  Settings,
  ChevronRight,
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
import { Separator } from '@/components/ui/separator';
import { calendarsApi } from '@/api/calendars';
import type { Calendar } from '@/types/models';
import { formatDistanceToNow } from 'date-fns';
import { toast } from '@/hooks/useToast';
import { CalendarSharingDialog } from '@/components/calendar/CalendarSharingDialog';
import { CalendarPublicLinkCard } from '@/components/calendar/CalendarPublicLinkCard';

export function CalendarSettingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Dialog states
  const [googleSelectOpen, setGoogleSelectOpen] = useState(false);
  const [outlookSelectOpen, setOutlookSelectOpen] = useState(false);
  const [selectedGoogleCalendar, setSelectedGoogleCalendar] = useState('');
  const [selectedOutlookCalendar, setSelectedOutlookCalendar] = useState('');
  const [calendarName, setCalendarName] = useState('');
  const [calendarColor, setCalendarColor] = useState('#3B82F6');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importCalendarId, setImportCalendarId] = useState('');
  const [manageCalendar, setManageCalendar] = useState<Calendar | null>(null);
  const [sharingDialogOpen, setSharingDialogOpen] = useState(false);
  const [publicLinkDialogOpen, setPublicLinkDialogOpen] = useState(false);

  // Check URL params for OAuth callbacks
  const oauthError = searchParams.get('error');
  const provider = searchParams.get('provider');
  const selectCalendar = searchParams.get('select');

  useEffect(() => {
    // Handle OAuth callback
    if (selectCalendar === 'google') {
      setGoogleSelectOpen(true);
      searchParams.delete('select');
      setSearchParams(searchParams, { replace: true });
    } else if (selectCalendar === 'outlook') {
      setOutlookSelectOpen(true);
      searchParams.delete('select');
      setSearchParams(searchParams, { replace: true });
    }
  }, [selectCalendar, searchParams, setSearchParams]);

  // Get calendars
  const { data: calendarsData, isLoading: loadingCalendars } = useQuery({
    queryKey: ['calendars'],
    queryFn: calendarsApi.list,
  });

  // Check if providers are configured
  const { data: googleStatus } = useQuery({
    queryKey: ['google-sync-status'],
    queryFn: calendarsApi.getGoogleSyncStatus,
  });

  const { data: outlookStatus } = useQuery({
    queryKey: ['outlook-sync-status'],
    queryFn: calendarsApi.getOutlookSyncStatus,
  });

  // Get provider calendars
  const { data: googleCalendars, isLoading: loadingGoogleCalendars } = useQuery({
    queryKey: ['google-calendars'],
    queryFn: calendarsApi.getGoogleCalendars,
    enabled: googleSelectOpen,
  });

  const { data: outlookCalendars, isLoading: loadingOutlookCalendars } = useQuery({
    queryKey: ['outlook-calendars'],
    queryFn: calendarsApi.getOutlookCalendars,
    enabled: outlookSelectOpen,
  });

  // Mutations
  const connectGoogleMutation = useMutation({
    mutationFn: calendarsApi.startGoogleConnect,
    onSuccess: (data) => {
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

  const connectOutlookMutation = useMutation({
    mutationFn: calendarsApi.startOutlookConnect,
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: () => {
      toast({
        title: 'Connection Failed',
        description: 'Could not start Outlook Calendar connection.',
        variant: 'destructive',
      });
    },
  });

  const completeGoogleMutation = useMutation({
    mutationFn: calendarsApi.completeGoogleSync,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      setGoogleSelectOpen(false);
      resetDialogState();
      toast({
        title: 'Calendar Connected',
        description: `Synced ${data.syncResult?.created || 0} events from Google Calendar.`,
      });
    },
    onError: () => {
      toast({
        title: 'Sync Failed',
        description: 'Could not complete Google Calendar sync.',
        variant: 'destructive',
      });
    },
  });

  const completeOutlookMutation = useMutation({
    mutationFn: calendarsApi.completeOutlookSync,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      setOutlookSelectOpen(false);
      resetDialogState();
      toast({
        title: 'Calendar Connected',
        description: `Synced ${data.syncResult?.created || 0} events from Outlook Calendar.`,
      });
    },
    onError: () => {
      toast({
        title: 'Sync Failed',
        description: 'Could not complete Outlook Calendar sync.',
        variant: 'destructive',
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: calendarsApi.triggerSync,
    onSuccess: (data) => {
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

  const importMutation = useMutation({
    mutationFn: ({ calendarId, file }: { calendarId: string; file: File }) =>
      calendarsApi.importIcs(calendarId, file),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setImportDialogOpen(false);
      setImportFile(null);
      setImportCalendarId('');
      toast({
        title: 'Import Complete',
        description: `Imported ${data.imported} events${data.skipped > 0 ? `, skipped ${data.skipped} duplicates` : ''}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Import Failed',
        description: error.message || 'Could not import ICS file.',
        variant: 'destructive',
      });
    },
  });

  const resetDialogState = () => {
    setSelectedGoogleCalendar('');
    setSelectedOutlookCalendar('');
    setCalendarName('');
    setCalendarColor('#3B82F6');
  };

  const calendars = calendarsData?.calendars || [];
  const syncedCalendars = calendars.filter((c) => c.isSynced);
  const localCalendars = calendars.filter((c) => !c.isSynced);
  const isGoogleConfigured = googleStatus?.configured ?? false;
  const isOutlookConfigured = outlookStatus?.configured ?? false;

  const handleGoogleCalendarSelect = (id: string) => {
    setSelectedGoogleCalendar(id);
    const cal = googleCalendars?.calendars.find((c) => c.id === id);
    if (cal) {
      setCalendarName(cal.summary);
      if (cal.backgroundColor) setCalendarColor(cal.backgroundColor);
    }
  };

  const handleOutlookCalendarSelect = (id: string) => {
    setSelectedOutlookCalendar(id);
    const cal = outlookCalendars?.calendars.find((c) => c.id === id);
    if (cal) {
      setCalendarName(cal.name);
      if (cal.color) setCalendarColor(cal.color);
    }
  };

  const handleImport = () => {
    if (!importFile || !importCalendarId) return;
    importMutation.mutate({ calendarId: importCalendarId, file: importFile });
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
                  ? `You cancelled the ${provider || 'calendar'} connection.`
                  : `Failed to connect to ${provider || 'calendar'}. Please try again.`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  searchParams.delete('error');
                  searchParams.delete('provider');
                  setSearchParams(searchParams, { replace: true });
                }}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connected Calendars */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Connected Calendars
          </CardTitle>
          <CardDescription>
            Calendars synced with external providers. Events are automatically updated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCalendars ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : syncedCalendars.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No external calendars connected. Connect Google or Outlook Calendar below.
            </p>
          ) : (
            <div className="space-y-3">
              {syncedCalendars.map((calendar) => (
                <SyncedCalendarItem
                  key={calendar.id}
                  calendar={calendar}
                  onSync={() => syncMutation.mutate(calendar.id)}
                  onDisconnect={() => disconnectMutation.mutate(calendar.id)}
                  onManage={() => setManageCalendar(calendar)}
                  isSyncing={syncMutation.isPending}
                  isDisconnecting={disconnectMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Calendar Section */}
      <Card>
        <CardHeader>
          <CardTitle>Add Calendar</CardTitle>
          <CardDescription>
            Connect an external calendar or import events from an ICS file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {/* Google Calendar */}
            <Button
              variant="outline"
              onClick={() => connectGoogleMutation.mutate()}
              disabled={!isGoogleConfigured || connectGoogleMutation.isPending}
            >
              {connectGoogleMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4">
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
              )}
              Google Calendar
            </Button>

            {/* Outlook Calendar */}
            <Button
              variant="outline"
              onClick={() => connectOutlookMutation.mutate()}
              disabled={!isOutlookConfigured || connectOutlookMutation.isPending}
            >
              {connectOutlookMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4">
                  <path fill="#0078D4" d="M24 5.5v13a2.5 2.5 0 01-2.5 2.5h-12A2.5 2.5 0 017 18.5V17h12.5a.5.5 0 00.5-.5V6l4 -.5z" />
                  <path fill="#0A2767" d="M15 7v11H2.5A2.5 2.5 0 010 15.5v-10A2.5 2.5 0 012.5 3H12.5A2.5 2.5 0 0115 5.5V7z" />
                  <path fill="#28A8EA" d="M15 7v4H7V7h8z" />
                </svg>
              )}
              Outlook Calendar
            </Button>

            {/* Import ICS */}
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(true)}
              disabled={localCalendars.length === 0}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import ICS
            </Button>
          </div>

          {!isGoogleConfigured && !isOutlookConfigured && (
            <p className="text-sm text-muted-foreground">
              External calendar providers are not configured. Contact your administrator
              to set up OAuth credentials.
            </p>
          )}
        </CardContent>
      </Card>

      {/* My Calendars Section */}
      {localCalendars.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              My Calendars
            </CardTitle>
            <CardDescription>
              Manage sharing and public access for your calendars.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {localCalendars.map((calendar) => (
                <div
                  key={calendar.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    <div>
                      <span className="font-medium">{calendar.name}</span>
                      <div className="text-sm text-muted-foreground">
                        {calendar.type === 'group' ? 'Group calendar' : 'Personal calendar'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setManageCalendar(calendar)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Manage
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle>Export Calendars</CardTitle>
          <CardDescription>
            Download your calendars as ICS files for backup or use in other apps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              asChild
            >
              <a href={calendarsApi.getExportAllUrl()} download>
                <Download className="mr-2 h-4 w-4" />
                Export All Calendars
              </a>
            </Button>
            {localCalendars.map((calendar) => (
              <Button
                key={calendar.id}
                variant="ghost"
                size="sm"
                asChild
              >
                <a href={calendarsApi.getExportUrl(calendar.id)} download>
                  <div
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: calendar.color }}
                  />
                  {calendar.name}
                </a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Google Calendar Selection Dialog */}
      <Dialog open={googleSelectOpen} onOpenChange={(open) => {
        setGoogleSelectOpen(open);
        if (!open) resetDialogState();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Google Calendar</DialogTitle>
            <DialogDescription>
              Choose which Google Calendar to sync with Home Manager.
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
                <Select value={selectedGoogleCalendar} onValueChange={handleGoogleCalendarSelect}>
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

              <CalendarNameColorInputs
                name={calendarName}
                color={calendarColor}
                onNameChange={setCalendarName}
                onColorChange={setCalendarColor}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setGoogleSelectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => completeGoogleMutation.mutate({
                googleCalendarId: selectedGoogleCalendar,
                name: calendarName,
                color: calendarColor,
              })}
              disabled={!selectedGoogleCalendar || !calendarName || completeGoogleMutation.isPending}
            >
              {completeGoogleMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Connect & Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Outlook Calendar Selection Dialog */}
      <Dialog open={outlookSelectOpen} onOpenChange={(open) => {
        setOutlookSelectOpen(open);
        if (!open) resetDialogState();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Outlook Calendar</DialogTitle>
            <DialogDescription>
              Choose which Outlook Calendar to sync with Home Manager.
            </DialogDescription>
          </DialogHeader>

          {loadingOutlookCalendars ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Outlook Calendar</Label>
                <Select value={selectedOutlookCalendar} onValueChange={handleOutlookCalendarSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a calendar" />
                  </SelectTrigger>
                  <SelectContent>
                    {outlookCalendars?.calendars.map((cal) => (
                      <SelectItem key={cal.id} value={cal.id}>
                        <div className="flex items-center gap-2">
                          {cal.name}
                          {cal.isDefaultCalendar && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              Default
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <CalendarNameColorInputs
                name={calendarName}
                color={calendarColor}
                onNameChange={setCalendarName}
                onColorChange={setCalendarColor}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOutlookSelectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => completeOutlookMutation.mutate({
                outlookCalendarId: selectedOutlookCalendar,
                name: calendarName,
                color: calendarColor,
              })}
              disabled={!selectedOutlookCalendar || !calendarName || completeOutlookMutation.isPending}
            >
              {completeOutlookMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Connect & Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import ICS Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        setImportDialogOpen(open);
        if (!open) {
          setImportFile(null);
          setImportCalendarId('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import ICS File</DialogTitle>
            <DialogDescription>
              Import events from an ICS file into one of your calendars.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Target Calendar</Label>
              <Select value={importCalendarId} onValueChange={setImportCalendarId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a calendar" />
                </SelectTrigger>
                <SelectContent>
                  {localCalendars.map((cal) => (
                    <SelectItem key={cal.id} value={cal.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: cal.color }}
                        />
                        {cal.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>ICS File</Label>
              <Input
                type="file"
                accept=".ics,text/calendar"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!importFile || !importCalendarId || importMutation.isPending}
            >
              {importMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Calendar Dialog */}
      <Dialog open={!!manageCalendar && !sharingDialogOpen && !publicLinkDialogOpen} onOpenChange={(open) => {
        if (!open) setManageCalendar(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Manage Calendar
            </DialogTitle>
            <DialogDescription>
              {manageCalendar?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => setSharingDialogOpen(true)}
            >
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4" />
                Share with Households
              </div>
              <ChevronRight className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => setPublicLinkDialogOpen(true)}
            >
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Public Subscription Link
              </div>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManageCalendar(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calendar Sharing Dialog */}
      {manageCalendar && (
        <CalendarSharingDialog
          calendar={manageCalendar}
          open={sharingDialogOpen}
          onOpenChange={(open) => {
            setSharingDialogOpen(open);
            if (!open) setManageCalendar(null);
          }}
        />
      )}

      {/* Public Link Dialog */}
      <Dialog open={publicLinkDialogOpen && !!manageCalendar} onOpenChange={(open) => {
        setPublicLinkDialogOpen(open);
        if (!open) setManageCalendar(null);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Public Subscription Link
            </DialogTitle>
            <DialogDescription>
              {manageCalendar?.name}
            </DialogDescription>
          </DialogHeader>

          {manageCalendar && <CalendarPublicLinkCard calendar={manageCalendar} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setPublicLinkDialogOpen(false);
              setManageCalendar(null);
            }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncedCalendarItem({
  calendar,
  onSync,
  onDisconnect,
  onManage,
  isSyncing,
  isDisconnecting,
}: {
  calendar: Calendar;
  onSync: () => void;
  onDisconnect: () => void;
  onManage?: () => void;
  isSyncing: boolean;
  isDisconnecting: boolean;
}) {
  const getSyncStatusBadge = () => {
    if (calendar.syncError) {
      return <Badge variant="destructive">Error</Badge>;
    }
    if (calendar.lastSyncAt) {
      const lastSync = new Date(calendar.lastSyncAt);
      const hoursSince = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 2) {
        return <Badge variant="default" className="bg-green-500">Synced</Badge>;
      }
    }
    return <Badge variant="secondary">Pending</Badge>;
  };

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-3">
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: calendar.color }}
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{calendar.name}</span>
            {getSyncStatusBadge()}
            <Badge variant="outline" className="text-xs">
              {calendar.syncProvider}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {calendar.lastSyncAt
              ? `Last synced ${formatDistanceToNow(new Date(calendar.lastSyncAt))} ago`
              : 'Never synced'}
          </div>
          {calendar.syncError && (
            <div className="text-sm text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3" />
              {calendar.syncError.split('|count:')[0]}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onManage}
            title="Manage calendar"
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onSync}
          disabled={isSyncing}
          title="Sync now"
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDisconnect}
          disabled={isDisconnecting}
          title="Disconnect"
        >
          <Unlink className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CalendarNameColorInputs({
  name,
  color,
  onNameChange,
  onColorChange,
}: {
  name: string;
  color: string;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>Calendar Name</Label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Enter calendar name"
        />
      </div>

      <div className="space-y-2">
        <Label>Calendar Color</Label>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="w-12 h-10 p-1 cursor-pointer"
          />
          <Input
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            placeholder="#3B82F6"
            className="flex-1"
          />
        </div>
      </div>
    </>
  );
}
