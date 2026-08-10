import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReceiptLinkManager } from '@/components/inventory/ReceiptLinkManager';
import { receiptsApi, type ReceiptScanStatus } from '@/api/receipts';

const STATUS_VARIANT: Record<ReceiptScanStatus, 'default' | 'secondary' | 'destructive'> = {
  processing: 'secondary',
  review: 'default',
  confirmed: 'secondary',
  cancelled: 'secondary',
  failed: 'destructive',
};

// Scan history, so an interrupted review is findable again, plus the link
// manager — this repo has no dedicated inventory settings surface, and this
// is the most plausible place a user would look to manage receipt scans.
export function ReceiptsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['receipt-scans'],
    queryFn: () => receiptsApi.listScans(),
  });

  const scans = data?.scans ?? [];

  return (
    <div>
      <PageHeader
        title="Receipt scans"
        description="Review past scans and manage what's been learned from them"
        actions={
          <Button variant="outline" onClick={() => navigate('/inventory')}>
            Back to inventory
          </Button>
        }
      />

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="links">Remembered lines</TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="space-y-2 pt-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : scans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No receipts scanned yet. Use <strong>Scan Receipt</strong> on the inventory page.
            </p>
          ) : (
            scans.map((scan) => (
              <Card
                key={scan.id}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/40"
                onClick={() => navigate(`/inventory/receipts/${scan.id}`)}
              >
                <div className="flex items-center gap-3">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{scan.merchant ?? 'Unknown merchant'}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(scan.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[scan.status]}>{scan.status}</Badge>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="links" className="pt-4">
          <ReceiptLinkManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
