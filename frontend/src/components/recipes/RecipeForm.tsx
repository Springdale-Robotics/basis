import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, GripVertical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { recipeSchema, type RecipeFormData } from '@/types/forms';
import type { Recipe } from '@/types/models';

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
              {ingredientFields.map((field, index) => (
                <div key={field.id} className="flex gap-2 items-start">
                  <GripVertical className="h-4 w-4 mt-3 text-muted-foreground cursor-grab" />
                  <div className="grid grid-cols-12 gap-2 flex-1">
                    <div className="col-span-2">
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
                    <div className="col-span-3">
                      <Input
                        placeholder="Unit"
                        {...register(`ingredients.${index}.unit` as const)}
                      />
                    </div>
                    <div className="col-span-6">
                      <Input
                        placeholder="Ingredient name"
                        {...register(`ingredients.${index}.name` as const)}
                      />
                    </div>
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
              ))}
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
