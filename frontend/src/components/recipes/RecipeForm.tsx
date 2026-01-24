import { useState, useEffect, useRef, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, Loader2, Link2, Check, Search, Package, Tag, X } from 'lucide-react';
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
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { recipeSchema, type RecipeFormData } from '@/types/forms';
import { inventoryApi } from '@/api/inventory';
import { recipesApi } from '@/api/recipes';
import { RecipeImageInput } from './RecipeImageInput';
import { cn } from '@/lib/utils';
import type { Recipe, InventoryItem, UnitConversion } from '@/types/models';
import { unitOptions, normalizeUnit } from '@/lib/inventory-constants';
import { UnitConversionPromptDialog } from '@/components/inventory/UnitConversionPromptDialog';

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

interface PendingConversion {
  ingredientIndex: number;
  ingredientName: string;
  itemId: string;
  itemName: string;
  fromUnit: string;
  toUnit: string;
}

export function RecipeForm({
  open,
  onOpenChange,
  recipe,
  onSubmit,
  onDelete,
  isSubmitting,
}: RecipeFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!recipe;
  const [activeTab, setActiveTab] = useState('details');
  const [pendingConversions, setPendingConversions] = useState<PendingConversion[]>([]);
  const [currentConversionIndex, setCurrentConversionIndex] = useState(0);
  const [pendingFormData, setPendingFormData] = useState<RecipeFormData | null>(null);

  // Image state
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);

  // Fetch inventory items to check for unit conversions
  const { data: itemsData } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => inventoryApi.getItems(),
    staleTime: 60000,
  });

  const {
    register,
    handleSubmit,
    control,
    setValue,
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
              servings: recipe.servings || 4,
              difficulty: recipe.difficulty || 'medium',
              ingredients: (recipe.ingredients || []).map((ing) => ({
                name: ing.name || '',
                amount: typeof ing.amount === 'number' ? ing.amount : 0,
                unit: normalizeUnit(ing.unit),
                notes: ing.notes ?? undefined,
                optional: ing.optional ?? undefined,
                inventoryItemId: ing.inventoryItemId ?? undefined,
              })),
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
    }
  }, [open, recipe, reset]);

  const items = itemsData?.items || [];

  // Check if a unit conversion exists for an item
  const hasConversion = (item: InventoryItem, fromUnit: string, toUnit: string): boolean => {
    const normalizeUnit = (u: string) => u.toLowerCase().trim();
    const normFrom = normalizeUnit(fromUnit);
    const normTo = normalizeUnit(toUnit);

    if (normFrom === normTo) return true;

    const conversions = (item.unitConversions || []) as UnitConversion[];
    return conversions.some(c =>
      (normalizeUnit(c.fromUnit) === normFrom && normalizeUnit(c.toUnit) === normTo) ||
      (normalizeUnit(c.fromUnit) === normTo && normalizeUnit(c.toUnit) === normFrom)
    );
  };

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

  const handleFormSubmit = (data: RecipeFormData) => {
    // Check for ingredients that need unit conversions
    const neededConversions: PendingConversion[] = [];

    for (let i = 0; i < data.ingredients.length; i++) {
      const ing = data.ingredients[i];
      if (ing.inventoryItemId && ing.unit) {
        const item = items.find(it => it.id === ing.inventoryItemId);
        if (item && item.defaultUnit && ing.unit !== item.defaultUnit) {
          // Check if conversion already exists
          if (!hasConversion(item, ing.unit, item.defaultUnit)) {
            neededConversions.push({
              ingredientIndex: i,
              ingredientName: ing.name,
              itemId: item.id,
              itemName: item.name,
              fromUnit: ing.unit,
              toUnit: item.defaultUnit,
            });
          }
        }
      }
    }

    if (neededConversions.length > 0) {
      // Store form data and show conversion prompts
      setPendingFormData(data);
      setPendingConversions(neededConversions);
      setCurrentConversionIndex(0);
    } else {
      // No conversions needed, submit directly
      onSubmit(data, getImageChange());
    }
  };

  const handleConversionConfirm = async (factor: number, saveForFuture: boolean) => {
    const currentConversion = pendingConversions[currentConversionIndex];

    if (saveForFuture && currentConversion) {
      // Save the conversion to the inventory item
      await inventoryApi.addUnitConversion(currentConversion.itemId, {
        fromUnit: currentConversion.fromUnit,
        toUnit: currentConversion.toUnit,
        factor,
      });
      // Invalidate inventory queries
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    }

    // Move to next conversion or submit
    if (currentConversionIndex < pendingConversions.length - 1) {
      setCurrentConversionIndex(currentConversionIndex + 1);
    } else {
      // All conversions handled, submit the form
      if (pendingFormData) {
        onSubmit(pendingFormData, getImageChange());
      }
      setPendingConversions([]);
      setPendingFormData(null);
      setCurrentConversionIndex(0);
    }
  };

  const handleConversionSkip = () => {
    // Move to next conversion or submit
    if (currentConversionIndex < pendingConversions.length - 1) {
      setCurrentConversionIndex(currentConversionIndex + 1);
    } else {
      // All conversions handled (skipped), submit the form
      if (pendingFormData) {
        onSubmit(pendingFormData, getImageChange());
      }
      setPendingConversions([]);
      setPendingFormData(null);
      setCurrentConversionIndex(0);
    }
  };

  const handleFormError = (errors: any) => {
    console.error('Form validation errors:', errors);
  };

  const handleClose = () => {
    reset();
    setPendingConversions([]);
    setPendingFormData(null);
    setCurrentConversionIndex(0);
    // Reset image state
    setPendingImageFile(null);
    setPendingImageUrl(null);
    setImageProcessing(false);
    setCurrentImage(null);
    setImageRemoved(false);
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
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Recipe' : 'New Recipe'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit, handleFormError)}>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
              <TabsTrigger value="instructions">Instructions</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 min-h-[340px]">
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
            </TabsContent>

            <TabsContent value="ingredients" className="space-y-4 min-h-[340px]">
              <p className="text-xs text-muted-foreground mb-2">
                Search your inventory to add ingredients (auto-links for stock tracking) or type custom names
              </p>
              {ingredientFields.map((field, index) => {
                const ingredientName = watch(`ingredients.${index}.name`);
                const inventoryItemId = watch(`ingredients.${index}.inventoryItemId`);
                const isLinked = !!inventoryItemId;

                return (
                  <div key={field.id} className="flex gap-2 items-start">
                    <GripVertical className="h-4 w-4 mt-3 text-muted-foreground cursor-grab" />
                    <div className="flex gap-2 flex-1">
                      <div className="w-20">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Amt"
                          {...register(`ingredients.${index}.amount` as const, {
                            valueAsNumber: true,
                          })}
                        />
                      </div>
                      <div className="w-24">
                        <UnitCombobox
                          value={watch(`ingredients.${index}.unit`) || ''}
                          onChange={(value) => setValue(`ingredients.${index}.unit`, value)}
                        />
                      </div>
                      <IngredientNameInput
                        value={ingredientName || ''}
                        inventoryItemId={inventoryItemId}
                        onNameChange={(name) => setValue(`ingredients.${index}.name`, name)}
                        onSelectInventoryItem={(itemId, itemName, defaultUnit) => {
                          setValue(`ingredients.${index}.name`, itemName);
                          setValue(`ingredients.${index}.inventoryItemId`, itemId);
                          // Always set unit from inventory item when linking
                          if (defaultUnit) {
                            setValue(`ingredients.${index}.unit`, defaultUnit);
                          }
                        }}
                        onUnlink={() => setValue(`ingredients.${index}.inventoryItemId`, undefined)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeIngredient(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                onClick={() => appendIngredient({ name: '', amount: 1, unit: '' })}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Ingredient
              </Button>
            </TabsContent>

            <TabsContent value="instructions" className="space-y-4 min-h-[340px]">
              {instructionFields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium shrink-0">
                    {index + 1}
                  </div>
                  <Input
                    placeholder="Instruction step"
                    className="flex-1"
                    {...register(`instructions.${index}.text` as const)}
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
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex justify-between mt-6">
            {isEditing && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={onDelete}
                disabled={isSubmitting}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? 'Save' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* Unit Conversion Prompt Dialog */}
      {pendingConversions.length > 0 && pendingConversions[currentConversionIndex] && (
        <UnitConversionPromptDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setPendingConversions([]);
              setPendingFormData(null);
              setCurrentConversionIndex(0);
            }
          }}
          itemName={pendingConversions[currentConversionIndex].itemName}
          fromUnit={pendingConversions[currentConversionIndex].fromUnit}
          toUnit={pendingConversions[currentConversionIndex].toUnit}
          onConfirm={handleConversionConfirm}
          onSkip={handleConversionSkip}
        />
      )}
    </Dialog>
  );
}
