import { useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Info, Database, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { inventoryItemSchema, type InventoryItemFormData } from '@/types/forms';
import type { InventoryItem, StorageArea } from '@/types/models';
import { unitOptions, getUnitOptionsByCategory } from '@/lib/inventory-constants';
import { lookupDensityWithSource, type DensityMatch } from '@/lib/ingredient-densities';
import { useInventoryTier } from '@/hooks/useInventoryTier';
import { useCategories } from '@/hooks/useCategories';
import { categoryIcons } from '@/lib/inventory-constants';

interface ItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: InventoryItem | null;
  areas: StorageArea[];
  defaultAreaId?: string;
  currentExpiryDate?: string | null;
  onSubmit: (data: InventoryItemFormData) => void;
  onDelete?: () => void;
  isSubmitting?: boolean;
}

export function ItemForm({
  open,
  onOpenChange,
  item,
  areas,
  defaultAreaId,
  currentExpiryDate,
  onSubmit,
  onDelete,
  isSubmitting,
}: ItemFormProps) {
  const isEditing = !!item;
  const { isAdvanced } = useInventoryTier();
  const { categories } = useCategories();
  const [densitySuggestion, setDensitySuggestion] = useState<DensityMatch | null>(null);

  const getDefaultValues = (item: InventoryItem | null | undefined): InventoryItemFormData => {
    if (item) {
      return {
        name: item.name,
        category: item.category || '',
        unit: item.defaultUnit || item.unit || 'pieces',
        icon: item.icon || '',
        barcode: item.barcode || '',
        keepInStock: item.keepInStock ?? false,
        keepInStockThreshold: item.minStockQuantity ?? item.minStockLevel ?? item.keepInStockThreshold ?? 1,
        defaultAreaId: item.defaultAreaId || defaultAreaId || '',
        density: item.density ?? undefined,
        quantityUnitSizes: item.quantityUnitSizes ?? {},
        defaultShelfLifeDays: item.defaultShelfLifeDays ?? undefined,
        expiryDate: currentExpiryDate ? currentExpiryDate.split('T')[0] : undefined,
      };
    }
    return {
      name: '',
      category: '',
      unit: 'pieces',
      icon: '',
      barcode: '',
      keepInStock: false,
      keepInStockThreshold: 1,
      defaultAreaId: defaultAreaId || areas[0]?.id || '',
      density: undefined,
      quantityUnitSizes: {},
      defaultShelfLifeDays: undefined,
      expiryDate: undefined,
    };
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<InventoryItemFormData>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: getDefaultValues(item),
  });

  useEffect(() => {
    if (open) {
      reset(getDefaultValues(item));
    }
  }, [item, open, reset, defaultAreaId, areas]);

  const category = watch('category');
  const unit = watch('unit');
  const keepInStock = watch('keepInStock');
  const areaId = watch('defaultAreaId');
  const name = watch('name');
  const density = watch('density');
  const quantityUnitSizes = watch('quantityUnitSizes') ?? {};

  // Inline "add conversion" row state. Kept local so we don't validate it as
  // part of the form schema — it's committed to `quantityUnitSizes` on click.
  const [newConvUnit, setNewConvUnit] = useState('');
  const [newConvQuantity, setNewConvQuantity] = useState('');
  const [newConvSizeUnit, setNewConvSizeUnit] = useState('');

  const addConversion = () => {
    const key = newConvUnit.trim().toLowerCase();
    const qty = parseFloat(newConvQuantity);
    if (!key || !newConvSizeUnit || isNaN(qty) || qty <= 0) return;
    setValue(
      'quantityUnitSizes',
      { ...quantityUnitSizes, [key]: { quantity: qty, unit: newConvSizeUnit } },
      { shouldDirty: true }
    );
    setNewConvUnit('');
    setNewConvQuantity('');
    setNewConvSizeUnit('');
  };

  const removeConversion = (key: string) => {
    const next = { ...quantityUnitSizes };
    delete next[key];
    setValue('quantityUnitSizes', next, { shouldDirty: true });
  };
  const icon = watch('icon');
  const shelfLifeDays = watch('defaultShelfLifeDays');
  const expiryDate = watch('expiryDate');
  const categoryIcon = category ? categoryIcons[category] || '📦' : '📦';

  // Auto-fill expiry date from shelf life when creating new items
  useEffect(() => {
    if (shelfLifeDays && shelfLifeDays > 0 && !expiryDate && !item) {
      const date = new Date();
      date.setDate(date.getDate() + shelfLifeDays);
      setValue('expiryDate', date.toISOString().split('T')[0]);
    }
  }, [shelfLifeDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-suggest density based on item name
  useEffect(() => {
    if (name && name.length >= 2) {
      const match = lookupDensityWithSource(name);
      setDensitySuggestion(match);
    } else {
      setDensitySuggestion(null);
    }
  }, [name]);

  const categoryComboboxOptions: ComboboxOption[] = useMemo(
    () => categories.map((cat) => ({
      value: cat,
      label: cat,
      icon: categoryIcons[cat] ? <span>{categoryIcons[cat]}</span> : undefined,
    })),
    [categories]
  );

  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
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

  const handleFormSubmit = (data: InventoryItemFormData) => {
    onSubmit(data);
    reset();
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Item' : 'Add Inventory Item'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
          {/* === Basics === */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Item name"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className={isAdvanced ? 'grid grid-cols-2 gap-3' : ''}>
              <div className="space-y-2">
                <Label>Category</Label>
                <Combobox
                  options={categoryComboboxOptions}
                  value={category}
                  onValueChange={(value) => setValue('category', value)}
                  placeholder="Select category"
                  searchPlaceholder="Search categories..."
                  emptyText="No category found."
                  allowClear
                  clearLabel="No category"
                />
              </div>
              {isAdvanced && (
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Combobox
                    options={unitComboboxOptions}
                    value={unit}
                    onValueChange={(value) => setValue('unit', value || 'pieces')}
                    placeholder="Select unit"
                    searchPlaceholder="Search units..."
                    emptyText="No unit found."
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Default Storage Area</Label>
              <Combobox
                options={areaComboboxOptions}
                value={areaId}
                onValueChange={(value) => setValue('defaultAreaId', value)}
                placeholder="Select storage area"
                searchPlaceholder="Search areas..."
                emptyText="No area found."
                allowClear
                clearLabel="No default area"
              />
            </div>
          </div>

          {/* === Freshness === */}
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Freshness</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="expiryDate" className="text-sm">Expires On</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  {...register('expiryDate')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="shelfLife" className="text-sm">Shelf Life (days)</Label>
                <Input
                  id="shelfLife"
                  type="number"
                  min="1"
                  placeholder="e.g., 7"
                  {...register('defaultShelfLifeDays', { valueAsNumber: true })}
                />
              </div>
            </div>
          </div>

          {/* === Details === */}
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="icon" className="text-sm">Icon override</Label>
                <div className="flex items-center gap-2">
                  <span className="text-lg w-8 text-center shrink-0" title={icon ? 'Custom icon' : `Default: ${category || 'Other'}`}>
                    {icon || categoryIcon}
                  </span>
                  <Input
                    id="icon"
                    placeholder={`Default: ${categoryIcon}`}
                    {...register('icon')}
                  />
                </div>
                {!icon && (
                  <p className="text-xs text-muted-foreground">Using {category || 'default'} category icon</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="barcode" className="text-sm">Barcode</Label>
                <Input
                  id="barcode"
                  placeholder="Optional"
                  {...register('barcode')}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="density" className="text-sm">Density (g/cup)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 text-sm" side="top">
                    <p className="font-medium mb-1">What is density?</p>
                    <p className="text-muted-foreground text-xs">
                      Density (grams per cup) lets the system convert between weight and volume units for this item.
                      For example, 1 cup of flour = 125g.
                    </p>
                    <p className="text-muted-foreground text-xs mt-2">
                      Suggestions come from a database of 400+ ingredients sourced from:
                    </p>
                    <ul className="text-muted-foreground text-xs mt-1 list-disc ml-4 space-y-0.5">
                      <li><span className="font-medium">USDA FoodData Central</span> — produce, dairy, proteins, spices</li>
                      <li><span className="font-medium">King Arthur Baking</span> — flours, baking ingredients</li>
                      <li><span className="font-medium">Standard measurement</span> — oils, liquids (known physical densities)</li>
                    </ul>
                    <p className="text-muted-foreground text-xs mt-1.5">
                      Each suggestion shows its source. You can always override with your own measurement.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <Input
                id="density"
                type="number"
                step="0.001"
                min="0"
                placeholder="e.g., 125"
                {...register('density', { valueAsNumber: true })}
              />
              {densitySuggestion && !density && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">Suggestion:</span>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 hover:bg-muted transition-colors"
                    onClick={() => setValue('density', densitySuggestion.density)}
                  >
                    <Database className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium capitalize">{densitySuggestion.matchedKey}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-medium">{densitySuggestion.density} g/cup</span>
                    <span className="text-muted-foreground">· {densitySuggestion.source}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* === Conversions === */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">Conversions</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-sm" side="top">
                  <p className="font-medium mb-1">What are conversions?</p>
                  <p className="text-muted-foreground text-xs">
                    For count units like <span className="font-medium">bottle</span>,{' '}
                    <span className="font-medium">bag</span>, <span className="font-medium">can</span>,
                    record how big one is in a standard unit. The engine then
                    bridges this unit anywhere it shows up.
                  </p>
                  <p className="text-muted-foreground text-xs mt-2">
                    Example: <span className="font-medium">1 bottle = 16 fl oz</span> lets a recipe asking for
                    "2 tsp olive oil" subtract from your bottle stock without needing a density.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            {Object.keys(quantityUnitSizes).length > 0 && (
              <div className="space-y-1.5">
                {Object.entries(quantityUnitSizes).map(([key, size]) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm"
                  >
                    <span className="font-medium">1 {key}</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="font-medium tabular-nums">{size.quantity}</span>
                    <span>{size.unit}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeConversion(key)}
                      aria-label={`Remove conversion for ${key}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">1 of…</Label>
                <Combobox
                  options={getUnitOptionsByCategory('count').map((u) => ({ value: u, label: u }))}
                  value={newConvUnit}
                  onValueChange={setNewConvUnit}
                  placeholder="bottle"
                  searchPlaceholder="Search units..."
                  emptyText="No unit found"
                  className="h-9"
                />
              </div>
              <span className="pb-2 text-muted-foreground">=</span>
              <div className="w-24 space-y-1">
                <Label htmlFor="new-conv-quantity" className="text-xs text-muted-foreground">
                  Qty
                </Label>
                <Input
                  id="new-conv-quantity"
                  type="number"
                  step="any"
                  min="0"
                  value={newConvQuantity}
                  onChange={(e) => setNewConvQuantity(e.target.value)}
                  placeholder="16"
                  className="h-9"
                />
              </div>
              <div className="w-28 space-y-1">
                <Label className="text-xs text-muted-foreground">Unit</Label>
                <Combobox
                  options={unitOptions.map((u) => ({ value: u, label: u }))}
                  value={newConvSizeUnit}
                  onValueChange={setNewConvSizeUnit}
                  placeholder="unit"
                  searchPlaceholder="Search units..."
                  emptyText="No unit found"
                  className="h-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={addConversion}
                disabled={
                  !newConvUnit.trim() ||
                  !newConvSizeUnit ||
                  !newConvQuantity ||
                  parseFloat(newConvQuantity) <= 0
                }
                aria-label="Add conversion"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* === Stock Tracking (Advanced only) === */}
          {isAdvanced && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stock Tracking</p>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="keepInStock" className="text-sm">Keep in Stock</Label>
                  <p className="text-xs text-muted-foreground">
                    Add to shopping list when low
                  </p>
                </div>
                <Switch
                  id="keepInStock"
                  checked={keepInStock}
                  onCheckedChange={(checked) => setValue('keepInStock', checked)}
                />
              </div>
              {keepInStock && (
                <div className="space-y-1">
                  <Label htmlFor="keepInStockThreshold" className="text-sm">
                    Minimum Quantity {unit && <span className="text-muted-foreground">({unit})</span>}
                  </Label>
                  <Input
                    id="keepInStockThreshold"
                    type="number"
                    min="1"
                    {...register('keepInStockThreshold', { valueAsNumber: true })}
                  />
                </div>
              )}
            </div>
          )}

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
                {isEditing ? 'Save' : 'Add Item'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
