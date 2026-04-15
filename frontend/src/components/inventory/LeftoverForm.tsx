import { useForm } from 'react-hook-form';
import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Loader2, UtensilsCrossed, Store, ChefHat, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { leftoverFormSchema, type LeftoverFormData } from '@/types/forms';
import type { Leftover, StorageArea, LeftoverSource } from '@/types/models';
import { recipesApi } from '@/api/recipes';
import { useInventoryTier } from '@/hooks/useInventoryTier';

interface LeftoverFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leftover?: Leftover | null;
  areas: StorageArea[];
  onSubmit: (data: LeftoverFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
}

const sourceOptions: { value: LeftoverSource; label: string; icon: React.ReactNode }[] = [
  { value: 'recipe', label: 'From Recipe', icon: <UtensilsCrossed className="h-4 w-4" /> },
  { value: 'restaurant', label: 'Restaurant', icon: <Store className="h-4 w-4" /> },
  { value: 'homemade', label: 'Homemade', icon: <ChefHat className="h-4 w-4" /> },
  { value: 'other', label: 'Other', icon: <HelpCircle className="h-4 w-4" /> },
];

function getDefaultExpiryDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 4); // Default to 4 days from now
  return date.toISOString().split('T')[0];
}

function formatDateForInput(dateString: string): string {
  // Handle both ISO strings and date-only strings
  return dateString.split('T')[0];
}

export function LeftoverForm({
  open,
  onOpenChange,
  leftover,
  areas,
  onSubmit,
  onDelete,
  isSubmitting,
}: LeftoverFormProps) {
  const isEditing = !!leftover;
  const { isAdvanced } = useInventoryTier();

  const { data: recipesData } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list(),
    enabled: open,
  });

  const getDefaultValues = (leftover: Leftover | null | undefined): LeftoverFormData => {
    if (leftover) {
      return {
        name: leftover.name,
        description: leftover.description || '',
        source: leftover.source,
        sourceRecipeId: leftover.sourceRecipeId || '',
        restaurantName: leftover.restaurantName || '',
        areaId: leftover.areaId || '',
        portions: typeof leftover.portions === 'string' ? parseFloat(leftover.portions) : leftover.portions,
        quantityNotes: leftover.quantityNotes || '',
        preparedAt: formatDateForInput(leftover.preparedAt),
        expiryDate: formatDateForInput(leftover.expiryDate),
      };
    }
    return {
      name: '',
      description: '',
      source: 'homemade',
      sourceRecipeId: '',
      restaurantName: '',
      areaId: areas[0]?.id || '',
      portions: 1,
      quantityNotes: '',
      preparedAt: new Date().toISOString().split('T')[0],
      expiryDate: getDefaultExpiryDate(),
    };
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<LeftoverFormData>({
    resolver: zodResolver(leftoverFormSchema),
    defaultValues: getDefaultValues(leftover),
  });

  // Reset form when leftover changes or dialog opens
  useEffect(() => {
    if (open) {
      reset(getDefaultValues(leftover));
    }
  }, [leftover, open, reset, areas]);

  const source = watch('source');
  const sourceRecipeId = watch('sourceRecipeId');
  const areaId = watch('areaId');

  // Update name when recipe is selected
  useEffect(() => {
    if (source === 'recipe' && sourceRecipeId && recipesData?.recipes) {
      const selectedRecipe = recipesData.recipes.find(r => r.id === sourceRecipeId);
      if (selectedRecipe) {
        setValue('name', selectedRecipe.title);
      }
    }
  }, [sourceRecipeId, source, recipesData, setValue]);

  // Memoize combobox options
  const recipeOptions: ComboboxOption[] = useMemo(
    () =>
      (recipesData?.recipes || []).map((recipe) => ({
        value: recipe.id,
        label: recipe.title,
      })),
    [recipesData]
  );

  const areaComboboxOptions: ComboboxOption[] = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

  const handleFormSubmit = (data: LeftoverFormData) => {
    onSubmit(data);
    reset();
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Leftover' : 'Add Leftover'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="What's this leftover?"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Source</Label>
            <Select
              value={source}
              onValueChange={(value: LeftoverSource) => {
                setValue('source', value);
                // Clear source-specific fields when changing source
                if (value !== 'recipe') setValue('sourceRecipeId', '');
                if (value !== 'restaurant') setValue('restaurantName', '');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {sourceOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      {opt.icon}
                      {opt.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {source === 'recipe' && (
            <div className="space-y-2">
              <Label>Recipe</Label>
              <Combobox
                options={recipeOptions}
                value={sourceRecipeId || ''}
                onValueChange={(value) => setValue('sourceRecipeId', value)}
                placeholder="Select recipe..."
                searchPlaceholder="Search recipes..."
                emptyText="No recipes found."
                allowClear
                clearLabel="No recipe"
              />
              <p className="text-xs text-muted-foreground">
                Selecting a recipe will auto-fill the name
              </p>
            </div>
          )}

          {source === 'restaurant' && (
            <div className="space-y-2">
              <Label htmlFor="restaurantName">Restaurant Name</Label>
              <Input
                id="restaurantName"
                placeholder="Where did you get this?"
                {...register('restaurantName')}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Storage Area</Label>
            <Combobox
              options={areaComboboxOptions}
              value={areaId || ''}
              onValueChange={(value) => setValue('areaId', value)}
              placeholder="Select storage area"
              searchPlaceholder="Search areas..."
              emptyText="No area found."
              allowClear
              clearLabel="No area"
            />
          </div>

          {isAdvanced && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="portions">Portions</Label>
                <Input
                  id="portions"
                  type="number"
                  step="0.5"
                  min="0.5"
                  {...register('portions', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantityNotes">Quantity Notes</Label>
                <Input
                  id="quantityNotes"
                  placeholder="e.g., 2 cups"
                  {...register('quantityNotes')}
                />
              </div>
            </div>
          )}

          <div className={isAdvanced ? 'grid grid-cols-2 gap-4' : ''}>
            <div className="space-y-2">
              <Label htmlFor="preparedAt">Prepared Date</Label>
              <Input
                id="preparedAt"
                type="date"
                {...register('preparedAt')}
              />
            </div>
            {isAdvanced && (
              <div className="space-y-2">
                <Label htmlFor="expiryDate">Expiry Date</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  {...register('expiryDate')}
                />
                {errors.expiryDate && (
                  <p className="text-sm text-destructive">{errors.expiryDate.message}</p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Notes (optional)</Label>
            <Textarea
              id="description"
              placeholder="Any additional notes..."
              rows={2}
              {...register('description')}
            />
          </div>

          <DialogFooter className="flex justify-between">
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
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isEditing ? 'Save' : 'Add Leftover'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
