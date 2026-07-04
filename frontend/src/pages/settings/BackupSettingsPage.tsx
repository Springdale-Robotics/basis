import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Archive, Download, Loader2, Plus, Trash2, Info, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { settingsApi } from '@/api/settings';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { API_BASE_URL } from '@/lib/constants';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

export function BackupSettingsPage() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['system', 'backups'],
    queryFn: settingsApi.listSystemBackups,
  });

  const createMutation = useMutation({
    mutationFn: settingsApi.createSystemBackup,
    onSuccess: (res) => {
      toast({
        title: 'Backup created',
        description: `${res.filename} · ${formatBytes(res.bytes)} · ${(res.elapsedMs / 1000).toFixed(1)}s`,
      });
      queryClient.invalidateQueries({ queryKey: ['system', 'backups'] });
    },
    onError: (err) => {
      toast({
        title: 'Backup failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: settingsApi.deleteSystemBackup,
    onSuccess: () => {
      toast({ title: 'Backup deleted' });
      queryClient.invalidateQueries({ queryKey: ['system', 'backups'] });
      setDeleteTarget(null);
    },
    onError: (err) =>
      toast({
        title: 'Delete failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  const restoreMutation = useMutation({
    mutationFn: settingsApi.restoreSystemBackup,
    onSuccess: (res) => {
      toast({ title: 'Database restored', description: res.message });
      // Everything may have changed under us; refetch all server state.
      queryClient.invalidateQueries();
      setRestoreTarget(null);
    },
    onError: (err) =>
      toast({
        title: 'Restore failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2 h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Backups</CardTitle>
              <CardDescription>
                Full PostgreSQL dumps of the Basis database, gzipped and stored under{' '}
                <code className="rounded bg-muted px-1">{data.backupDir}</code>.
              </CardDescription>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !data.pgDumpAvailable}
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Back up now
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {!data.pgDumpAvailable && (
            <Alert variant="destructive" className="mb-4">
              <Info className="h-4 w-4" />
              <AlertTitle>pg_dump is not installed on this host</AlertTitle>
              <AlertDescription>
                Install the PostgreSQL client tools to enable backups:
                <code className="ml-1 rounded bg-muted px-1">
                  sudo apt install postgresql-client
                </code>{' '}
                (Ubuntu/Debian). On a production install via{' '}
                <code className="rounded bg-muted px-1">install.sh</code>, this is
                already handled.
              </AlertDescription>
            </Alert>
          )}

          {data.backups.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <Archive className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No backups yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click "Back up now" to create your first backup.
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {data.backups.map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(b.mtime).toLocaleString()} · {formatBytes(b.bytes)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      title="Download"
                    >
                      <a
                        href={`${API_BASE_URL}/system/backups/${encodeURIComponent(b.filename)}/download`}
                        download={b.filename}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Restore"
                      disabled={restoreMutation.isPending}
                      onClick={() => setRestoreTarget(b.filename)}
                    >
                      {restoreMutation.isPending && restoreTarget === b.filename ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => setDeleteTarget(b.filename)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Restoring</CardTitle>
          <CardDescription>
            Use the restore action on any backup above to replace the current database
            with its contents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Restore is destructive and atomic</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Restoring replaces all current data with the backup's contents in a
                single transaction — if it fails, the existing database is left
                untouched. Everyone is signed out afterward; sign back in, and restart
                the app if anything looks stale.
              </p>
              <p>
                It requires <code className="rounded bg-muted px-1">psql</code> on the
                host (installed automatically by the production installer).
              </p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Restore confirmation */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title="Restore this backup?"
        description={
          <>
            This replaces <strong>all current data</strong> with the contents of{' '}
            <code>{restoreTarget}</code>. Anything created since this backup was
            taken will be lost, and everyone will be signed out. This can't be
            undone.
          </>
        }
        confirmText="Restore"
        variant="destructive"
        isPending={restoreMutation.isPending}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this backup?"
        description={
          <>
            <code>{deleteTarget}</code> will be permanently removed. This can't
            be undone.
          </>
        }
        confirmText="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
      />
    </div>
  );
}
