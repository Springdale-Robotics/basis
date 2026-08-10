import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { receiptsApi, type ReceiptLineLink } from '@/api/receipts';
import { useToast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';

/**
 * A wrong learned mapping is invisible and self-perpetuating — it silently
 * auto-resolves every future scan of that product the same wrong way. This
 * is the only place a user can see, and undo, one.
 */
export function ReceiptLinkManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [forgetTarget, setForgetTarget] = useState<ReceiptLineLink | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['receipt-links', search],
    queryFn: () => receiptsApi.listLinks(search ? { search } : undefined),
  });

  const forget = useMutation({
    mutationFn: (id: string) => receiptsApi.deleteLink(id),
    onSuccess: () => {
      toast({ title: 'Mapping forgotten' });
      queryClient.invalidateQueries({ queryKey: ['receipt-links'] });
      setForgetTarget(null);
    },
    onError: (error) =>
      toast({
        title: 'Could not forget the mapping',
        description: getErrorMessage(error),
        variant: 'destructive',
      }),
  });

  const links = data?.links ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Remembered receipt lines</h3>
        <p className="text-sm text-muted-foreground">
          The first time you match a receipt line to an item, it's remembered and applied
          automatically on every future scan — without asking again. If one was matched wrong,
          forget it here so the next scan asks instead of repeating the mistake.
        </p>
      </div>

      <Input
        placeholder="Search remembered lines…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search ? 'No remembered lines match that search.' : 'Nothing remembered yet.'}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>Receipt text</TableHead>
                <TableHead>Line key</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Conversion</TableHead>
                <TableHead>Used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="capitalize">{link.merchant}</TableCell>
                  <TableCell>
                    {link.lastRawText ? (
                      link.lastRawText
                    ) : (
                      <span className="italic text-muted-foreground">
                        No receipt text recorded
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {link.lineKey}
                    <Badge variant="outline" className="ml-2">
                      {link.keyKind}
                    </Badge>
                  </TableCell>
                  <TableCell>{link.itemName}</TableCell>
                  <TableCell>
                    1 → {Number(link.unitsPerCount)} {link.itemUnit ?? ''}
                  </TableCell>
                  <TableCell>{link.useCount}×</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setForgetTarget(link)}
                      aria-label={`Forget mapping for ${link.lastRawText ?? link.lineKey}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={forgetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setForgetTarget(null);
        }}
        title="Forget this mapping?"
        description={
          forgetTarget && (
            <>
              The next scan with{' '}
              <strong>{forgetTarget.lastRawText ?? forgetTarget.lineKey}</strong> from{' '}
              <strong>{forgetTarget.merchant}</strong> will ask you to match it again instead of
              auto-applying <strong>{forgetTarget.itemName}</strong>.
            </>
          )
        }
        confirmText="Forget"
        variant="destructive"
        isPending={forget.isPending}
        onConfirm={() => {
          if (forgetTarget) forget.mutate(forgetTarget.id);
        }}
      />
    </div>
  );
}
