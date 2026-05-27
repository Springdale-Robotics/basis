import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Globe, Cloud, Network, Laptop, Copy, Check as CheckIcon, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  settingsApi,
  type RemoteAccessMode,
  type TailscaleDetectResult,
  type TailscaleIssue,
  type CloudflaredStatus,
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

          <ModeSwitchWarning
            previousMode={data?.remoteAccess.mode}
            newMode={mode}
          />

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

          {selectedMode.id === 'cloudflare' && (
            <CloudflarePanel publicUrl={publicUrl} setPublicUrl={setPublicUrl} />
          )}

          {selectedMode.id === 'custom_domain' && (
            <CustomDomainPanel publicUrl={publicUrl} />
          )}

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

// ─── Cloudflare Tunnel guided setup ───────────────────────────────────────

function CloudflarePanel({
  publicUrl,
  setPublicUrl,
}: {
  publicUrl: string;
  setPublicUrl: (v: string) => void;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings', 'remote-access', 'cloudflare'],
    queryFn: settingsApi.detectCloudflared,
    refetchInterval: (q) =>
      // While the tunnel is running, poll occasionally so the UI catches
      // unexpected exits.
      (q.state.data as CloudflaredStatus | undefined)?.running ? 15_000 : false,
  });

  const connectMutation = useMutation({
    mutationFn: () => settingsApi.connectCloudflare(token, publicUrl),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      queryClient.invalidateQueries({
        queryKey: ['settings', 'remote-access', 'cloudflare'],
      });
      setPublicUrl(res.publicUrl);
      setToken('');
      toast({ title: 'Cloudflare tunnel connected' });
    },
    onError: (err) => {
      toast({
        title: 'Could not connect',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: settingsApi.disconnectCloudflare,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      queryClient.invalidateQueries({
        queryKey: ['settings', 'remote-access', 'cloudflare'],
      });
      setPublicUrl('');
      toast({ title: 'Cloudflare tunnel disconnected' });
    },
    onError: (err) =>
      toast({
        title: 'Could not disconnect',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (!data) return null;

  if (!data.installed) {
    return (
      <Alert>
        <Cloud className="h-4 w-4" />
        <AlertTitle>cloudflared is not installed</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Install Cloudflare's <code className="rounded bg-muted px-1">cloudflared</code>{' '}
            binary on this host, then refresh. See{' '}
            <a
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-1"
            >
              install instructions <ExternalLink className="h-3 w-3" />
            </a>
            .
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Check again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (data.running) {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertTitle>Cloudflare tunnel is connected</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            cloudflared {data.version && <>(v{data.version}) </>}is running as a managed
            child of this server. The tunnel restarts automatically with the server.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
          >
            {disconnectMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Stop tunnel
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <Cloud className="h-4 w-4" />
      <AlertTitle>cloudflared detected{data.version && ` (v${data.version})`}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Create a tunnel in the{' '}
          <a
            href="https://one.dash.cloudflare.com/"
            target="_blank"
            rel="noreferrer"
            className="underline inline-flex items-center gap-1"
          >
            Cloudflare Zero Trust dashboard <ExternalLink className="h-3 w-3" />
          </a>
          , then paste the connector token below. We'll run it as a managed child
          process — no <code className="rounded bg-muted px-1">systemctl</code>{' '}
          required.
        </p>
        <div className="space-y-2">
          <Label htmlFor="cf-token">Tunnel token</Label>
          <Input
            id="cf-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhIjoi…"
            autoComplete="off"
          />
        </div>
        {data.lastError && (
          <p className="text-xs text-destructive">
            Last attempt: {data.lastError}
          </p>
        )}
        <Button
          size="sm"
          onClick={() => connectMutation.mutate()}
          disabled={
            connectMutation.isPending ||
            token.trim().length < 20 ||
            !publicUrl ||
            !!validateUrl(publicUrl, false)
          }
        >
          {connectMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Connect tunnel
        </Button>
        {(!publicUrl || !!validateUrl(publicUrl, false)) && (
          <p className="text-xs text-muted-foreground">
            Set the Public URL above first (e.g. https://home.yourdomain.com) — that's
            the hostname your tunnel routes to.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

// ─── Custom Domain: reachability probe + reverse-proxy snippets ───────────

function CustomDomainPanel({ publicUrl }: { publicUrl: string }) {
  const [result, setResult] = useState<{
    ok: boolean;
    status?: number;
    elapsedMs: number;
    reason?: string;
  } | null>(null);

  const urlError = publicUrl ? validateUrl(publicUrl, false) : 'URL is required';

  const testMutation = useMutation({
    mutationFn: () => settingsApi.testRemoteUrl(publicUrl),
    onSuccess: (data) => setResult(data),
    onError: (err) => {
      toast({
        title: 'Test failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  // Derive the hostname for templating into reverse-proxy snippets. Falls back
  // to "home.yourdomain.com" so the snippets are still copy-pasteable when the
  // user hasn't filled in a URL yet.
  const host = (() => {
    try {
      return new URL(publicUrl).host;
    } catch {
      return 'home.yourdomain.com';
    }
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || !!urlError}
        >
          {testMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Test reachability
        </Button>
        {result && (
          <div className="flex items-center gap-2 text-sm">
            {result.ok ? (
              <>
                <CheckIcon className="h-4 w-4 text-green-600" />
                <span>
                  Reached in {result.elapsedMs}ms ({result.status})
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-destructive">{result.reason}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div>
        <Label className="text-sm">Reverse-proxy config</Label>
        <p className="mb-2 text-xs text-muted-foreground">
          The backend serves plain HTTP — front it with one of these. Copy, drop
          into your proxy config, reload, done.
        </p>
        <Tabs defaultValue="caddy">
          <TabsList>
            <TabsTrigger value="caddy">Caddy</TabsTrigger>
            <TabsTrigger value="nginx">nginx</TabsTrigger>
          </TabsList>
          <TabsContent value="caddy">
            <ConfigSnippet snippet={caddySnippet(host)} />
          </TabsContent>
          <TabsContent value="nginx">
            <ConfigSnippet snippet={nginxSnippet(host)} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ConfigSnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 pr-12 text-xs">
        {snippet}
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-1 top-1"
        onClick={copy}
      >
        {copied ? <CheckIcon className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function caddySnippet(host: string): string {
  return `${host} {
  reverse_proxy http://localhost:3000
}`;
}

function nginxSnippet(host: string): string {
  return `server {
  listen 443 ssl http2;
  server_name ${host};

  ssl_certificate     /etc/letsencrypt/live/${host}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${host}/privkey.pem;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;

    # WebSocket
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}`;
}

// ─── Mode-switch cleanup warning ──────────────────────────────────────────

/**
 * When the user picks a different mode in the picker, the previously-saved
 * mode's managed infra (Tailscale serve, Cloudflare tunnel) may still be
 * running. Surface a banner so they can tear it down before saving rather
 * than discovering the leftover serve weeks later.
 */
function ModeSwitchWarning({
  previousMode,
  newMode,
}: {
  previousMode: RemoteAccessMode | undefined;
  newMode: RemoteAccessMode;
}) {
  const queryClient = useQueryClient();

  const isLeavingTailscale = previousMode === 'tailscale' && newMode !== 'tailscale';
  const isLeavingCloudflare = previousMode === 'cloudflare' && newMode !== 'cloudflare';
  const shouldShow = isLeavingTailscale || isLeavingCloudflare;

  // Probe whichever managed setup the user is leaving so we only warn if it's
  // actually running right now. Skipping the query when not relevant avoids
  // extra requests on every render.
  const { data: tailscaleStatus } = useQuery({
    queryKey: ['settings', 'remote-access', 'tailscale'],
    queryFn: settingsApi.detectTailscale,
    enabled: isLeavingTailscale,
  });
  const { data: cloudflaredStatus } = useQuery({
    queryKey: ['settings', 'remote-access', 'cloudflare'],
    queryFn: settingsApi.detectCloudflared,
    enabled: isLeavingCloudflare,
  });

  const tailscaleRunning = isLeavingTailscale && tailscaleStatus?.serve.configured;
  const cloudflareRunning = isLeavingCloudflare && cloudflaredStatus?.running;

  const stopTailscale = useMutation({
    mutationFn: settingsApi.disableTailscale,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      queryClient.invalidateQueries({
        queryKey: ['settings', 'remote-access', 'tailscale'],
      });
      toast({ title: 'Tailscale serve stopped' });
    },
    onError: (err) =>
      toast({
        title: 'Could not stop',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  const stopCloudflare = useMutation({
    mutationFn: settingsApi.disconnectCloudflare,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'remote-access'] });
      queryClient.invalidateQueries({
        queryKey: ['settings', 'remote-access', 'cloudflare'],
      });
      toast({ title: 'Cloudflare tunnel stopped' });
    },
    onError: (err) =>
      toast({
        title: 'Could not stop',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  if (!shouldShow || (!tailscaleRunning && !cloudflareRunning)) return null;

  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Previous setup is still running</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          You're switching away from <strong>{previousMode}</strong>, but the{' '}
          {tailscaleRunning ? 'Tailscale serve' : 'Cloudflare tunnel'} on this
          host is still active. Saving the new mode won't stop it — tear it down
          here so it doesn't keep serving in the background.
        </p>
        {tailscaleRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => stopTailscale.mutate()}
            disabled={stopTailscale.isPending}
          >
            {stopTailscale.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Stop Tailscale serve
          </Button>
        )}
        {cloudflareRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => stopCloudflare.mutate()}
            disabled={stopCloudflare.isPending}
          >
            {stopCloudflare.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Stop Cloudflare tunnel
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
