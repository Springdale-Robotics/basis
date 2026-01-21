import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { inventoryItemSchema, type InventoryItemFormData } from '@/types/forms';
import type { InventoryItem, StorageArea } from '@/types/models';

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

const categoryOptions = [
  'Produce',
  'Dairy',
  'Meat',
  'Seafood',
  'Bakery',
  'Frozen',
  'Canned Goods',
  'Dry Goods',
  'Beverages',
  'Snacks',
  'Condiments',
  'Spices',
  'Cleaning',
  'Personal Care',
  'Other',
];

const unitOptions = [
  'pieces',
  'lbs',
  'oz',
  'kg',
  'g',
  'liters',
  'ml',
  'cups',
  'tbsp',
  'tsp',
  'gallons',
  'quarts',
  'pints',
  'boxes',
  'bags',
  'cans',
  'bottles',
  'jars',
  'packs',
];

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

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<InventoryItemFormData>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: item
      ? {
          name: item.name,
          category: item.category || '',
          unit: item.unit || 'pieces',
          icon: item.icon || '',
          barcode: item.barcode || '',
          keepInStock: !!item.keepInStockThreshold,
          keepInStockThreshold: item.keepInStockThreshold || 1,
          defaultAreaId: item.defaultAreaId || defaultAreaId || '',
        }
      : {
          name: '',
          category: '',
          unit: 'pieces',
          icon: '',
          barcode: '',
          keepInStock: false,
          keepInStockThreshold: 1,
          defaultAreaId: defaultAreaId || areas[0]?.id || '',
        },
  });

  const category = watch('category');
  const unit = watch('unit');
  const keepInStock = watch('keepInStock');
  const areaId = watch('defaultAreaId');

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
              <Label htmlFor="category">Category</Label>
              <Select
                value={category}
                onValueChange={(value) => setValue('category', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Select
                value={unit}
                onValueChange={(value) => setValue('unit', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultAreaId">Default Storage Area</Label>
            <Select
              value={areaId}
              onValueChange={(value) => setValue('defaultAreaId', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select storage area" />
              </SelectTrigger>
              <SelectContent>
                {areas.map((area) => (
                  <SelectItem key={area.id} value={area.id}>
                    <div className="flex items-center gap-2">
                      <span>{area.icon}</span>
                      {area.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
