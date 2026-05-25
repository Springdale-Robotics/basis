import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Smartphone, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { appPasswordsApi, type AppPasswordSummary } from '@/api/app-passwords';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function AppPasswordsCard() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users', 'me', 'app-passwords'],
    queryFn: appPasswordsApi.list,
  });

  const items = (data?.appPasswords ?? []).filter((p) => !p.revokedAt);

  const revokeMutation = useMutation({
    mutationFn: (id: string) => appPasswordsApi.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'me', 'app-passwords'] });
      toast({ title: 'Device disconnected' });
    },
    onError: (err) =>
      toast({ title: 'Could not disconnect', description: getErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Connected devices
          </CardTitle>
          <CardDescription>
            Phones, tablets, and desktop calendar apps that connect to Home Manager via CalDAV.
            Each connection has its own credential — disconnect any one of them at any time
            without affecting the others.{' '}
            <Link to="/calendar/connect" className="underline">
              Connect a new device
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices connected yet. Use{' '}
              <Link to="/calendar/connect" className="underline">
                Connect a device
              </Link>{' '}
              to set up an iPhone, Mac, or Android with a one-tap install.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {items.map((item: AppPasswordSummary) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.lastUsedAt
                        ? `Last seen ${formatRelative(item.lastUsedAt)}`
                        : 'Not connected yet'}{' '}
                      · Added {formatRelative(item.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeMutation.mutate(item.id)}
                    disabled={revokeMutation.isPending}
                    aria-label={`Disconnect ${item.label}`}
                    title="Disconnect this device"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

    </>
  );
}
