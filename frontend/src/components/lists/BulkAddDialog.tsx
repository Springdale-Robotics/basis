import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface BulkAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (lines: string[]) => Promise<void> | void;
}

export function BulkAddDialog({ open, onOpenChange, onSubmit }: BulkAddDialogProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = text
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);

  const submit = async () => {
    if (lines.length === 0) return;
    setBusy(true);
    try {
      await onSubmit(lines);
      setText('');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk add items</DialogTitle>
          <DialogDescription>
            One item per line. Bullets, numbers, and dashes are stripped.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="bulk">Items</Label>
          <Textarea
            id="bulk"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Sunscreen\nBeach towels\n- Cooler\n1. Bathing suits'}
            rows={10}
            className="font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {lines.length} item{lines.length === 1 ? '' : 's'} to add
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={lines.length === 0 || busy}>
            {busy ? 'Adding…' : `Add ${lines.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
