import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AreaCombobox } from '@/components/inventory/fields';
import { ReceiptLineRow } from '@/components/inventory/ReceiptLineRow';
import { receiptsApi } from '@/api/receipts';
import { inventoryApi } from '@/api/inventory';
import { useToast } from '@/hooks/useToast';
import { ApiError, getErrorMessage } from '@/lib/api-error';

/** Shape of confirm's per-line refusal detail — see receipts.service.ts's `LineIssue`. */
interface LineIssue {
  lineId: string;
  rawText: string;
  reason: string;
}

export function ReceiptScanPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [merchantDraft, setMerchantDraft] = useState<string | null>(null);
  const [showMatched, setShowMatched] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  // Populated from confirm's 400 response so the offending rows are visible,
  // not just named in a toast — raw text alone can't identify which of forty
  // rows to fix when the same product line repeats.
  const [flaggedLines, setFlaggedLines] = useState<Map<string, string>>(new Map());

  const scanQuery = useQuery({
    queryKey: ['receipt-scan', id],
    queryFn: () => receiptsApi.getScan(id),
  });

  const itemsQuery = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getItems(),
  });

  const areasQuery = useQuery({
    queryKey: ['inventory-areas'],
    queryFn: () => inventoryApi.getAreas(),
  });

  const scan = scanQuery.data?.scan;
  const items = itemsQuery.data?.items ?? [];
  const areas = areasQuery.data?.areas ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['receipt-scan', id] });

  const updateLine = useMutation({
    mutationFn: ({ lineId, data }: { lineId: string; data: Parameters<typeof receiptsApi.updateLine>[2] }) =>
      receiptsApi.updateLine(id, lineId, data),
    onSuccess: (_result, { lineId }) => {
      // The edit that just landed is presumably an attempt to fix whatever
      // confirm flagged — clear its highlight rather than leaving a stale one.
      setFlaggedLines((prev) => {
        if (!prev.has(lineId)) return prev;
        const next = new Map(prev);
        next.delete(lineId);
        return next;
      });
      invalidate();
    },
    onError: (error) =>
      toast({ title: 'Could not update the line', description: getErrorMessage(error), variant: 'destructive' }),
  });

  const updateScan = useMutation({
    mutationFn: (data: Parameters<typeof receiptsApi.updateScan>[1]) =>
      receiptsApi.updateScan(id, data),
    onSuccess: invalidate,
    onError: (error) =>
      toast({ title: 'Could not update the receipt', description: getErrorMessage(error), variant: 'destructive' }),
  });

  const createItem = useMutation({
    mutationFn: ({ lineId, name }: { lineId: string; name: string }) =>
      receiptsApi.createItemForLine(id, lineId, { name, unitsPerCount: 1 }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (error) =>
      toast({ title: 'Could not create the item', description: getErrorMessage(error), variant: 'destructive' }),
  });

  const reprocess = useMutation({
    mutationFn: () => receiptsApi.reprocessScan(id),
    onSuccess: invalidate,
    onError: (error) =>
      toast({ title: 'Could not restart processing', description: getErrorMessage(error), variant: 'destructive' }),
  });

  const confirm = useMutation({
    mutationFn: () => receiptsApi.confirmScan(id),
    onSuccess: (result) => {
      setFlaggedLines(new Map());
      toast({
        title: 'Receipt added to inventory',
        description: `${result.stockCreated} item(s) stocked, ${result.linksSaved} mapping(s) remembered.`,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      navigate('/inventory');
    },
    onError: (error) => {
      // Confirm's 400 names exactly which rows it refused and why (raw text
      // alone can't identify one of forty rows when the same product line
      // repeats) — surface that instead of just "N line(s) could not be
      // confirmed."
      const issues: LineIssue[] =
        ApiError.isApiError(error) && Array.isArray(error.details?.lines)
          ? (error.details.lines as LineIssue[])
          : [];

      if (issues.length > 0) {
        setFlaggedLines(new Map(issues.map((issue) => [issue.lineId, issue.reason])));
        // The flagged rows may be sitting inside the collapsed "Matched"
        // section (a line only fails confirm once it's linked) — open it so
        // they're actually visible, then jump to the first one.
        setShowMatched(true);
        requestAnimationFrame(() => {
          document
            .getElementById(`receipt-line-${issues[0].lineId}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        toast({
          title: `${issues.length} line(s) could not be confirmed`,
          description: (
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.slice(0, 6).map((issue) => (
                <li key={issue.lineId} className="text-xs">
                  <span className="font-mono">{issue.rawText}</span> — {issue.reason}
                </li>
              ))}
              {issues.length > 6 && (
                <li className="text-xs">…and {issues.length - 6} more</li>
              )}
            </ul>
          ),
          variant: 'destructive',
        });
        return;
      }

      toast({ title: 'Could not confirm', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  const groups = useMemo(() => {
    const lines = scan?.lines ?? [];
    return {
      unresolved: lines.filter((line) => line.resolution === 'unresolved'),
      matched: lines.filter((line) => line.resolution === 'link'),
      ignored: lines.filter((line) => line.resolution === 'ignore'),
    };
  }, [scan]);

  if (scanQuery.isLoading) return <div className="p-6">Loading…</div>;
  if (!scan) return <div className="p-6">Receipt not found.</div>;

  if (scan.status === 'failed') {
    return (
      <div className="p-6 space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{scan.errorMessage ?? 'This receipt could not be read.'}</AlertDescription>
        </Alert>
        <Button disabled={reprocess.isPending} onClick={() => reprocess.mutate()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {reprocess.isPending ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    );
  }

  // The upload dialog only navigates here once processing reaches "review",
  // but a stale bookmark or a link from the (future) history page can still
  // land while the scan is mid-flight — before there are any lines to show.
  if (scan.status === 'processing') {
    return (
      <div className="p-6 space-y-4">
        <Alert>
          <AlertDescription>
            Still working through this receipt. This page will have lines to review once
            processing finishes.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => scanQuery.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Check again
        </Button>
      </div>
    );
  }

  const alreadyDone = scan.status === 'confirmed' || scan.status === 'cancelled';
  const resolvedCount = groups.matched.length + groups.ignored.length;
  const merchantValue = (merchantDraft ?? scan.merchant ?? '').trim();
  const blocked = alreadyDone || groups.unresolved.length > 0 || !merchantValue;
  const headerDisabled = updateScan.isPending || confirm.isPending;

  const lineProps = {
    items,
    areas,
    disabled: updateLine.isPending || createItem.isPending || confirm.isPending,
    onLink: (lineId: string, itemId: string, unitsPerCount: number) =>
      updateLine.mutate({ lineId, data: { resolution: 'link', itemId, unitsPerCount } }),
    onIgnore: (lineId: string) => updateLine.mutate({ lineId, data: { resolution: 'ignore' } }),
    onUnlink: (lineId: string) => updateLine.mutate({ lineId, data: { resolution: 'unresolved' } }),
    onSetArea: (lineId: string, areaId: string | null) =>
      updateLine.mutate({ lineId, data: { targetAreaId: areaId } }),
    onCreateItem: (lineId: string) => {
      const line = scan.lines.find((l) => l.id === lineId);
      if (!line) return;
      createItem.mutate({ lineId, name: line.rawText });
    },
  };

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Review receipt</h1>
          <Badge variant={blocked ? 'secondary' : 'default'}>
            {resolvedCount} of {scan.lines.length} resolved
          </Badge>
        </div>

        {alreadyDone && (
          <Alert>
            <AlertDescription>
              {scan.status === 'confirmed'
                ? 'This receipt has already been added to inventory.'
                : 'This receipt was cancelled.'}
            </AlertDescription>
          </Alert>
        )}

        {scan.parseWarnings.map((warning) => (
          <Alert key={warning}>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Merchant</Label>
            <Input
              value={merchantDraft ?? scan.merchant ?? ''}
              disabled={headerDisabled}
              onChange={(e) => setMerchantDraft(e.target.value)}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== scan.merchant) updateScan.mutate({ merchant: value });
              }}
              placeholder="Costco"
            />
          </div>
          <div className="space-y-1">
            <Label>Purchase date</Label>
            <Input
              type="date"
              value={scan.purchasedAt ? scan.purchasedAt.slice(0, 10) : ''}
              disabled={headerDisabled}
              onChange={(e) =>
                updateScan.mutate({
                  purchasedAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Default storage area</Label>
            <AreaCombobox
              areas={areas}
              value={scan.defaultAreaId ?? ''}
              onValueChange={(v) => updateScan.mutate({ defaultAreaId: v || null })}
              placeholder="Pick an area"
              allowClear
              clearLabel="None"
              disabled={headerDisabled}
            />
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-medium">Needs attention ({groups.unresolved.length})</h2>
            {groups.unresolved.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Everything on this receipt is resolved.
              </p>
            ) : (
              groups.unresolved.map((line) => (
                <ReceiptLineRow
                  key={line.id}
                  line={line}
                  {...lineProps}
                  flagReason={flaggedLines.get(line.id) ?? null}
                />
              ))
            )}
          </section>

          <Collapsible open={showMatched} onOpenChange={setShowMatched}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="px-0">
                {showMatched ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                Matched ({groups.matched.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              {groups.matched.map((line) => (
                <ReceiptLineRow
                  key={line.id}
                  line={line}
                  {...lineProps}
                  flagReason={flaggedLines.get(line.id) ?? null}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={showIgnored} onOpenChange={setShowIgnored}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="px-0">
                {showIgnored ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                Ignored ({groups.ignored.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              {groups.ignored.map((line) => (
                <ReceiptLineRow key={line.id} line={line} {...lineProps} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* OCR errors are only catchable against the original — desktop only,
            since on a phone the user is holding the actual receipt. */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-2">
            <Label className="text-xs text-muted-foreground">Original receipt</Label>
            <img
              src={receiptsApi.getImageUrl(id)}
              alt="Scanned receipt"
              className="w-full rounded-lg border max-h-[80vh] object-contain"
              onError={(e) => {
                // Pruned by the retention sweep after confirmation — hide
                // rather than show a broken-image frame.
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        </aside>
      </div>

      <div className="sticky bottom-0 border-t bg-background py-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {alreadyDone
            ? scan.status === 'confirmed'
              ? 'Already added to inventory.'
              : 'This scan was cancelled.'
            : groups.unresolved.length > 0
              ? `${groups.unresolved.length} line(s) still need a decision.`
              : !merchantValue
                ? 'Set a merchant before confirming.'
                : updateLine.isPending || createItem.isPending
                  ? 'Saving your last change…'
                  : 'Ready to add to inventory.'}
        </p>
        {/* Also blocked while a line-level PATCH is in flight: once every line is
            resolved, `blocked` is false regardless of whether an edit to a
            resolved line (its area, its conversion) has landed yet, so a quick
            click could confirm against stale line state. */}
        <Button
          disabled={
            blocked || confirm.isPending || updateLine.isPending || createItem.isPending
          }
          onClick={() => confirm.mutate()}
        >
          {confirm.isPending ? 'Adding…' : 'Add to inventory'}
        </Button>
      </div>
    </div>
  );
}
