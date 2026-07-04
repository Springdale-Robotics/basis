import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExternalLink, RotateCw, Trash2, CheckCircle2, AlertCircle, Clock, Bug } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { getErrorMessage } from '@/lib/api-error';
import { toast } from '@/hooks/useToast';
import { bugReportsApi, type BugReportStatus, type BugReportSummary } from '@/api/bug-reports';

function StatusBadge({ status }: { status: BugReportStatus }) {
  if (status === 'sent') {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        sent
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="destructive">
        <AlertCircle className="mr-1 h-3 w-3" />
        failed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Clock className="mr-1 h-3 w-3" />
      pending
    </Badge>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function BugReportsSettingsPage() {
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<BugReportSummary | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['bug-reports'],
    queryFn: bugReportsApi.list,
    refetchInterval: 10_000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => bugReportsApi.retry(id),
    onSuccess: () => {
      toast({ title: 'Retry queued' });
      qc.invalidateQueries({ queryKey: ['bug-reports'] });
    },
    onError: (err) =>
      toast({
        title: 'Retry failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => bugReportsApi.delete(id),
    onSuccess: () => {
      toast({ title: 'Report deleted' });
      qc.invalidateQueries({ queryKey: ['bug-reports'] });
      setDeleteTarget(null);
    },
    onError: (err) =>
      toast({
        title: 'Delete failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bug Reports</CardTitle>
        <CardDescription>
          User-submitted bug reports are stored locally and pushed to GitHub Issues.
          Configure <code>GITHUB_BUG_REPORT_TOKEN</code> in the backend environment to
          enable delivery; retry any reports that failed below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data || data.reports.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Bug className="h-8 w-8" />}
            title="No bug reports yet"
            description="Reports you submit from the app will show up here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.reports.map((r: BugReportSummary) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                    {r.attempts > 1 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ×{r.attempts}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div className="line-clamp-2 text-sm">{r.description}</div>
                    {r.lastError && (
                      <div className="mt-1 text-xs text-destructive line-clamp-1">
                        {r.lastError}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{r.url}</code>
                  </TableCell>
                  <TableCell>
                    {r.githubIssueUrl ? (
                      <a
                        href={r.githubIssueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        #{r.githubIssueNumber}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      {r.status !== 'sent' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => retryMutation.mutate(r.id)}
                          disabled={retryMutation.isPending}
                          title="Retry"
                        >
                          <RotateCw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(r)}
                        disabled={deleteMutation.isPending}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete bug report?"
        description="The report and its delivery history will be permanently removed. This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </Card>
  );
}
