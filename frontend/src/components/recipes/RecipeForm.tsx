import { useState, useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical, Loader2, Link2, Check, Search, Package } from 'lucide-react';
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
import { recipeSchema, type RecipeFormData } from '@/types/forms';
import { inventoryApi } from '@/api/inventory';
import { cn } from '@/lib/utils';
import type { Recipe, InventoryItem } from '@/types/models';

interface RecipeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe?: Recipe | null;
  onSubmit: (data: RecipeFormData) => void;
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

export function RecipeForm({
  open,
  onOpenChange,
  recipe,
  onSubmit,
  onDelete,
  isSubmitting,
}: RecipeFormProps) {
  const isEditing = !!recipe;
  const [activeTab, setActiveTab] = useState('details');

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
                unit: ing.unit || '',
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
    }
  }, [open, recipe, reset]);

  const handleFormSubmit = (data: RecipeFormData) => {
    onSubmit(data);
  };

  const handleFormError = (errors: any) => {
    console.error('Form validation errors:', errors);
  };

  const handleClose = () => {
    reset();
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
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-secondary rounded-md text-sm"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <Input
                  placeholder="Add tag and press Enter"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag(e.currentTarget.value);
                      e.currentTarget.value = '';
                    }
                  }}
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
                      <div className="w-20">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div>
                                <Input
                                  placeholder="Unit"
                                  disabled={isLinked}
                                  className={cn(isLinked && 'bg-muted cursor-not-allowed')}
                                  {...register(`ingredients.${index}.unit` as const)}
                                />
                              </div>
                            </TooltipTrigger>
                            {isLinked && (
                              <TooltipContent>
                                <p>Unit is set by the linked inventory item</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
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
    </Dialog>
  );
}
