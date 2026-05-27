import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useState } from 'react';
import { Loader2, Package, Gauge, Tags, Plus, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { householdsApi } from '@/api/households';
import { settingsApi } from '@/api/settings';
import { toast } from '@/hooks/useToast';
import { getErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/hooks/useAuth';
import { useInventoryTier, type InventoryTier } from '@/hooks/useInventoryTier';
import { useCategories } from '@/hooks/useCategories';
import { defaultCategories, categoryIcons } from '@/lib/inventory-constants';
import { cn } from '@/lib/utils';

const householdSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  timezone: z.string().min(1, 'Timezone is required'),
});

type HouseholdFormData = z.infer<typeof householdSchema>;

const timezones = Intl.supportedValuesOf('timeZone');

export function HouseholdSettingsPage() {
  const { household, refetch } = useAuth();
  const queryClient = useQueryClient();
  const { tier } = useInventoryTier();
  const { categories, hiddenCategories } = useCategories();
  const [newCategory, setNewCategory] = useState('');
  const customCategories = (household?.settings?.inventory?.customCategories || []) as string[];
  const hasHiddenDefaults = hiddenCategories.length > 0;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<HouseholdFormData>({
    resolver: zodResolver(householdSchema),
    defaultValues: {
      name: household?.name || '',
      timezone: household?.timezone || '',
    },
  });

  const timezone = watch('timezone');

  const updateMutation = useMutation({
    mutationFn: householdsApi.update,
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['household'] });
      toast({ title: 'Household updated' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const tierMutation = useMutation({
    mutationFn: (newTier: InventoryTier) =>
      settingsApi.updateHouseholdSettings({
        inventory: { tier: newTier },
      }),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['household'] });
      toast({ title: 'Inventory mode updated' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const categoryMutation = useMutation({
    mutationFn: (update: { customCategories?: string[]; hiddenCategories?: string[] }) =>
      settingsApi.updateHouseholdSettings({
        // Include current inventory state — backend does a shallow merge at the
        // top level, so omitting tier here would clobber it.
        inventory: { ...household?.settings?.inventory, tier, ...update },
      }),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['household'] });
    },
    onError: (err) => {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    },
  });

  const addCategory = () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    if (categories.includes(trimmed)) {
      toast({ title: 'Category already exists', variant: 'destructive' });
      return;
    }
    categoryMutation.mutate({ customCategories: [...customCategories, trimmed] });
    setNewCategory('');
  };

  const removeCustomCategory = (cat: string) => {
    categoryMutation.mutate({ customCategories: customCategories.filter(c => c !== cat) });
  };

  const hideDefaultCategory = (cat: string) => {
    categoryMutation.mutate({ hiddenCategories: [...hiddenCategories, cat] });
  };

  const resetCategories = () => {
    categoryMutation.mutate({ hiddenCategories: [], customCategories: [] });
  };

  const onSubmit = (data: HouseholdFormData) => {
    updateMutation.mutate(data);
  };

  if (!household) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Household Information</CardTitle>
          <CardDescription>Manage your household settings</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Household Name</Label>
              <Input id="name" {...register('name')} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                value={timezone}
                onValueChange={(value) => setValue('timezone', value, { shouldDirty: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.timezone && (
                <p className="text-sm text-destructive">{errors.timezone.message}</p>
              )}
            </div>

            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Inventory Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory Mode
          </CardTitle>
          <CardDescription>
            Choose how your household tracks inventory and generates shopping lists
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={tierMutation.isPending}
              onClick={() => tier !== 'basic' && tierMutation.mutate('basic')}
              className={cn(
                'rounded-lg border-2 p-4 text-left transition-colors',
                tier === 'basic'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  <span className="font-medium">Basic</span>
                </div>
                {tier === 'basic' && <Badge variant="secondary">Active</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                Manual shopping list management. Add recipe ingredients to your list and remove what you already have. Simple and low-effort.
              </p>
            </button>
            <button
              type="button"
              disabled={tierMutation.isPending}
              onClick={() => tier !== 'advanced' && tierMutation.mutate('advanced')}
              className={cn(
                'rounded-lg border-2 p-4 text-left transition-colors',
                tier === 'advanced'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4" />
                  <span className="font-medium">Advanced</span>
                </div>
                {tier === 'advanced' && <Badge variant="secondary">Active</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                Full inventory tracking with quantities, confidence scores, and smart shopping lists. The system learns what you have and suggests what to buy.
              </p>
            </button>
          </div>
          {tier === 'advanced' && (
            <p className="mt-3 text-xs text-muted-foreground">
              Confidence indicators show how certain the system is about your stock levels. They decay over time and reset when you verify or purchase items.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Inventory Categories */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5" />
            Inventory Categories
          </CardTitle>
          <CardDescription>
            Categories used to organize your inventory items. Add custom categories for your household.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Active categories */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Categories</p>
              {(hasHiddenDefaults || customCategories.length > 0) && (
                <button
                  type="button"
                  onClick={resetCategories}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  disabled={categoryMutation.isPending}
                >
                  Reset to defaults
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {defaultCategories.filter(c => !hiddenCategories.includes(c)).map((cat) => (
                <span
                  key={cat}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
                >
                  {categoryIcons[cat] && <span>{categoryIcons[cat]}</span>}
                  {cat}
                  {cat !== 'Other' && (
                    <button
                      type="button"
                      onClick={() => hideDefaultCategory(cat)}
                      className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                      disabled={categoryMutation.isPending}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {customCategories.map((cat) => (
                <span
                  key={cat}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs"
                >
                  {cat}
                  <button
                    type="button"
                    onClick={() => removeCustomCategory(cat)}
                    className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                    disabled={categoryMutation.isPending}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Hidden defaults */}
          {hasHiddenDefaults && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Hidden</p>
              <div className="flex flex-wrap gap-1.5">
                {hiddenCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => categoryMutation.mutate({ hiddenCategories: hiddenCategories.filter(c => c !== cat) })}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-solid transition-colors"
                    disabled={categoryMutation.isPending}
                  >
                    {categoryIcons[cat] && <span>{categoryIcons[cat]}</span>}
                    <span className="line-through">{cat}</span>
                    <Plus className="h-3 w-3 ml-0.5" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add new */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="New category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCategory())}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={addCategory}
              disabled={!newCategory.trim() || categoryMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Household ID</CardTitle>
          <CardDescription>Your unique household identifier</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="rounded bg-muted px-2 py-1 text-sm">{household.id}</code>
        </CardContent>
      </Card>

    </div>
  );
}
