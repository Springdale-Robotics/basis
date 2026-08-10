import { useEffect, useState } from 'react';
import { Check, X, Plus, Link2Off, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { AreaCombobox } from '@/components/inventory/fields';
import type { ReceiptScanLine, ReceiptLineSuggestion } from '@/api/receipts';
import type { StorageArea, InventoryItem } from '@/types/models';

interface ReceiptLineRowProps {
  line: ReceiptScanLine;
  items: InventoryItem[];
  areas: StorageArea[];
  onLink: (lineId: string, itemId: string, unitsPerCount: number) => void;
  onIgnore: (lineId: string) => void;
  onUnlink: (lineId: string) => void;
  onSetArea: (lineId: string, areaId: string | null) => void;
  onCreateItem: (lineId: string) => void;
  disabled?: boolean;
  /** Set when confirm just refused this line — shown inline so the user
   *  doesn't have to cross-reference the toast against forty rows. */
  flagReason?: string | null;
}

/** A confidence low enough that the OCR read is worth eyeballing. */
const LOW_CONFIDENCE = 0.6;

export function ReceiptLineRow({
  line,
  items,
  areas,
  onLink,
  onIgnore,
  onUnlink,
  onSetArea,
  onCreateItem,
  disabled,
  flagReason,
}: ReceiptLineRowProps) {
  const linkedItem = items.find((item) => item.id === line.itemId);
  const [conversion, setConversion] = useState(line.unitsPerCount ?? '1');
  const [search, setSearch] = useState('');

  // Resync when the server hands back a different value for this line (a
  // fresh link, an external edit) — but not on every render, so an in-flight
  // keystroke isn't clobbered by an unrelated refetch.
  useEffect(() => {
    setConversion(line.unitsPerCount ?? '1');
  }, [line.id, line.unitsPerCount]);

  const lowConfidence =
    line.ocrConfidence !== null && Number(line.ocrConfidence) < LOW_CONFIDENCE;

  const searchResults = search.trim()
    ? items
        .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  const commitConversion = (value: string) => {
    const parsed = Number(value);
    if (line.itemId && Number.isFinite(parsed) && parsed > 0) {
      onLink(line.id, line.itemId, parsed);
    }
  };

  return (
    <div
      id={`receipt-line-${line.id}`}
      className={`border rounded-lg p-3 space-y-3 ${
        flagReason ? 'border-destructive ring-1 ring-destructive' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm">{line.rawText}</span>
            {lowConfidence && (
              <Badge variant="outline" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Low confidence — check against the photo
              </Badge>
            )}
          </div>
          {flagReason && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Could not confirm: {flagReason}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {line.merchantCode && <span className="mr-2">#{line.merchantCode}</span>}
            <span className="mr-2">×{Number(line.count)}</span>
            {line.price && <span>${Number(line.price).toFixed(2)}</span>}
          </p>
        </div>

        {line.resolution !== 'ignore' && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onIgnore(line.id)}>
            <X className="mr-1 h-3 w-3" />
            Ignore
          </Button>
        )}
      </div>

      {line.resolution === 'link' && linkedItem ? (
        <div className="flex flex-wrap items-end gap-3">
          <Badge className="gap-1">
            <Check className="h-3 w-3" />
            {linkedItem.name}
          </Badge>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              1 × this line =
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="0"
                step="any"
                className="w-24"
                value={conversion}
                disabled={disabled}
                onChange={(e) => setConversion(e.target.value)}
                onBlur={(e) => commitConversion(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">
                {linkedItem.defaultUnit ?? 'units'}
              </span>
            </div>
          </div>

          <div className="space-y-1 w-[180px]">
            <Label className="text-xs text-muted-foreground">Storage area</Label>
            <AreaCombobox
              areas={areas}
              value={line.targetAreaId ?? ''}
              onValueChange={(v) => onSetArea(line.id, v || null)}
              placeholder="Use default"
              allowClear
              clearLabel="Use default"
              disabled={disabled}
            />
          </div>

          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onUnlink(line.id)}>
            <Link2Off className="mr-1 h-3 w-3" />
            Unlink
          </Button>
        </div>
      ) : line.resolution === 'ignore' ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Ignored</Badge>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onUnlink(line.id)}>
            Undo
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {line.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {line.suggestions.slice(0, 3).map((suggestion: ReceiptLineSuggestion) => (
                <Button
                  key={suggestion.itemId}
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onLink(line.id, suggestion.itemId, Number(conversion) || 1)}
                >
                  {suggestion.name}
                  <Badge variant="secondary" className="ml-2">
                    {Math.round(suggestion.confidence * 100)}% {suggestion.matchReason}
                  </Badge>
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search your inventory…"
              className="w-[240px]"
              value={search}
              disabled={disabled}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onCreateItem(line.id)}>
              <Plus className="mr-1 h-3 w-3" />
              Create item
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {searchResults.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setSearch('');
                    onLink(line.id, item.id, Number(conversion) || 1);
                  }}
                >
                  {item.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
