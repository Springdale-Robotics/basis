import { useState } from 'react';
import { Check, X, ChevronDown, Plus, Loader2, Link2, Unlink } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inventoryApi } from '@/api/inventory';
import { recipesApi, type IngredientMatch, type MatchSuggestion } from '@/api/recipes';
import { cn } from '@/lib/utils';
import { UnitConversionPromptDialog } from '@/components/inventory/UnitConversionPromptDialog';

interface IngredientMatchRowProps {
  match: IngredientMatch;
  onUpdate: (parsedName: string, matchedItemId?: string, matchedItemName?: string) => void;
  onCreateNew: (name: string, unit?: string) => Promise<{ itemId: string; itemName: string }>;
}

export function IngredientMatchRow({ match, onUpdate, onCreateNew }: IngredientMatchRowProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [conversionPrompt, setConversionPrompt] = useState<{
    itemId: string;
    itemName: string;
    fromUnit: string;
    toUnit: string;
  } | null>(null);

  // Fetch inventory items for selection
  const { data: itemsData } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getItems(),
    staleTime: 60000,
  });

  // Fetch match suggestions for this ingredient
  const { data: suggestionsData } = useQuery({
    queryKey: ['ingredient-suggestions', match.parsedName, match.parsedUnit],
    queryFn: () => recipesApi.matchIngredient(match.parsedName, match.parsedUnit),
    staleTime: 60000,
  });

  const items = itemsData?.items || [];
  const suggestions = suggestionsData?.suggestions || match.suggestions || [];

  const handleSelect = (itemId: string, itemName: string, suggestion?: MatchSuggestion) => {
    // Check if this selection needs a unit conversion
    if (suggestion?.needsConversion) {
      setConversionPrompt({
        itemId,
        itemName,
        fromUnit: suggestion.needsConversion.fromUnit,
        toUnit: suggestion.needsConversion.toUnit,
      });
      setOpen(false);
      return;
    }

    onUpdate(match.parsedName, itemId, itemName);
    setOpen(false);
  };

  const handleConversionConfirm = async (factor: number, saveForFuture: boolean) => {
    if (!conversionPrompt) return;

    // Save conversion to item if requested
    if (saveForFuture) {
      await inventoryApi.addUnitConversion(conversionPrompt.itemId, {
        fromUnit: conversionPrompt.fromUnit,
        toUnit: conversionPrompt.toUnit,
        factor,
      });
      // Invalidate inventory queries to reflect the update
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      queryClient.invalidateQueries({ queryKey: ['ingredient-suggestions'] });
    }

    // Complete the match
    onUpdate(match.parsedName, conversionPrompt.itemId, conversionPrompt.itemName);
    setConversionPrompt(null);
  };

  const handleConversionSkip = () => {
    if (!conversionPrompt) return;
    // Complete the match without conversion
    onUpdate(match.parsedName, conversionPrompt.itemId, conversionPrompt.itemName);
    setConversionPrompt(null);
  };

  const handleUnlink = () => {
    onUpdate(match.parsedName, undefined, undefined);
  };

  const handleCreateNew = async () => {
    if (!newItemName.trim()) return;

    setIsCreating(true);
    try {
      const result = await onCreateNew(newItemName, newItemUnit || undefined);
      onUpdate(match.parsedName, result.itemId, result.itemName);
      setShowCreateForm(false);
      setNewItemName('');
      setNewItemUnit('');
      setOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  const isLinked = !!match.matchedItemId;
  const confidence = match.confidence ?? (suggestions[0]?.confidence ?? 0);

  return (
    <div className={cn(
      'flex items-center justify-between p-3 rounded-lg border',
      isLinked ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950' : 'border-border'
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {match.parsedQuantity && <span className="text-muted-foreground">{match.parsedQuantity} </span>}
            {match.parsedUnit && <span className="text-muted-foreground">{match.parsedUnit} </span>}
            {match.parsedName}
          </span>
          {match.matchStatus === 'matched' && (
            <Badge variant="secondary" className="text-xs">
              {Math.round((confidence) * 100)}% match
            </Badge>
          )}
        </div>

        {isLinked && (
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
            <Link2 className="h-3 w-3" />
            <span>Linked to: {match.matchedItemName}</span>
            {match.unitConversion && (
              <Badge variant="outline" className="ml-2 text-xs">
                {match.unitConversion.fromUnit} = {match.unitConversion.factor} {match.unitConversion.toUnit}
              </Badge>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isLinked ? (
          <Button variant="ghost" size="sm" onClick={handleUnlink}>
            <Unlink className="h-4 w-4" />
          </Button>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                Link
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              {!showCreateForm ? (
                <Command>
                  <CommandInput placeholder="Search inventory items..." />
                  <CommandList>
                    <CommandEmpty>No items found</CommandEmpty>

                    {suggestions.length > 0 && (
                      <CommandGroup heading="Suggestions">
                        {suggestions.slice(0, 5).map((suggestion) => (
                          <CommandItem
                            key={suggestion.itemId}
                            onSelect={() => handleSelect(suggestion.itemId, suggestion.name, suggestion)}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                match.matchedItemId === suggestion.itemId ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="flex-1">{suggestion.name}</span>
                            {suggestion.needsConversion && (
                              <Badge variant="outline" className="text-xs ml-1 text-orange-600">
                                needs conversion
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs ml-2">
                              {Math.round(suggestion.confidence * 100)}%
                            </Badge>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}

                    <CommandSeparator />

                    <CommandGroup heading="All Items">
                      {items.map((item) => {
                        // Check if this item would need conversion
                        const needsConversion = match.parsedUnit && item.defaultUnit &&
                          match.parsedUnit.toLowerCase() !== item.defaultUnit.toLowerCase();

                        return (
                          <CommandItem
                            key={item.id}
                            onSelect={() => handleSelect(item.id, item.name, needsConversion ? {
                              itemId: item.id,
                              name: item.name,
                              confidence: 0,
                              needsConversion: {
                                fromUnit: match.parsedUnit!,
                                toUnit: item.defaultUnit,
                              }
                            } : undefined)}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                match.matchedItemId === item.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="flex-1">{item.name}</span>
                            {needsConversion && (
                              <Badge variant="outline" className="text-xs ml-1 text-orange-600">
                                needs conversion
                              </Badge>
                            )}
                            {item.defaultUnit && (
                              <span className="text-xs text-muted-foreground ml-1">{item.defaultUnit}</span>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>

                    <CommandSeparator />

                    <CommandGroup>
                      <CommandItem onSelect={() => setShowCreateForm(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create new inventory item
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              ) : (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Create New Item</h4>
                    <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-item-name">Name</Label>
                    <Input
                      id="new-item-name"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder={match.parsedName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-item-unit">Default Unit</Label>
                    <Input
                      id="new-item-unit"
                      value={newItemUnit}
                      onChange={(e) => setNewItemUnit(e.target.value)}
                      placeholder={match.parsedUnit || 'e.g., oz, cups, pieces'}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setShowCreateForm(false)}>
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleCreateNew}
                      disabled={!newItemName.trim() || isCreating}
                    >
                      {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create
                    </Button>
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Unit Conversion Prompt Dialog */}
      {conversionPrompt && (
        <UnitConversionPromptDialog
          open={!!conversionPrompt}
          onOpenChange={(open) => {
            if (!open) setConversionPrompt(null);
          }}
          itemName={conversionPrompt.itemName}
          fromUnit={conversionPrompt.fromUnit}
          toUnit={conversionPrompt.toUnit}
          onConfirm={handleConversionConfirm}
          onSkip={handleConversionSkip}
        />
      )}
    </div>
  );
}
