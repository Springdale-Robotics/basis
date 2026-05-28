import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Link2,
  Copy,
  RefreshCw,
  Trash2,
  Loader2,
  ExternalLink,
  Check,
  Globe,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { calendarsApi } from '@/api/calendars';
import { settingsApi } from '@/api/settings';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Calendar } from '@/types/models';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { copyToClipboard as copyText } from '@/lib/clipboard';

interface CalendarPublicLinkCardProps {
  calendar: Calendar;
}

export function CalendarPublicLinkCard({ calendar }: CalendarPublicLinkCardProps) {
  const queryClient = useQueryClient();
  const [copiedField, setCopiedField] = useState<'feed' | 'webcal' | null>(null);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);

  // Get current public link status
  const { data: linkStatus, isLoading } = useQuery({
    queryKey: ['calendar-public-link', calendar.id],
    queryFn: () => calendarsApi.getPublicLinkStatus(calendar.id),
  });

  // Generate public link
  const generateMutation = useMutation({
    mutationFn: () => calendarsApi.generatePublicLink(calendar.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-public-link', calendar.id] });
      toast({
        title: 'Public Link Created',
        description: 'Your calendar can now be subscribed to from external apps.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to Create Link',
        description: 'Could not generate public link.',
        variant: 'destructive',
      });
    },
  });

  // Revoke public link
  const revokeMutation = useMutation({
    mutationFn: () => calendarsApi.revokePublicLink(calendar.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-public-link', calendar.id] });
      setShowRevokeDialog(false);
      toast({
        title: 'Link Revoked',
        description: 'External apps can no longer access this calendar.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to Revoke',
        description: 'Could not revoke public link.',
        variant: 'destructive',
      });
    },
  });

  const copyToClipboard = async (text: string, field: 'feed' | 'webcal') => {
    if (await copyText(text)) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      toast({
        title: 'Copied!',
        description: 'Link copied to clipboard.',
      });
    } else {
      toast({
        title: 'Copy Failed',
        description: 'Could not copy to clipboard.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const isEnabled = linkStatus?.enabled;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Public Subscription Link
          </CardTitle>
          <CardDescription>
            Allow external calendar apps (Apple Calendar, Google Calendar, Outlook)
            to subscribe to this calendar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isEnabled ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Creating a public link allows anyone with the URL to see your calendar events.
                The link can be revoked at any time.
              </p>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                Create Public Link
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  Public Access Enabled
                </Badge>
                {linkStatus.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(linkStatus.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Webcal URL (for one-click subscription) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  One-Click Subscribe (webcal://)
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={linkStatus.webcalUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(linkStatus.webcalUrl!, 'webcal')}
                  >
                    {copiedField === 'webcal' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    asChild
                  >
                    <a href={linkStatus.webcalUrl} title="Open in calendar app">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click the link or open it to subscribe in your calendar app.
                </p>
              </div>

              {/* HTTP URL (for manual subscription) */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  ICS Feed URL
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={linkStatus.feedUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(linkStatus.feedUrl!, 'feed')}
                  >
                    {copiedField === 'feed' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use this URL if your calendar app requires an HTTPS link.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Regenerate Link
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setShowRevokeDialog(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Revoke Access
                </Button>
              </div>

              <TailscaleFunnelToggle />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Public Access?</AlertDialogTitle>
            <AlertDialogDescription>
              External calendar apps that have subscribed to this calendar will
              no longer be able to access it. This action cannot be undone, but
              you can create a new link at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Tailscale Funnel toggle ──────────────────────────────────────────────
// When the host is on Tailscale and the operator wants the public ICS feed
// reachable from the public internet (so Google Calendar etc. can poll it),
// this exposes ONLY the /api/v1/calendars/public path via Tailscale Funnel.
// The rest of the server stays tailnet-only.

function TailscaleFunnelToggle() {
  const queryClient = useQueryClient();
  const { data: detect, isLoading } = useQuery({
    queryKey: ['settings', 'remote-access', 'tailscale'],
    queryFn: settingsApi.detectTailscale,
  });

  const enableMutation = useMutation({
    mutationFn: settingsApi.enableTailscaleFunnel,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access', 'tailscale'] });
      toast({
        title: 'Public access enabled',
        description: `https://${res.publicHostname}${res.path} is now reachable from the public internet.`,
      });
    },
    onError: (err) =>
      toast({
        title: 'Could not enable Funnel',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  const disableMutation = useMutation({
    mutationFn: settingsApi.disableTailscaleFunnel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access', 'tailscale'] });
      toast({ title: 'Funnel disabled' });
    },
    onError: (err) =>
      toast({
        title: 'Could not disable Funnel',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  if (isLoading || !detect?.available) return null;

  // We don't have a "funnel status" endpoint yet (the lib's getServeStatus
  // could be extended) — so keep this as an enable/disable pair with the
  // operator's last action implied. A follow-up could surface the bound state.
  return (
    <Alert className="mt-2">
      <Globe className="h-4 w-4" />
      <AlertTitle>Make publicly subscribable</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-xs">
          Tailscale Funnel can expose <em>only</em> the public ICS feeds to the public internet, so
          calendar services like Google Calendar can subscribe. The rest of your server stays on the
          tailnet.
        </p>
        <p className="text-xs text-muted-foreground">
          Requires Funnel to be enabled for your tailnet (admin console → Access controls).
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => enableMutation.mutate()}
            disabled={enableMutation.isPending}
          >
            {enableMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enable Funnel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => disableMutation.mutate()}
            disabled={disableMutation.isPending}
          >
            {disableMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Disable
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
