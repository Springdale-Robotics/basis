import { useForm } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { inventoryItemSchema, type InventoryItemFormData } from '@/types/forms';
import type { InventoryItem, StorageArea, UnitConversion } from '@/types/models';
import { categoryOptions, unitOptions } from '@/lib/inventory-constants';
import { UnitConversionsEditor } from './UnitConversionsEditor';

interface ItemFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: InventoryItem | null;
  areas: StorageArea[];
  defaultAreaId?: string;
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
  onSubmit,
  onDelete,
  isSubmitting,
}: ItemFormProps) {
  const isEditing = !!item;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const getDefaultValues = (item: InventoryItem | null | undefined): InventoryItemFormData => {
    if (item) {
      return {
        name: item.name,
        category: item.category || '',
        unit: item.defaultUnit || item.unit || 'pieces',
        icon: item.icon || '',
        barcode: item.barcode || '',
        keepInStock: item.keepInStock ?? false,
        keepInStockThreshold: item.minStockLevel || item.keepInStockThreshold || 1,
        defaultAreaId: item.defaultAreaId || defaultAreaId || '',
        unitConversions: item.unitConversions || [],
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
      unitConversions: [],
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

  // Reset form when item changes (for editing different items)
  useEffect(() => {
    if (open) {
      reset(getDefaultValues(item));
      // Open advanced settings if there are conversions
      setAdvancedOpen((item?.unitConversions?.length ?? 0) > 0);
    }
  }, [item, open, reset, defaultAreaId, areas]);

  const category = watch('category');
  const unit = watch('unit');
  const keepInStock = watch('keepInStock');
  const areaId = watch('defaultAreaId');
  const unitConversions = watch('unitConversions') || [];

  // Memoize combobox options
  const categoryComboboxOptions: ComboboxOption[] = useMemo(
    () => categoryOptions.map((cat) => ({ value: cat, label: cat })),
    []
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Item' : 'Add Inventory Item'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
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

          <div className="grid grid-cols-2 gap-4">
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="icon">Icon (emoji)</Label>
              <Input
                id="icon"
                placeholder="📦"
                {...register('icon')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="barcode">Barcode</Label>
              <Input
                id="barcode"
                placeholder="Optional barcode"
                {...register('barcode')}
              />
            </div>
          </div>

          <div className="space-y-4 border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="keepInStock">Keep in Stock</Label>
                <p className="text-sm text-muted-foreground">
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
              <div className="space-y-2">
                <Label htmlFor="keepInStockThreshold">Minimum Quantity</Label>
                <Input
                  id="keepInStockThreshold"
                  type="number"
                  min="1"
                  {...register('keepInStockThreshold', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">
                  Alert when quantity falls below this number
                </p>
              </div>
            )}
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-between px-4"
              >
                Advanced Settings
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="border rounded-lg p-4 mt-2">
              <UnitConversionsEditor
                conversions={unitConversions as UnitConversion[]}
                onChange={(newConversions) => setValue('unitConversions', newConversions)}
              />
            </CollapsibleContent>
          </Collapsible>

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
