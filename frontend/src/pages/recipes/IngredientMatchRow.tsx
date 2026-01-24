import { useState, useRef, useMemo } from 'react';
import { Check, X, ChevronDown, Plus, Loader2, Link2, Unlink, AlertCircle, Search } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inventoryApi } from '@/api/inventory';
import { recipesApi, type IngredientMatch, type MatchSuggestion, type MatchReason } from '@/api/recipes';
import { cn } from '@/lib/utils';
import { UnitConversionPromptDialog } from '@/components/inventory/UnitConversionPromptDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { unitOptions, categoryOptions, normalizeUnit } from '@/lib/inventory-constants';
import { hasGlobalConversion } from '@/lib/unit-conversions';

interface IngredientMatchRowProps {
  match: IngredientMatch;
  onUpdate: (parsedName: string, matchedItemId?: string, matchedItemName?: string, unit?: string) => void;
  onCreateNew: (name: string, unit?: string, category?: string, area?: string) => Promise<{ itemId: string; itemName: string }>;
}

// Get match reason label
function getMatchReasonLabel(reason: MatchReason | undefined): string | null {
  switch (reason) {
    case 'exact': return 'Exact match';
    case 'synonym': return 'Synonym';
    case 'contains': return 'Similar';
    case 'fuzzy': return 'Fuzzy match';
    default: return null;
  }
}

// Get match reason badge variant
function getMatchReasonVariant(reason: MatchReason | undefined): 'default' | 'secondary' | 'outline' {
  switch (reason) {
    case 'exact': return 'default';
    case 'synonym': return 'default';
    case 'contains': return 'secondary';
    case 'fuzzy': return 'outline';
    default: return 'outline';
  }
}

export function IngredientMatchRow({ match, onUpdate, onCreateNew }: IngredientMatchRowProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recipeUnit, setRecipeUnit] = useState(() => normalizeUnit(match.parsedUnit));
  const inputRef = useRef<HTMLInputElement>(null);

  // New item form state
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemAreaId, setNewItemAreaId] = useState('');

  // Conversion prompt for linking existing items
  const [conversionPrompt, setConversionPrompt] = useState<{
    itemId: string;
    itemName: string;
    fromUnit: string;
    toUnit: string;
    suggestedFactor?: number;
  } | null>(null);

  // Conversion prompt for creating new items
  const [createConversionPrompt, setCreateConversionPrompt] = useState<{
    itemId: string;
    itemName: string;
    fromUnit: string;
    toUnit: string;
    suggestedFactor?: number;
  } | null>(null);

  // Fetch inventory items for selection
  const { data: itemsData } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getItems(),
    staleTime: 60000,
  });

  // Fetch storage areas for dropdown
  const { data: areasData } = useQuery({
    queryKey: ['storage-areas'],
    queryFn: () => inventoryApi.getAreas(),
    staleTime: 60000,
  });

  // Fetch match suggestions for this ingredient
  const { data: suggestionsData } = useQuery({
    queryKey: ['ingredient-suggestions', match.parsedName, match.parsedUnit],
    queryFn: () => recipesApi.matchIngredient(match.parsedName, match.parsedUnit),
    staleTime: 60000,
  });

  const items = itemsData?.items || [];
  const areas = areasData?.areas || [];
  const suggestions = suggestionsData?.suggestions || match.suggestions || [];

  // Memoized options for comboboxes
  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

  const categoryComboboxOptions: ComboboxOption[] = useMemo(
    () => categoryOptions.map((c) => ({ value: c.toLowerCase(), label: c })),
    []
  );

  const areaComboboxOptions: ComboboxOption[] = useMemo(
    () => areas.map((a) => ({ value: a.id, label: a.name })),
    [areas]
  );

  const handleSelect = (itemId: string, itemName: string, suggestion?: MatchSuggestion) => {
    // Check if this selection needs a unit conversion
    if (suggestion?.needsConversion && !suggestion.needsConversion.hasExisting) {
      const { fromUnit, toUnit } = suggestion.needsConversion;

      // Check if global conversion exists - if so, no prompt needed
      if (hasGlobalConversion(fromUnit, toUnit)) {
        onUpdate(match.parsedName, itemId, itemName, recipeUnit);
        setOpen(false);
        return;
      }

      // No global conversion - prompt user for item-specific conversion
      setConversionPrompt({
        itemId,
        itemName,
        fromUnit,
        toUnit,
        suggestedFactor: suggestion.needsConversion.suggestedFactor,
      });
      setOpen(false);
      return;
    }

    onUpdate(match.parsedName, itemId, itemName, recipeUnit);
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
    onUpdate(match.parsedName, conversionPrompt.itemId, conversionPrompt.itemName, recipeUnit);
    setConversionPrompt(null);
  };

  const handleConversionSkip = () => {
    if (!conversionPrompt) return;
    // Complete the match without conversion
    onUpdate(match.parsedName, conversionPrompt.itemId, conversionPrompt.itemName, recipeUnit);
    setConversionPrompt(null);
  };

  const handleUnlink = () => {
    onUpdate(match.parsedName, undefined, undefined, recipeUnit);
  };

  const handleShowCreateForm = () => {
    // Pre-fill form with parsed data or catalogItem data from .recipe import
    const catalogItem = match.catalogItem;
    setNewItemName(catalogItem?.name || match.parsedName);
    // Use catalogItem defaultUnit if available, otherwise use recipe unit
    setNewItemUnit(catalogItem?.defaultUnit || recipeUnit);
    setNewItemCategory(catalogItem?.category?.toLowerCase() || '');
    setNewItemAreaId('');
    setShowCreateForm(true);
  };

  const resetCreateForm = () => {
    setShowCreateForm(false);
    setNewItemName('');
    setNewItemUnit('');
    setNewItemCategory('');
    setNewItemAreaId('');
  };

  const handleCreateNew = async () => {
    if (!newItemName.trim()) return;

    setIsCreating(true);
    try {
      // Create the item first
      const result = await onCreateNew(
        newItemName,
        newItemUnit || undefined,
        newItemCategory || undefined,
        newItemAreaId || undefined
      );

      // Check if units differ - need conversion
      if (recipeUnit && newItemUnit &&
          normalizeUnit(recipeUnit) !== normalizeUnit(newItemUnit)) {
        // If global conversion exists, no prompt needed
        if (hasGlobalConversion(recipeUnit, newItemUnit)) {
          onUpdate(match.parsedName, result.itemId, result.itemName, recipeUnit);
          resetCreateForm();
          setOpen(false);
          return;
        }

        // Look for a matching conversion from catalogItem (from .recipe import)
        const catalogConversion = match.catalogItem?.unitConversions?.find(
          c => normalizeUnit(c.fromUnit) === normalizeUnit(recipeUnit) &&
               normalizeUnit(c.toUnit) === normalizeUnit(newItemUnit)
        );
        // Show conversion prompt before linking
        setCreateConversionPrompt({
          itemId: result.itemId,
          itemName: result.itemName,
          fromUnit: recipeUnit,
          toUnit: newItemUnit,
          suggestedFactor: catalogConversion?.factor,
        });
        // Don't link yet - wait for conversion
        return;
      }

      // Same unit or no unit specified - link directly
      onUpdate(match.parsedName, result.itemId, result.itemName, recipeUnit);
      resetCreateForm();
      setOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateConversionConfirm = async (factor: number, _saveForFuture: boolean) => {
    if (!createConversionPrompt) return;

    // Save conversion to the newly created item
    await inventoryApi.addUnitConversion(createConversionPrompt.itemId, {
      fromUnit: createConversionPrompt.fromUnit,
      toUnit: createConversionPrompt.toUnit,
      factor,
    });

    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ['inventory-items'] });

    // Now link the item
    onUpdate(match.parsedName, createConversionPrompt.itemId, createConversionPrompt.itemName, recipeUnit);
    setCreateConversionPrompt(null);
    resetCreateForm();
    setOpen(false);
  };

  const handleCreateConversionSkip = () => {
    if (!createConversionPrompt) return;
    // Link without conversion
    onUpdate(match.parsedName, createConversionPrompt.itemId, createConversionPrompt.itemName, recipeUnit);
    setCreateConversionPrompt(null);
    resetCreateForm();
    setOpen(false);
  };

  const isLinked = !!match.matchedItemId;
  const confidence = match.confidence ?? (suggestions[0]?.confidence ?? 0);
  const matchReason = match.matchReason ?? suggestions[0]?.matchReason;

  return (
    <div className={cn(
      'flex items-center justify-between p-3 rounded-lg border',
      isLinked ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950' : 'border-border'
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {match.parsedQuantity && (
            <span className="font-medium text-muted-foreground">{match.parsedQuantity}</span>
          )}
          {/* Inline unit dropdown */}
          <Combobox
            options={unitComboboxOptions}
            value={recipeUnit}
            onValueChange={(newUnit) => {
              setRecipeUnit(newUnit);
              // Notify parent of unit change
              onUpdate(match.parsedName, match.matchedItemId, match.matchedItemName, newUnit);
            }}
            placeholder="unit"
            searchPlaceholder="Search units..."
            emptyText="No unit found"
            allowClear
            clearLabel="None"
            className="h-7 px-2.5 text-sm font-medium text-muted-foreground bg-muted/50 hover:bg-muted border-dashed w-auto min-w-[90px]"
          />
          <span className="font-medium">{match.parsedName}</span>
          {match.matchStatus === 'matched' && matchReason && (
            <Badge variant={getMatchReasonVariant(matchReason)} className="text-xs">
              {getMatchReasonLabel(matchReason)}
            </Badge>
          )}
          {match.matchStatus === 'matched' && (
            <Badge variant="secondary" className="text-xs">
              {Math.round(confidence * 100)}%
            </Badge>
          )}
        </div>

        {isLinked && (
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground flex-wrap">
            <Link2 className="h-3 w-3 flex-shrink-0" />
            <span>Linked to: {match.matchedItemName}</span>
            {match.unitConversion && (
              <Badge variant="outline" className="ml-2 text-xs">
                {match.unitConversion.fromUnit} = {match.unitConversion.factor} {match.unitConversion.toUnit}
              </Badge>
            )}
            {match.needsConversion && !match.needsConversion.hasExisting &&
             !hasGlobalConversion(match.needsConversion.fromUnit, match.needsConversion.toUnit) && (
              <Badge variant="outline" className="ml-2 text-xs text-orange-600 border-orange-300">
                <AlertCircle className="h-3 w-3 mr-1" />
                needs conversion
              </Badge>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {isLinked ? (
          <Button variant="ghost" size="sm" onClick={handleUnlink}>
            <Unlink className="h-4 w-4" />
          </Button>
        ) : (
          <Popover open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) {
              setSearchQuery('');
              setShowCreateForm(false);
            }
          }}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                Link
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-96 p-0"
              align="end"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                inputRef.current?.focus();
              }}
            >
              {!showCreateForm ? (
                <div className="flex flex-col">
                  {/* Search input */}
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        ref={inputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search inventory items..."
                        className="pl-8 h-9"
                      />
                    </div>
                  </div>

                  <div className="max-h-[300px] overflow-y-auto">
                    {/* Suggestions section */}
                    {suggestions.length > 0 && !searchQuery && (
                      <div className="p-1">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                          Suggestions
                        </div>
                        {suggestions.slice(0, 5).map((suggestion) => (
                          <button
                            key={suggestion.itemId}
                            type="button"
                            onClick={() => handleSelect(suggestion.itemId, suggestion.name, suggestion)}
                            className={cn(
                              'relative flex w-full cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                              match.matchedItemId === suggestion.itemId && 'bg-accent'
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <Check
                                className={cn(
                                  'h-4 w-4',
                                  match.matchedItemId === suggestion.itemId ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <span>{suggestion.name}</span>
                              {suggestion.matchReason && (
                                <Badge variant={getMatchReasonVariant(suggestion.matchReason)} className="text-xs">
                                  {getMatchReasonLabel(suggestion.matchReason)}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {suggestion.needsConversion && !suggestion.needsConversion.hasExisting &&
                               !hasGlobalConversion(suggestion.needsConversion.fromUnit, suggestion.needsConversion.toUnit) && (
                                <Badge variant="outline" className="text-xs text-orange-600">
                                  needs conversion
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs">
                                {Math.round(suggestion.confidence * 100)}%
                              </Badge>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Divider */}
                    {suggestions.length > 0 && !searchQuery && <div className="h-px bg-border" />}

                    {/* All Items section */}
                    <div className="p-1">
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        {searchQuery ? 'Search Results' : 'All Items'}
                      </div>
                      {(() => {
                        const filteredItems = searchQuery
                          ? items.filter(item =>
                              item.name.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                          : items;

                        if (filteredItems.length === 0) {
                          return (
                            <div className="py-4 text-center text-sm text-muted-foreground">
                              No items found
                            </div>
                          );
                        }

                        return filteredItems.slice(0, 20).map((item) => {
                          const unitsDiffer = recipeUnit && item.defaultUnit &&
                            normalizeUnit(recipeUnit) !== normalizeUnit(item.defaultUnit);
                          // Only mark as needing conversion if units differ AND no global conversion exists
                          const needsConversionBadge = unitsDiffer &&
                            !hasGlobalConversion(recipeUnit, item.defaultUnit);

                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => handleSelect(item.id, item.name, unitsDiffer ? {
                                itemId: item.id,
                                name: item.name,
                                confidence: 0,
                                needsConversion: {
                                  fromUnit: recipeUnit,
                                  toUnit: item.defaultUnit,
                                  hasExisting: false,
                                }
                              } : undefined)}
                              className={cn(
                                'relative flex w-full cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                                match.matchedItemId === item.id && 'bg-accent'
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <Check
                                  className={cn(
                                    'h-4 w-4',
                                    match.matchedItemId === item.id ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <span>{item.name}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {needsConversionBadge && (
                                  <Badge variant="outline" className="text-xs text-orange-600">
                                    needs conversion
                                  </Badge>
                                )}
                                {item.defaultUnit && (
                                  <span className="text-xs text-muted-foreground">{item.defaultUnit}</span>
                                )}
                              </div>
                            </button>
                          );
                        });
                      })()}
                    </div>

                    {/* Create new item option */}
                    <div className="h-px bg-border" />
                    <div className="p-1">
                      <button
                        type="button"
                        onClick={handleShowCreateForm}
                        className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Create new inventory item
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Create New Item</h4>
                    <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-item-name">Name</Label>
                      <Input
                        id="new-item-name"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder={match.parsedName}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Default Unit (Inventory)</Label>
                      <Combobox
                        options={unitComboboxOptions}
                        value={newItemUnit}
                        onValueChange={setNewItemUnit}
                        placeholder="How you store this item"
                        searchPlaceholder="Search units..."
                        emptyText="No unit found"
                        allowClear
                        clearLabel="None"
                      />
                      <p className="text-xs text-muted-foreground">
                        How this item is tracked in your inventory
                      </p>
                    </div>

                    {/* Show warning if units differ and no global conversion exists */}
                    {recipeUnit && newItemUnit &&
                     normalizeUnit(recipeUnit) !== normalizeUnit(newItemUnit) &&
                     !hasGlobalConversion(recipeUnit, newItemUnit) && (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          You'll need to provide a conversion from {recipeUnit} to {newItemUnit} after creating.
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <Combobox
                        options={categoryComboboxOptions}
                        value={newItemCategory}
                        onValueChange={setNewItemCategory}
                        placeholder="Select category (optional)"
                        searchPlaceholder="Search categories..."
                        emptyText="No category found"
                        allowClear
                        clearLabel="None"
                      />
                    </div>

                    {areaComboboxOptions.length > 0 && (
                      <div className="space-y-1.5">
                        <Label>Default Storage Area</Label>
                        <Combobox
                          options={areaComboboxOptions}
                          value={newItemAreaId}
                          onValueChange={setNewItemAreaId}
                          placeholder="Select area (optional)"
                          searchPlaceholder="Search areas..."
                          emptyText="No area found"
                          allowClear
                          clearLabel="None"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => setShowCreateForm(false)}>
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleCreateNew}
                      disabled={!newItemName.trim() || isCreating}
                    >
                      {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create & Link
                    </Button>
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Unit Conversion Prompt Dialog for linking existing items */}
      {conversionPrompt && (
        <UnitConversionPromptDialog
          open={!!conversionPrompt}
          onOpenChange={(open) => {
            if (!open) setConversionPrompt(null);
          }}
          itemName={conversionPrompt.itemName}
          fromUnit={conversionPrompt.fromUnit}
          toUnit={conversionPrompt.toUnit}
          suggestedFactor={conversionPrompt.suggestedFactor}
          onConfirm={handleConversionConfirm}
          onSkip={handleConversionSkip}
        />
      )}

      {/* Unit Conversion Prompt Dialog for Create Flow */}
      {createConversionPrompt && (
        <UnitConversionPromptDialog
          open={!!createConversionPrompt}
          onOpenChange={(open) => {
            if (!open) {
              // User closed without saving - still link but without conversion
              handleCreateConversionSkip();
            }
          }}
          itemName={createConversionPrompt.itemName}
          fromUnit={createConversionPrompt.fromUnit}
          toUnit={createConversionPrompt.toUnit}
          suggestedFactor={createConversionPrompt.suggestedFactor}
          onConfirm={handleCreateConversionConfirm}
          onSkip={handleCreateConversionSkip}
        />
      )}
    </div>
  );
}
