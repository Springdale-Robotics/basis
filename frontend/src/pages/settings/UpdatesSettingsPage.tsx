import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowUpCircle, CheckCircle2, ExternalLink, GitBranch, Info, RefreshCw } from 'lucide-react';
import { settingsApi } from '@/api/settings';
import { GuidedInstallDialog } from '@/components/settings/GuidedInstallDialog';

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function UpdatesSettingsPage() {
  const [includePrerelease, setIncludePrerelease] = useState(true);
  const [updateOpen, setUpdateOpen] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['settings', 'updates', includePrerelease],
    queryFn: () => settingsApi.getVersionInfo(includePrerelease),
    // Don't auto-refetch — this hits GitHub's API, no point burning rate limit
    // on a settings page nobody's looking at.
    staleTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>
            Check for new Basis releases on GitHub and apply them with one click.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Current version */}
          <div className="rounded-md border p-4">
            <div className="flex items-center gap-3">
              <GitBranch className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Installed version</p>
                <p className="text-xs text-muted-foreground">
                  {data.productionInstall
                    ? 'Production install at /opt/basis/current'
                    : 'Development mode — running from source via ./dev.sh'}
                </p>
              </div>
              <Badge variant={data.productionInstall ? 'default' : 'secondary'}>
                {data.current}
              </Badge>
            </div>
          </div>

          {/* Check-error or latest-release */}
          {data.checkError ? (
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertTitle>Could not check for updates</AlertTitle>
              <AlertDescription>{data.checkError}</AlertDescription>
            </Alert>
          ) : data.latest ? (
            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-start gap-3">
                {data.updateAvailable ? (
                  <ArrowUpCircle className="mt-0.5 h-5 w-5 text-blue-600" />
                ) : data.productionInstall ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
                ) : (
                  <Info className="mt-0.5 h-5 w-5 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {data.updateAvailable
                        ? 'Update available'
                        : data.productionInstall
                        ? "You're on the latest release"
                        : 'Latest release'}
                    </p>
                    <Badge variant="outline">{data.latest.tag}</Badge>
                    {data.latest.prerelease && (
                      <Badge variant="secondary">pre-release</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Published {formatRelativeDate(data.latest.publishedAt)} ·{' '}
                    <a
                      href={data.latest.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline inline-flex items-center gap-1"
                    >
                      Release notes on GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                </div>
              </div>

              {data.latest.body && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs leading-relaxed">
                  {data.latest.body}
                </pre>
              )}

              {data.updateAvailable && data.productionInstall && (
                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={() => setUpdateOpen(true)}>
                    Update to {data.latest.tag}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Downloads, builds, migrates, and restarts. ~2-3 minutes.
                  </p>
                </div>
              )}

              {data.updateAvailable && !data.productionInstall && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Updates only run on production installs</AlertTitle>
                  <AlertDescription>
                    You're running in dev mode (<code>./dev.sh</code>). To pick up the
                    latest, <code>git pull</code> on the host.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>No releases found</AlertTitle>
              <AlertDescription>
                Nothing matching the current filter has been published yet.
              </AlertDescription>
            </Alert>
          )}

          {/* Settings */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="prerelease-toggle" className="text-sm font-medium">
                  Include pre-releases
                </Label>
                <p className="text-xs text-muted-foreground">
                  Show alpha/beta/rc tags when checking for updates.
                </p>
              </div>
              <Switch
                id="prerelease-toggle"
                checked={includePrerelease}
                onCheckedChange={setIncludePrerelease}
              />
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                Check now
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <GuidedInstallDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        commandId="update-self"
        title={`Update Basis to ${data.latest?.tag ?? 'latest'}`}
        description="Downloads the latest release, builds it, runs database migrations, and restarts the service. You'll lose connection to this terminal briefly when the backend restarts — that's expected. Refresh the page after a minute."
        onSuccess={() => {
          // Trigger a refetch — the post-restart version should match the
          // latest. (Might race with the actual restart; user can refresh.)
          setTimeout(() => refetch(), 5_000);
        }}
      />
    </div>
  );
}
