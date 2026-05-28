import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Smartphone,
  Laptop,
  Monitor,
  KeyRound,
  Copy,
  Loader2,
  RefreshCw,
  Check,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/layout/PageHeader';
import { settingsApi } from '@/api/settings';
import { appPasswordsApi } from '@/api/app-passwords';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { copyToClipboard } from '@/lib/clipboard';

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (await copyToClipboard(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleCopy}
      aria-label={label ?? `Copy ${value}`}
    >
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
    </div>
  );
}

export function ConnectDevicePage() {
  const { user } = useAuth();
  const { data: tailscale } = useQuery({
    queryKey: ['settings', 'remote-access', 'tailscale'],
    queryFn: settingsApi.detectTailscale,
  });
  const { data: remoteAccess } = useQuery({
    queryKey: ['settings', 'remote-access'],
    queryFn: settingsApi.getRemoteAccess,
  });

  const hostnameSource =
    remoteAccess?.remoteAccess?.publicUrl ||
    (tailscale?.available && tailscale.hostname ? `https://${tailscale.hostname}` : '');
  const hostname = hostnameSource ? new URL(hostnameSource).hostname : '';
  const fullUrl = hostnameSource || '';

  return (
    <div>
      <PageHeader title="Connect a device" />

      <Alert className="mb-4">
        <Smartphone className="h-4 w-4" />
        <AlertTitle>What this does</AlertTitle>
        <AlertDescription>
          One install per device adds <strong>your whole account</strong> to that device's
          native calendar app — not just one calendar. Your phone will see every calendar
          you have access to in this household, and your edits round-trip to the web UI in
          real time. Each device gets its own credential, so you can revoke just one if you
          lose a phone.{' '}
          <Link to="/settings/profile" className="underline">
            See your connected devices
          </Link>
          .
        </AlertDescription>
      </Alert>

      {!hostnameSource && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Server URL not configured</AlertTitle>
          <AlertDescription>
            Set your Server URL in Settings → Remote Access first. CalDAV clients need a stable
            URL to connect to.
          </AlertDescription>
        </Alert>
      )}

      {hostnameSource && (
        <Tabs defaultValue="ios" className="mt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="ios">
              <Smartphone className="mr-2 h-4 w-4" /> iOS
            </TabsTrigger>
            <TabsTrigger value="macos">
              <Laptop className="mr-2 h-4 w-4" /> macOS
            </TabsTrigger>
            <TabsTrigger value="android">
              <Smartphone className="mr-2 h-4 w-4" /> Android
            </TabsTrigger>
            <TabsTrigger value="other">
              <Monitor className="mr-2 h-4 w-4" /> Other
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ios">
            <IosPanel />
          </TabsContent>
          <TabsContent value="macos">
            <ManualPanel hostname={hostname} fullUrl={fullUrl} email={user?.email ?? ''} client="macOS" />
          </TabsContent>
          <TabsContent value="android">
            <AndroidPanel hostname={hostname} fullUrl={fullUrl} email={user?.email ?? ''} />
          </TabsContent>
          <TabsContent value="other">
            <ManualPanel hostname={hostname} fullUrl={fullUrl} email={user?.email ?? ''} client="any CalDAV client" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── iOS: QR + .mobileconfig install ─────────────────────────────────────────

function IosPanel() {
  const [label, setLabel] = useState("Sam's iPhone");
  const generate = useMutation({
    mutationFn: () => settingsApi.generateIosProfile(label.trim() || 'iPhone'),
    onError: (err) =>
      toast({
        title: 'Could not generate profile',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>One-tap install for iOS Calendar</CardTitle>
        <CardDescription>
          Scan the QR with your iPhone's camera. Safari opens the configuration profile, which adds
          the CalDAV account in one tap — no typing, no copying passwords.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="device-label">Device label (so you can revoke later)</Label>
            <Input
              id="device-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Sam's iPhone"
              maxLength={80}
            />
          </div>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {generate.data ? <RefreshCw className="mr-2 h-4 w-4" /> : null}
            {generate.data ? 'Generate new' : 'Generate install profile'}
          </Button>
        </div>

        {generate.data && (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-6">
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-md bg-white p-4">
                <QRCodeSVG value={generate.data.installUrl} size={220} level="M" includeMargin={false} />
              </div>
              <p className="text-xs text-muted-foreground">
                Scan this with iPhone Camera. Expires in {Math.round(generate.data.expiresInSeconds / 60)}{' '}
                minutes. Single use.
              </p>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Or open this URL on your iPhone manually
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={generate.data.installUrl}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton value={generate.data.installUrl} label="Copy install URL" />
              </div>
            </div>
          </div>
        )}

        <Alert>
          <AlertTitle>After scanning</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>iPhone will prompt:</p>
            <ol className="list-decimal pl-5 text-sm">
              <li>"This website is trying to download a configuration profile" → tap Allow.</li>
              <li>Open <strong>Settings → General → VPN &amp; Device Management</strong>.</li>
              <li>Tap the Basis Calendar profile → Install → enter passcode.</li>
              <li>iOS Calendar will start syncing within a few seconds.</li>
            </ol>
            <p className="mt-1 text-xs text-muted-foreground">
              The profile is unsigned — iOS shows "Not Signed" at install. That's expected for
              self-hosted apps.
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

// ─── macOS / Other: manual entry (works for any client) ─────────────────────

function ManualPanel({
  hostname,
  fullUrl,
  email,
  client,
}: {
  hostname: string;
  fullUrl: string;
  email: string;
  client: string;
}) {
  const newPassword = useMutation({
    mutationFn: (lbl: string) => appPasswordsApi.create(lbl),
    onError: (err) =>
      toast({
        title: 'Could not generate password',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Manual setup for {client}</CardTitle>
        <CardDescription>
          Generate a fresh app password, then paste these values into your CalDAV client.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <CopyField label="Server" value={hostname} />
        <CopyField label="Server URL (some clients need the full URL)" value={fullUrl} />
        <CopyField label="Username" value={email} />

        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              <span className="text-sm font-medium">App password</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => newPassword.mutate(`Manual setup — ${new Date().toLocaleString()}`)}
              disabled={newPassword.isPending}
            >
              {newPassword.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate
            </Button>
          </div>
          {newPassword.data ? (
            <>
              <Input
                readOnly
                value={newPassword.data.secret}
                className="font-mono text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <p className="text-xs text-muted-foreground">
                Shown once. If you lose it, generate a new one.
              </p>
              <div className="flex justify-end">
                <CopyButton value={newPassword.data.secret} label="Copy app password" />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Click Generate to mint a one-time password for this device.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Android (DAVx5) ────────────────────────────────────────────────────────

function AndroidPanel({
  hostname,
  fullUrl,
  email,
}: {
  hostname: string;
  fullUrl: string;
  email: string;
}) {
  return (
    <div className="space-y-4">
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Android via DAVx5</CardTitle>
          <CardDescription>
            DAVx5 is the standard open-source CalDAV client for Android. iOS / iCloud-style
            one-tap install isn't available on Android, but DAVx5's URL form takes the same values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Setup steps</AlertTitle>
            <AlertDescription>
              <ol className="list-decimal pl-5 text-sm space-y-1">
                <li>
                  Install DAVx5 from{' '}
                  <a
                    href="https://f-droid.org/packages/at.bitfire.davdroid/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline inline-flex items-center gap-1"
                  >
                    F-Droid <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  or the Play Store.
                </li>
                <li>Open DAVx5 → tap +  → "Login with URL and user name".</li>
                <li>Paste the URL, username, and the app password below.</li>
                <li>Tap Login. DAVx5 will discover the calendar and start syncing.</li>
              </ol>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <ManualPanel hostname={hostname} fullUrl={fullUrl} email={email} client="DAVx5" />
    </div>
  );
}
