import { useState, useRef, useCallback } from 'react';
import { Link2, Link2Off, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '@/api/inventory';
import { recipesApi } from '@/api/recipes';
import { getItemIcon } from '@/lib/inventory-constants';
import { cn } from '@/lib/utils';

interface ParsedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
}

interface NaturalIngredientInputProps {
  /** Raw text the user typed */
  rawText: string;
  /** Parsed structured data */
  parsed?: ParsedIngredient;
  /** Linked inventory item ID */
  inventoryItemId?: string;
  /** Linked inventory item name */
  linkedItemName?: string;
  /** Called when raw text changes */
  onRawTextChange: (text: string) => void;
  /** Called when CRF parses the text */
  onParsed: (parsed: ParsedIngredient) => void;
  /** Called when linked to an inventory item */
  onLink: (itemId: string, itemName: string) => void;
  /** Called when unlinked */
  onUnlink: () => void;
}

/**
 * Natural language ingredient input.
 * User types "2 cups flour" → CRF parses on blur → auto-matches to catalog.
 */
export function NaturalIngredientInput({
  rawText,
  parsed,
  inventoryItemId,
  linkedItemName,
  onRawTextChange,
  onParsed,
  onLink,
  onUnlink,
}: NaturalIngredientInputProps) {
  const [isParsing, setIsParsing] = useState(false);
  const [isEditing, setIsEditing] = useState(!parsed || !rawText);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch items for linking
  const { data: itemsData } = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => inventoryApi.getItems({}),
    staleTime: 60000,
  });

  const itemOptions: ComboboxOption[] = (itemsData?.items || []).map(item => ({
    value: item.id,
    label: item.name,
    icon: <span>{getItemIcon(item)}</span>,
  }));

  const parseAndMatch = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setIsParsing(true);

    try {
      // Parse with CRF via backend
      const response = await fetch(`/api/v1/recipes/import/parse-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const data = await response.json();
        const ingredients = data.data?.parsedRecipe?.ingredients;
        if (ingredients && ingredients.length > 0) {
          const ing = ingredients[0];
          onParsed({
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            notes: ing.notes,
          });

          // Try to auto-match
          if (!inventoryItemId) {
            try {
              const matchResult = await recipesApi.matchIngredient(ing.name, ing.unit);
              if (matchResult.suggestions && matchResult.suggestions.length > 0) {
                const top = matchResult.suggestions[0];
                if (top.confidence >= 0.8) {
                  onLink(top.itemId, top.name);
                }
              }
            } catch {
              // Matching failed, continue without link
            }
          }
        }
      }
    } catch (err) {
      // Parse failed — just keep the raw text
      onParsed({ name: text.trim() });
    } finally {
      setIsParsing(false);
      setIsEditing(false);
    }
  }, [inventoryItemId, onParsed, onLink]);

  const handleBlur = () => {
    if (rawText.trim() && rawText !== (parsed?.name || '')) {
      parseAndMatch(rawText);
    } else if (rawText.trim()) {
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    }
  };

  // Editing mode: show text input
  if (isEditing || !parsed) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <Input
          ref={inputRef}
          value={rawText}
          onChange={(e) => onRawTextChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder='Type ingredient, e.g. "2 cups flour"'
          className="flex-1"
          autoFocus={!rawText}
        />
        {isParsing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
      </div>
    );
  }

  // Display mode: show parsed result
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <button
        type="button"
        className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:bg-muted/50 rounded px-1.5 py-0.5 -mx-1.5 transition-colors"
        onClick={() => setIsEditing(true)}
      >
        {parsed.quantity != null && (
          <span className="font-medium shrink-0">
            {parsed.quantity}{parsed.unit ? ` ${parsed.unit}` : ''}
          </span>
        )}
        <span className="truncate">{parsed.name}</span>
        {parsed.notes && (
          <span className="text-xs text-muted-foreground truncate">({parsed.notes})</span>
        )}
      </button>

      {/* Link status */}
      {inventoryItemId ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="text-green-600 hover:text-green-700 transition-colors shrink-0">
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 text-xs" side="left">
            <div className="flex items-center gap-2">
              <span>Linked to: <span className="font-medium">{linkedItemName}</span></span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={onUnlink}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="text-destructive/60 hover:text-destructive transition-colors shrink-0">
              <Link2Off className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" side="left">
            <p className="text-xs font-medium mb-2">Link to catalog item</p>
            <Combobox
              options={itemOptions}
              value=""
              onValueChange={(itemId) => {
                if (!itemId) return;
                const item = itemsData?.items?.find(i => i.id === itemId);
                if (item) onLink(item.id, item.name);
              }}
              placeholder="Search items..."
              searchPlaceholder="Type to search..."
              emptyText="No items found"
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
