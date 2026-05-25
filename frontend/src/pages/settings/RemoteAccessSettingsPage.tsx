import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Globe, Cloud, Network, Laptop } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  settingsApi,
  type RemoteAccessMode,
  type TailscaleDetectResult,
  type TailscaleIssue,
} from '@/api/settings';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { CheckCircle2, ExternalLink, Network as NetworkIcon } from 'lucide-react';

interface ModeOption {
  id: RemoteAccessMode;
  label: string;
  description: string;
  icon: typeof Globe;
  urlPlaceholder: string;
  guidance: string;
  allowsHttp: boolean;
}

const MODES: ModeOption[] = [
  {
    id: 'local_only',
    label: 'Local only',
    description: 'Reachable on your LAN, no remote access',
    icon: Laptop,
    urlPlaceholder: 'http://192.168.1.50:3000',
    guidance:
      'CalDAV requires HTTPS on iOS. Local-only deployments work best with Tailscale (free TLS on *.ts.net) or a local mkcert certificate.',
    allowsHttp: true,
  },
  {
    id: 'tailscale',
    label: 'Tailscale',
    description: 'Reachable on your tailnet with auto-TLS',
    icon: Network,
    urlPlaceholder: 'https://homemanager.tailnet-name.ts.net',
    guidance:
      'Run `tailscale serve --bg --https=443 http://localhost:3000` on the server. Tailscale issues a real Let’s Encrypt cert for your tailnet hostname — CalDAV clients on the tailnet work without warnings.',
    allowsHttp: false,
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Tunnel',
    description: 'Publicly reachable via a Cloudflare tunnel',
    icon: Cloud,
    urlPlaceholder: 'https://home.yourdomain.com',
    guidance:
      'Cloudflare terminates TLS and forwards X-Forwarded-* headers. No additional certificate work is required.',
    allowsHttp: false,
  },
  {
    id: 'custom_domain',
    label: 'Custom domain',
    description: 'Your own domain pointed at this server',
    icon: Globe,
    urlPlaceholder: 'https://home.yourdomain.com',
    guidance:
      'Front the backend with Caddy or nginx for automatic TLS and X-Forwarded-* headers. See backend/DEPLOY.md for sample configs.',
    allowsHttp: false,
  },
];

function validateUrl(value: string, allowsHttp: boolean): string | null {
  if (!value) return 'URL is required';
  try {
    const u = new URL(value);
    if (!allowsHttp && u.protocol !== 'https:') return 'Must use https://';
    if (allowsHttp && !['http:', 'https:'].includes(u.protocol))
      return 'Must use http:// or https://';
    if (value.endsWith('/')) return 'Remove the trailing slash';
    return null;
  } catch {
    return 'Not a valid URL';
  }
}

export function RemoteAccessSettingsPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<RemoteAccessMode>('local_only');
  const [publicUrl, setPublicUrl] = useState('');
  const [localUrl, setLocalUrl] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'remote-access'],
    queryFn: settingsApi.getRemoteAccess,
  });

  useEffect(() => {
    if (data?.remoteAccess) {
      setMode(data.remoteAccess.mode);
      setPublicUrl(data.remoteAccess.publicUrl ?? '');
      setLocalUrl(data.remoteAccess.localUrl ?? '');
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateRemoteAccess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      toast({ title: 'Remote access updated' });
    },
    onError: (err) => {
      toast({
        title: 'Could not save',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const selectedMode = MODES.find((m) => m.id === mode) ?? MODES[0];
  const publicUrlError = publicUrl ? validateUrl(publicUrl, selectedMode.allowsHttp) : null;
  const localUrlError = localUrl ? validateUrl(localUrl, true) : null;
  const hasErrors = !!publicUrlError || !!localUrlError;

  const handleSave = () => {
    if (hasErrors) return;
    updateMutation.mutate({
      mode,
      publicUrl: publicUrl || null,
      localUrl: localUrl || null,
    });
  };

  if (isLoading) {
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Server URL</CardTitle>
          <CardDescription>
            How clients reach this server. Used for ICS feeds, CalDAV, and other
            outbound links the server generates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>Deployment mode</Label>
            <div className="space-y-2">
              {MODES.map((option) => {
                const Icon = option.icon;
                const selected = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    className={cn(
                      'flex w-full items-center gap-4 rounded-lg border p-3 text-left transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full',
                        selected ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{option.label}</p>
                      <p className="text-xs text-muted-foreground">{option.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Alert>
            <AlertTitle>{selectedMode.label}</AlertTitle>
            <AlertDescription>{selectedMode.guidance}</AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="publicUrl">
              {selectedMode.id === 'local_only' ? 'Server URL' : 'Public URL'}
            </Label>
            <Input
              id="publicUrl"
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder={selectedMode.urlPlaceholder}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              No trailing slash. Used as the base for ICS subscription URLs and CalDAV
              endpoints.
            </p>
            {publicUrlError && (
              <p className="text-xs text-destructive">{publicUrlError}</p>
            )}
          </div>

          {selectedMode.id === 'tailscale' && <TailscalePanel publicUrl={publicUrl} setPublicUrl={setPublicUrl} />}

          {selectedMode.id !== 'local_only' && (
            <div className="space-y-2">
              <Label htmlFor="localUrl">Local URL (optional)</Label>
              <Input
                id="localUrl"
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
                placeholder="http://192.168.1.50:3000"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Optional LAN-only URL surfaced to clients on the local network. Not
                used by the server for link generation.
              </p>
              {localUrlError && (
                <p className="text-xs text-destructive">{localUrlError}</p>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || hasErrors}
            >
              {updateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tailscale auto-config panel ───────────────────────────────────────────

const ISSUE_GUIDANCE: Record<TailscaleIssue, { title: string; body: ReactNode }> = {
  not_installed: {
    title: 'Tailscale is not installed on this host',
    body: (
      <>
        Install Tailscale to enable automatic HTTPS (required for iOS Calendar).{' '}
        <a
          href="https://tailscale.com/download"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Get Tailscale
        </a>
        , then sign in and refresh.
      </>
    ),
  },
  needs_login: {
    title: 'Tailscale is installed but not signed in',
    body: (
      <>
        Run <code className="rounded bg-muted px-1">tailscale up</code> on the host, then refresh.
      </>
    ),
  },
  needs_operator: {
    title: 'Backend lacks Tailscale operator permission',
    body: (
      <>
        Grant this user permission to manage Tailscale serve:{' '}
        <code className="rounded bg-muted px-1">sudo tailscale set --operator=$USER</code>
      </>
    ),
  },
  daemon_offline: {
    title: 'Tailscale daemon is not running',
    body: <>Start the Tailscale service on this host, then refresh.</>,
  },
  cli_timeout: {
    title: 'Tailscale CLI did not respond',
    body: <>The CLI call timed out. Check that the daemon is healthy and retry.</>,
  },
  unknown_error: {
    title: 'Tailscale check failed',
    body: <>An unexpected error occurred. See server logs for details.</>,
  },
};

function TailscalePanel({
  publicUrl,
  setPublicUrl,
}: {
  publicUrl: string;
  setPublicUrl: (v: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings', 'remote-access', 'tailscale'],
    queryFn: settingsApi.detectTailscale,
  });

  const enableMutation = useMutation({
    mutationFn: settingsApi.enableTailscale,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access', 'tailscale'] });
      setPublicUrl(res.publicUrl);
      toast({ title: 'Tailscale HTTPS enabled', description: res.publicUrl });
    },
    onError: (err) => {
      toast({
        title: 'Could not enable',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const disableMutation = useMutation({
    mutationFn: settingsApi.disableTailscale,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access', 'tailscale'] });
      setPublicUrl('');
      toast({ title: 'Tailscale serve disabled' });
    },
    onError: (err) =>
      toast({
        title: 'Could not disable',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  if (isLoading) return <Skeleton className="h-32" />;

  if (!data) return null;
  const detect: TailscaleDetectResult = data;

  if (!detect.available) {
    const issue = detect.issues[0] ?? 'unknown_error';
    const guidance = ISSUE_GUIDANCE[issue];
    return (
      <Alert>
        <NetworkIcon className="h-4 w-4" />
        <AlertTitle>{guidance.title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{guidance.body}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Check again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (detect.serve.configured) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertTitle>Tailscale HTTPS is active</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Your server is reachable on the tailnet at{' '}
            <code className="rounded bg-muted px-1">https://{detect.hostname}</code>. Tailscale
            handles cert acquisition and renewal automatically.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => disableMutation.mutate()}
              disabled={disableMutation.isPending}
            >
              {disableMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Stop tailscale serve
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
            >
              <a
                href={`https://${detect.hostname}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <CheckCircle2 className="h-4 w-4 text-green-600" />
      <AlertTitle>Tailscale detected — hostname: {detect.hostname}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          Click below to expose this server over HTTPS at{' '}
          <code className="rounded bg-muted px-1">https://{detect.hostname}</code>. Tailscale will
          obtain and renew a Let’s Encrypt cert automatically — no certificate prompts on iOS.
        </p>
        <Button
          onClick={() => enableMutation.mutate()}
          disabled={enableMutation.isPending}
          size="sm"
        >
          {enableMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enable Tailscale HTTPS
        </Button>
        {publicUrl && publicUrl !== `https://${detect.hostname}` && (
          <p className="text-xs text-muted-foreground">
            (Will overwrite your current Server URL setting.)
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
