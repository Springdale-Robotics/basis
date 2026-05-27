import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Database,
  HardDrive,
  Server,
  Archive,
  Clock,
} from 'lucide-react';
import { settingsApi } from '@/api/settings';

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

function ServiceStateBadge({ state }: { state: string }) {
  if (state === 'active') {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        active
      </Badge>
    );
  }
  if (state === 'failed') {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 h-3 w-3" />
        failed
      </Badge>
    );
  }
  if (state === 'inactive') {
    return (
      <Badge variant="secondary">
        <AlertTriangle className="mr-1 h-3 w-3" />
        inactive
      </Badge>
    );
  }
  if (state === 'not-installed') {
    return <Badge variant="outline">not installed</Badge>;
  }
  return <Badge variant="outline">{state}</Badge>;
}

export function SystemSettingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['system', 'status'],
    queryFn: settingsApi.getSystemStatus,
    refetchInterval: 15_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const diskPercent =
    data.storage.totalBytes && data.storage.usedBytes
      ? Math.round((data.storage.usedBytes / data.storage.totalBytes) * 100)
      : null;

  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>
            Health of the running Basis stack — services, disk, database, backups.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Server className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Backend version</p>
                <p className="text-sm font-medium">{data.version}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Backend uptime</p>
                <p className="text-sm font-medium">{formatDuration(data.backendUptimeSec)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Host uptime</p>
                <p className="text-sm font-medium">{formatDuration(data.hostUptimeSec)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Services</CardTitle>
          <CardDescription>
            systemd unit states. "Not installed" means this host runs the stack a
            different way (dev mode, container, macOS, etc.).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.services.map((s) => (
            <div key={s.name} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{s.name}</span>
                {s.uptimeSec !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    up {formatDuration(s.uptimeSec)}
                  </span>
                )}
              </div>
              <ServiceStateBadge state={s.state} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Disk + DB */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Storage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">Disk ({data.storage.path})</p>
                {data.storage.totalBytes && (
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(data.storage.usedBytes)} / {formatBytes(data.storage.totalBytes)}
                    {diskPercent !== null && ` · ${diskPercent}%`}
                  </p>
                )}
              </div>
              {data.storage.error ? (
                <p className="mt-1 text-xs text-destructive">{data.storage.error}</p>
              ) : diskPercent !== null ? (
                <Progress value={diskPercent} className="mt-2" />
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">PostgreSQL database</p>
              <p className="text-xs text-muted-foreground">
                {data.database.error
                  ? data.database.error
                  : `Current size: ${formatBytes(data.database.bytes)}`}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">Last backup</p>
              {data.lastBackup.filename ? (
                <p className="text-xs text-muted-foreground">
                  {data.lastBackup.filename} ·{' '}
                  {new Date(data.lastBackup.mtime!).toLocaleString()} ·{' '}
                  {formatBytes(data.lastBackup.bytes)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No backups yet. (Backup scheduler is coming — see Backup settings.)
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Status refreshes every 15 seconds · Last updated {new Date(data.timestamp).toLocaleTimeString()}
      </p>
    </div>
  );
}
