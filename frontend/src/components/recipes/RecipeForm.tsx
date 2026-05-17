import { useState, useEffect, useRef, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, Loader2, Link2, Link2Off, Check, Search, Package, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
// Step-based wizard (no Tabs component needed)
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { recipeSchema, type RecipeFormData } from '@/types/forms';
import { inventoryApi } from '@/api/inventory';
import { recipesApi } from '@/api/recipes';
import { useCategories } from '@/hooks/useCategories';
import { getItemIcon } from '@/lib/inventory-constants';
import { RecipeImageInput } from './RecipeImageInput';
import { cn } from '@/lib/utils';
import type { Recipe, InventoryItem } from '@/types/models';
import { unitOptions, normalizeUnit } from '@/lib/inventory-constants';

export interface RecipeImageChange {
  type: 'file' | 'url' | 'remove' | 'none';
  file?: File;
  url?: string;
}

interface RecipeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe?: Recipe | null;
  onSubmit: (data: RecipeFormData, imageChange: RecipeImageChange) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
}

const difficultyOptions = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

interface IngredientNameInputProps {
  value: string;
  inventoryItemId?: string;
  onNameChange: (name: string) => void;
  onSelectInventoryItem: (itemId: string, itemName: string, defaultUnit?: string) => void;
  onUnlink: () => void;
}

function IngredientNameInput({
  value,
  inventoryItemId,
  onNameChange,
  onSelectInventoryItem,
  onUnlink,
}: IngredientNameInputProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync internal state with external value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Fetch inventory items
  const { data: itemsData } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getItems(),
    staleTime: 60000,
  });

  const items = itemsData?.items || [];
  const linkedItem = items.find(item => item.id === inventoryItemId);

  // Filter items based on input
  const filteredItems = inputValue
    ? items.filter(item =>
        item.name.toLowerCase().includes(inputValue.toLowerCase())
      )
    : items;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onNameChange(newValue);
    // If typing and previously linked, unlink
    if (inventoryItemId && newValue !== linkedItem?.name) {
      onUnlink();
    }
    // Open dropdown when typing
    if (!open) {
      setOpen(true);
    }
  };

  const handleSelectItem = (item: InventoryItem) => {
    setInputValue(item.name);
    onSelectInventoryItem(item.id, item.name, item.defaultUnit || undefined);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Enter' && inputValue) {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Type or search inventory..."
            className={cn(
              'pr-8',
              inventoryItemId && 'border-green-500 focus-visible:ring-green-500'
            )}
          />
          {inventoryItemId ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnlink();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 hover:text-green-700"
                  >
                    <Link2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Linked to inventory</p>
                  <p className="text-xs text-muted-foreground">Click to unlink</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Don't close if clicking inside the input
          if (inputRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
      >
        <div className="max-h-[300px] overflow-y-auto">
          {filteredItems.length === 0 && inputValue ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <p>No matching inventory items</p>
              <p className="text-xs mt-1">Press Enter to use as custom ingredient</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Start typing to search inventory</p>
            </div>
          ) : (
            <div className="p-1">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Inventory Items
              </div>
              {filteredItems.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  className={cn(
                    'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                    inventoryItemId === item.id && 'bg-accent'
                  )}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      inventoryItemId === item.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="flex-1 text-left">{item.name}</span>
                  {item.defaultUnit && (
                    <span className="text-xs text-muted-foreground ml-2">{item.defaultUnit}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {inputValue && !filteredItems.some(item => item.name.toLowerCase() === inputValue.toLowerCase()) && (
            <>
              <div className="h-px bg-border" />
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => {
                    onNameChange(inputValue);
                    setOpen(false);
                  }}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Use "{inputValue}" as custom ingredient
                </button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface TagInputProps {
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

interface UnitComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

function UnitCombobox({ value, onChange }: UnitComboboxProps) {
  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

  return (
    <Combobox
      options={unitComboboxOptions}
      value={value}
      onValueChange={onChange}
      placeholder="Unit"
      searchPlaceholder="Search units..."
      emptyText="No unit found"
      className="h-10"
    />
  );
}

function TagInput({ tags, onAddTag, onRemoveTag }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Handle wheel events explicitly for scroll to work in popover
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el) return;
    e.stopPropagation();
    el.scrollTop += e.deltaY;
  };

  // Fetch tag suggestions - always fetch when open, filter client-side for better UX
  const { data: suggestionsData, isLoading } = useQuery({
    queryKey: ['tag-suggestions'],
    queryFn: () => recipesApi.getTagSuggestions(),
    staleTime: 60000,
    enabled: open,
  });

  const allSuggestions = suggestionsData?.suggestions || [];

  // Filter out already selected tags and apply search filter
  const availableSuggestions = allSuggestions.filter((s) => {
    // Exclude already selected tags
    if (tags.some((t) => t.toLowerCase() === s.tag.toLowerCase())) {
      return false;
    }
    // Apply search filter if inputValue is not empty
    if (inputValue) {
      return s.tag.toLowerCase().includes(inputValue.toLowerCase());
    }
    return true;
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (!open) setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      onAddTag(inputValue.trim().toLowerCase());
      setInputValue('');
      setOpen(false);
    }
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleSelectSuggestion = (tag: string) => {
    onAddTag(tag);
    setInputValue('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              onClick={() => onRemoveTag(tag)}
              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type or select a tag..."
              className="pl-9 cursor-pointer"
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (inputRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          <div
            ref={listRef}
            className="max-h-[250px] overflow-y-auto overscroll-contain"
            onWheel={handleWheel}
          >
            {isLoading ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                <p>Loading suggestions...</p>
              </div>
            ) : availableSuggestions.length === 0 && inputValue ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                <p>No matching tags. Press Enter to add "{inputValue}"</p>
              </div>
            ) : availableSuggestions.length === 0 ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                <p>No tags available</p>
              </div>
            ) : (
              <div className="p-1">
                {availableSuggestions.slice(0, 15).map((suggestion) => (
                  <button
                    key={suggestion.tag}
                    type="button"
                    onClick={() => handleSelectSuggestion(suggestion.tag)}
                    className="relative flex w-full cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <span>{suggestion.tag}</span>
                    {suggestion.count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {suggestion.count} recipe{suggestion.count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {inputValue && !availableSuggestions.some((s) => s.tag.toLowerCase() === inputValue.toLowerCase()) && (
              <>
                <div className="h-px bg-border" />
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => handleSelectSuggestion(inputValue.trim().toLowerCase())}
                    className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add "{inputValue}" as new tag
                  </button>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function RecipeForm({
  open,
  onOpenChange,
  recipe,
  onSubmit,
  onDelete,
  isSubmitting,
}: RecipeFormProps) {
  const isEditing = !!recipe;
  type FormStep = 'details' | 'ingredients' | 'parse-link' | 'instructions';
  const formSteps: { key: FormStep; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'parse-link', label: 'Link' },
    { key: 'instructions', label: 'Instructions' },
  ];
  const [activeStep, setActiveStep] = useState<FormStep>('details');
  const currentStepIndex = formSteps.findIndex(s => s.key === activeStep);
  const isLastStep = currentStepIndex === formSteps.length - 1;
  const { categories } = useCategories();

  // Parse & Link state
  interface ParseLinkItem {
    originalText: string;
    parsedName: string;
    parsedQuantity?: number;
    parsedUnit?: string;
    parsedNotes?: string;
    action: 'create' | 'link';
    // For 'create'
    suggestedName: string;
    category?: string;
    similarExisting?: string;
    // For 'link'
    linkedItemId?: string;
    linkedItemName?: string;
  }
  const [parseLinkItems, setParseLinkItems] = useState<ParseLinkItem[]>([]);
  const parseLinkItemsRef = useRef<ParseLinkItem[]>([]);
  // Keep ref in sync with state
  parseLinkItemsRef.current = parseLinkItems;
  const [isParsing, setIsParsing] = useState(false);
  const [hasParsed, setHasParsed] = useState(false);

  // Fetch existing items for linking
  const { data: existingItemsData } = useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => inventoryApi.getItems({}),
    staleTime: 60000,
  });
  const existingItems = existingItemsData?.items || [];
  const existingItemOptions: ComboboxOption[] = existingItems.map(item => ({
    value: item.id,
    label: item.name,
    icon: <span>{getItemIcon(item)}</span>,
  }));

  // Parse ingredients when switching to parse-link tab
  const handleParseIngredients = async () => {
    const ingredients = getValues('ingredients');
    const rawLines = ingredients
      .map(i => i.rawText?.trim() || '')
      .filter(t => t.length > 0);

    if (rawLines.length === 0) return;
    setIsParsing(true);

    try {
      // Parse ingredient lines with CRF (falls back to regex)
      const parseResult = await recipesApi.parseIngredientLines(rawLines);
      const parsed = parseResult.ingredients || [];

      // Get name suggestions for auto-matching
      const names = parsed.map(p => p.name || '');
      let suggestions: Array<{ originalName: string; suggestedName: string; category?: string; similarExisting?: string }> = [];
      try {
        const suggestResult = await recipesApi.suggestItems(names);
        suggestions = suggestResult.suggestions;
      } catch {
        // Suggestions unavailable
      }

      // Try auto-matching each ingredient
      const items: ParseLinkItem[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];
        const suggestion = suggestions[i];
        let action: 'create' | 'link' = 'create';
        let linkedItemId: string | undefined;
        let linkedItemName: string | undefined;

        // Try to match against existing items
        try {
          const matchResult = await recipesApi.matchIngredient(p.name || rawLines[i], p.unit);
          if (matchResult.suggestions?.length > 0 && matchResult.suggestions[0].confidence >= 0.8) {
            action = 'link';
            linkedItemId = matchResult.suggestions[0].itemId;
            linkedItemName = matchResult.suggestions[0].name;
          }
        } catch {
          // Match failed
        }

        items.push({
          originalText: rawLines[i],
          parsedName: p.name || rawLines[i],
          parsedQuantity: p.quantity,
          parsedUnit: p.unit,
          parsedNotes: p.notes,
          action,
          suggestedName: suggestion?.suggestedName || p.name || rawLines[i],
          category: suggestion?.category,
          similarExisting: suggestion?.similarExisting,
          linkedItemId,
          linkedItemName,
        });
      }

      setParseLinkItems(items);
      setHasParsed(true);
    } catch (err) {
      console.error('Failed to parse ingredients:', err);
    } finally {
      setIsParsing(false);
    }
  };

  // Image state
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    watch,
    reset,
    formState: { errors },
  } = useForm<RecipeFormData>({
    resolver: zodResolver(recipeSchema),
    defaultValues: {
      title: '',
      description: '',
      prepTime: 0,
      cookTime: 0,
      servings: 4,
      difficulty: 'medium',
      ingredients: [{ name: '', amount: 1, unit: '' }],
      instructions: [{ step: 1, text: '' }],
      tags: [],
    },
  });

  const {
    fields: ingredientFields,
    append: appendIngredient,
    remove: removeIngredient,
  } = useFieldArray({
    control,
    name: 'ingredients',
  });

  const {
    fields: instructionFields,
    append: appendInstruction,
    remove: removeInstruction,
  } = useFieldArray({
    control,
    name: 'instructions',
  });

  const difficulty = watch('difficulty');
  const tags = watch('tags');

  // Reset form when dialog opens or recipe changes
  useEffect(() => {
    if (open) {
      reset(
        recipe
          ? {
              title: recipe.title,
              description: recipe.description || '',
              prepTime: recipe.prepTime || recipe.prepTimeMinutes || 0,
              cookTime: recipe.cookTime || recipe.cookTimeMinutes || 0,
              servings: recipe.servings ?? undefined,
              difficulty: recipe.difficulty || 'medium',
              ingredients: (recipe.ingredients || []).map((ing) => {
                const unit = normalizeUnit(ing.unit);
                const amount = typeof ing.amount === 'number' ? ing.amount : 0;
                // Synthesize a rawText line so the Ingredients step textbox
                // is populated when editing an existing recipe.
                const rawText = [amount || '', unit, ing.name].filter(Boolean).join(' ').trim();
                return {
                  name: ing.name || '',
                  amount,
                  unit,
                  notes: ing.notes ?? undefined,
                  optional: ing.optional ?? undefined,
                  inventoryItemId: ing.inventoryItemId ?? undefined,
                  rawText,
                };
              }),
              instructions: (recipe.instructions || []).map((inst, idx) => ({
                step: inst.step ?? idx + 1,
                text: inst.text || '',
              })),
              tags: recipe.tags || [],
            }
          : {
              title: '',
              description: '',
              prepTime: 0,
              cookTime: 0,
              servings: 4,
              difficulty: 'medium',
              ingredients: [{ name: '', amount: 1, unit: '' }],
              instructions: [{ step: 1, text: '' }],
              tags: [],
            }
      );
      // Reset image state
      setPendingImageFile(null);
      setPendingImageUrl(null);
      setImageProcessing(false);
      setImageRemoved(false);
      // Set current image from recipe
      if (recipe?.imageData) {
        setCurrentImage(`data:${recipe.imageMimeType};base64,${recipe.imageData}`);
      } else if (recipe?.imageUrl) {
        setCurrentImage(recipe.imageUrl);
      } else {
        setCurrentImage(null);
      }
      // When editing an existing recipe, pre-populate parse-link state from
      // existing ingredient links so we don't fire the parse API on Continue.
      if (recipe?.ingredients?.length) {
        const items: ParseLinkItem[] = recipe.ingredients.map((ing) => ({
          originalText: [ing.amount || '', normalizeUnit(ing.unit), ing.name].filter(Boolean).join(' ').trim(),
          parsedName: ing.name || '',
          parsedQuantity: ing.amount,
          parsedUnit: normalizeUnit(ing.unit),
          parsedNotes: ing.notes,
          action: ing.inventoryItemId ? 'link' : 'create',
          suggestedName: ing.linkedItemName || ing.name || '',
          linkedItemId: ing.inventoryItemId,
          linkedItemName: ing.linkedItemName ?? undefined,
        }));
        setParseLinkItems(items);
        setHasParsed(true);
      } else {
        setParseLinkItems([]);
        setHasParsed(false);
      }
    }
  }, [open, recipe, reset]);

  // Build image change object
  const getImageChange = (): RecipeImageChange => {
    if (imageRemoved) {
      return { type: 'remove' };
    }
    if (pendingImageFile) {
      return { type: 'file', file: pendingImageFile };
    }
    if (pendingImageUrl) {
      return { type: 'url', url: pendingImageUrl };
    }
    return { type: 'none' };
  };

  const handleFormSubmit = async (data: RecipeFormData) => {
    // Use ref to get latest parseLinkItems (avoids stale closure)
    const currentParseLinkItems = parseLinkItemsRef.current;

    // Apply parsed ingredient data from Parse & Link tab
    if (currentParseLinkItems.length > 0) {
      // Create new items first
      const toCreate = currentParseLinkItems.filter(p => p.action === 'create' && p.suggestedName.trim());
      let nameToId: Record<string, string> = {};

      if (toCreate.length > 0) {
        try {
          const items = toCreate.map(p => ({
            name: p.suggestedName.trim(),
            category: p.category,
            defaultUnit: p.parsedUnit || 'pieces',
          }));
          const result = await inventoryApi.batchCreateItems({ items });
          if (result?.items) {
            for (const item of result.items) {
              nameToId[item.name.toLowerCase()] = item.id;
            }
          }
        } catch (err) {
          console.error('Failed to create items:', err);
        }
      }

      // Apply structured data + links to ingredients
      data.ingredients = currentParseLinkItems.map(p => {
        let inventoryItemId: string | undefined;
        if (p.action === 'link' && p.linkedItemId) {
          inventoryItemId = p.linkedItemId;
        } else if (p.action === 'create' && p.suggestedName.trim()) {
          inventoryItemId = nameToId[p.suggestedName.trim().toLowerCase()];
        }

        return {
          name: p.parsedName, // CRF-extracted ingredient name (e.g., "flour")
          amount: p.parsedQuantity ?? 0,
          unit: p.parsedUnit ?? '',
          notes: p.parsedNotes,
          inventoryItemId,
          rawText: p.originalText, // Full original text for reference
        };
      });
    }

    onSubmit(data, getImageChange());
  };

  const handleFormError = (errors: any) => {
    console.error('Form validation errors:', errors);
  };

  const handleClose = () => {
    reset();
    // Reset image state
    setPendingImageFile(null);
    setPendingImageUrl(null);
    setImageProcessing(false);
    setCurrentImage(null);
    setImageRemoved(false);
    // Reset parse & link state
    setParseLinkItems([]);
    setHasParsed(false);
    setActiveStep('details');
    onOpenChange(false);
  };

  const handleAddTag = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      setValue('tags', [...tags, tag]);
    }
  };

  const handleRemoveTag = (tag: string) => {
    setValue(
      'tags',
      tags.filter((t) => t !== tag)
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{isEditing ? 'Edit Recipe' : 'New Recipe'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update recipe details, ingredients, and instructions.'
              : 'Enter details for a new recipe.'}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 flex-shrink-0 px-1">
          {formSteps.map((s, i) => (
            <div key={s.key} className="flex flex-col items-center flex-1">
              <div className={cn(
                'h-1.5 w-full rounded-full transition-colors',
                i <= currentStepIndex ? 'bg-primary' : 'bg-muted'
              )} />
              <span className={cn(
                'text-[10px] mt-1 transition-colors',
                i === currentStepIndex ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto pr-1">

            {activeStep === "details" && (<div className="space-y-4 py-2">
              {/* Image upload */}
              <div className="space-y-2">
                <Label>Image</Label>
                <RecipeImageInput
                  currentImage={imageRemoved ? undefined : currentImage || undefined}
                  onFileSelect={(file) => {
                    setPendingImageFile(file);
                    setPendingImageUrl(null);
                    setImageRemoved(false);
                    // Show preview
                    const reader = new FileReader();
                    reader.onload = () => setCurrentImage(reader.result as string);
                    reader.readAsDataURL(file);
                  }}
                  onUrlFetch={(url) => {
                    setPendingImageUrl(url);
                    setPendingImageFile(null);
                    setImageRemoved(false);
                    // Show URL as preview (will be replaced after upload)
                    setCurrentImage(url);
                  }}
                  onRemove={() => {
                    setPendingImageFile(null);
                    setPendingImageUrl(null);
                    setCurrentImage(null);
                    setImageRemoved(true);
                  }}
                  isProcessing={imageProcessing}
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  placeholder="Recipe title"
                  {...register('title')}
                />
                {errors.title && (
                  <p className="text-sm text-destructive">{errors.title.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  placeholder="Brief description"
                  {...register('description')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="prepTime">Prep Time (min)</Label>
                  <Input
                    id="prepTime"
                    type="number"
                    min="0"
                    {...register('prepTime', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cookTime">Cook Time (min)</Label>
                  <Input
                    id="cookTime"
                    type="number"
                    min="0"
                    {...register('cookTime', { valueAsNumber: true })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="servings">Servings</Label>
                  <Input
                    id="servings"
                    type="number"
                    min="1"
                    {...register('servings', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="difficulty">Difficulty</Label>
                  <Select
                    value={difficulty}
                    onValueChange={(value) =>
                      setValue('difficulty', value as 'easy' | 'medium' | 'hard')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select difficulty" />
                    </SelectTrigger>
                    <SelectContent>
                      {difficultyOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tags</Label>
                <TagInput
                  tags={tags}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                />
              </div>
            </div>)}


            {activeStep === "ingredients" && (<div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground mb-2">
                Type each ingredient naturally, e.g. "2 cups flour" or "1 lb boneless chicken breast"
              </p>
              {ingredientFields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-center">
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{index + 1}.</span>
                  <Input
                    placeholder='e.g. "2 cups all-purpose flour"'
                    {...register(`ingredients.${index}.rawText` as const)}
                    className="flex-1"
                    id={`ingredient-input-${index}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        appendIngredient({ name: '', amount: 0, unit: '', rawText: '' });
                        // Focus the new input on next render
                        setTimeout(() => {
                          const next = document.getElementById(`ingredient-input-${index + 1}`);
                          next?.focus();
                        }, 50);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeIngredient(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => appendIngredient({ name: '', amount: 0, unit: '', rawText: '' })}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Ingredient
              </Button>
            </div>)}


            {activeStep === "parse-link" && (<div className="space-y-4 py-2">
              {!hasParsed ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Parse your ingredients and link them to your catalog for inventory tracking
                  </p>
                  <Button
                    type="button"
                    onClick={handleParseIngredients}
                    disabled={isParsing}
                  >
                    {isParsing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    {isParsing ? 'Parsing...' : 'Parse & Link Ingredients'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {parseLinkItems.filter(i => i.action === 'link').length} linked,{' '}
                      {parseLinkItems.filter(i => i.action === 'create').length} new items to create
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setHasParsed(false); setParseLinkItems([]); }}>
                      Re-parse
                    </Button>
                  </div>

                  {parseLinkItems.map((item, idx) => (
                    <div key={idx} className="p-3 rounded-lg border space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {item.parsedQuantity != null && (
                            <span className="font-medium text-sm shrink-0">
                              {item.parsedQuantity}{item.parsedUnit ? ` ${item.parsedUnit}` : ''}
                            </span>
                          )}
                          <span className="text-sm truncate">{item.parsedName}</span>
                          {item.parsedNotes && (
                            <span className="text-xs text-muted-foreground truncate">({item.parsedNotes})</span>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            className={`text-xs px-2 py-0.5 rounded transition-colors ${
                              item.action === 'link'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setParseLinkItems(prev => prev.map((p, i) =>
                              i === idx ? { ...p, action: 'link' } : p
                            ))}
                          >
                            Link existing
                          </button>
                          <button
                            type="button"
                            className={`text-xs px-2 py-0.5 rounded transition-colors ${
                              item.action === 'create'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setParseLinkItems(prev => prev.map((p, i) =>
                              i === idx ? { ...p, action: 'create', linkedItemId: undefined, linkedItemName: undefined } : p
                            ))}
                          >
                            Create new
                          </button>
                        </div>
                      </div>

                      {item.action === 'link' ? (
                        <Combobox
                          options={existingItemOptions}
                          value={item.linkedItemId || ''}
                          onValueChange={(itemId) => {
                            const existing = existingItems.find(i => i.id === itemId);
                            setParseLinkItems(prev => prev.map((p, i) =>
                              i === idx ? { ...p, linkedItemId: itemId || undefined, linkedItemName: existing?.name } : p
                            ));
                          }}
                          placeholder="Search items..."
                          searchPlaceholder="Type to search..."
                          emptyText="No items found"
                        />
                      ) : (
                        <div className="space-y-1.5">
                          <input
                            className="text-sm bg-transparent border-b border-border focus:border-primary focus:outline-none px-0 py-0.5 w-full"
                            placeholder="Item name"
                            value={item.suggestedName}
                            onChange={(e) => setParseLinkItems(prev => prev.map((p, i) =>
                              i === idx ? { ...p, suggestedName: e.target.value } : p
                            ))}
                          />
                          <div className="flex items-center gap-2">
                            <select
                              className="text-xs rounded border bg-muted/50 px-1.5 py-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                              value={item.category || ''}
                              onChange={(e) => setParseLinkItems(prev => prev.map((p, i) =>
                                i === idx ? { ...p, category: e.target.value || undefined } : p
                              ))}
                            >
                              <option value="">No category</option>
                              {categories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                            {item.similarExisting && (
                              <Badge variant="outline" className="text-xs text-warning-foreground border-warning/50">
                                Similar to: {item.similarExisting}
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>)}


            {activeStep === "instructions" && (<div className="space-y-4 py-2">
              {instructionFields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                    {index + 1}
                  </div>
                  <Input
                    placeholder="Instruction step"
                    className="flex-1"
                    id={`instruction-input-${index}`}
                    {...register(`instructions.${index}.text` as const)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        appendInstruction({ step: instructionFields.length + 1, text: '' });
                        setTimeout(() => {
                          document.getElementById(`instruction-input-${index + 1}`)?.focus();
                        }, 50);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeInstruction(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  appendInstruction({ step: instructionFields.length + 1, text: '' })
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Step
              </Button>
            </div>)}

          </div>

          {/* Step navigation */}
          <DialogFooter className="flex justify-between mt-4 flex-shrink-0 border-t pt-4">
            <div>
              {isEditing && onDelete && activeStep === 'details' && (
                <Button type="button" variant="destructive" onClick={onDelete} disabled={isSubmitting}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {currentStepIndex > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveStep(formSteps[currentStepIndex - 1].key)}
                >
                  Back
                </Button>
              )}
              {currentStepIndex === 0 && (
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
              )}
              {!isLastStep ? (
                <Button
                  type="button"
                  onClick={() => {
                    const nextStep = formSteps[currentStepIndex + 1];
                    // Auto-parse when entering parse-link step
                    if (nextStep.key === 'parse-link' && !hasParsed) {
                      handleParseIngredients();
                    }
                    setActiveStep(nextStep.key);
                  }}
                >
                  Continue to {formSteps[currentStepIndex + 1].label}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={async () => {
                    // Manually trigger form submission with parseLinkItems applied
                    const data = getValues();
                    await handleFormSubmit(data);
                  }}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isEditing ? 'Save Changes' : 'Save Recipe'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
