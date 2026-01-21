import { useState, useMemo, useCallback } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StorageArea } from '@/types/models';
import { categoryOptions, unitOptions } from '@/lib/inventory-constants';

export interface BulkAddItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  defaultAreaId: string;
}

interface BulkAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areas: StorageArea[];
  onSubmit: (items: Array<{ name: string; category?: string; defaultUnit?: string; defaultAreaId?: string }>) => void;
  isSubmitting?: boolean;
}

let itemIdCounter = 0;
const generateId = () => `bulk-item-${++itemIdCounter}`;

export function BulkAddDialog({
  open,
  onOpenChange,
  areas,
  onSubmit,
  isSubmitting,
}: BulkAddDialogProps) {
  const [items, setItems] = useState<BulkAddItem[]>([
    { id: generateId(), name: '', category: '', unit: 'pieces', defaultAreaId: '' },
  ]);
  const [quickAddText, setQuickAddText] = useState('');
  const [defaultCategory, setDefaultCategory] = useState('');
  const [defaultUnit, setDefaultUnit] = useState('pieces');
  const [defaultAreaId, setDefaultAreaId] = useState('');

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

  const handleAddRow = useCallback(() => {
    setItems((prev) => [
      ...prev,
      { id: generateId(), name: '', category: defaultCategory, unit: defaultUnit, defaultAreaId: defaultAreaId },
    ]);
  }, [defaultCategory, defaultUnit, defaultAreaId]);

  const handleRemoveRow = useCallback((id: string) => {
    setItems((prev) => {
      if (prev.length === 1) {
        return [{ id: generateId(), name: '', category: '', unit: 'pieces', defaultAreaId: '' }];
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handleItemChange = useCallback(
    (id: string, field: keyof BulkAddItem, value: string) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    []
  );

  const handleApplyDefaultsToAll = useCallback(() => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        category: item.category || defaultCategory,
        unit: item.unit || defaultUnit,
        defaultAreaId: item.defaultAreaId || defaultAreaId,
      }))
    );
  }, [defaultCategory, defaultUnit, defaultAreaId]);

  const handleQuickAdd = useCallback(() => {
    const lines = quickAddText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) return;

    const newItems: BulkAddItem[] = lines.map((name) => ({
      id: generateId(),
      name,
      category: defaultCategory,
      unit: defaultUnit,
      defaultAreaId: defaultAreaId,
    }));

    setItems((prev) => {
      // If only one empty item, replace it
      if (prev.length === 1 && !prev[0].name) {
        return newItems;
      }
      return [...prev, ...newItems];
    });
    setQuickAddText('');
  }, [quickAddText, defaultCategory, defaultUnit, defaultAreaId]);

  const handleSubmit = () => {
    const validItems = items
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        category: item.category || undefined,
        defaultUnit: item.unit || undefined,
        defaultAreaId: item.defaultAreaId || undefined,
      }));

    if (validItems.length > 0) {
      onSubmit(validItems);
    }
  };

  const handleClose = () => {
    setItems([{ id: generateId(), name: '', category: '', unit: 'pieces', defaultAreaId: '' }]);
    setQuickAddText('');
    setDefaultCategory('');
    setDefaultUnit('pieces');
    setDefaultAreaId('');
    onOpenChange(false);
  };

  const validItemCount = items.filter((item) => item.name.trim()).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Add Items</DialogTitle>
          <DialogDescription>
            Add multiple items to your inventory catalog at once.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="table" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="table">Table Entry</TabsTrigger>
            <TabsTrigger value="quick">Quick Add (Paste List)</TabsTrigger>
          </TabsList>

          <TabsContent value="table" className="flex-1 flex flex-col min-h-0 mt-4">
            {/* Default values section */}
            <div className="border rounded-lg p-4 mb-4 bg-muted/30">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-medium">Default Values for New Items</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyDefaultsToAll}
                >
                  <Copy className="mr-2 h-3 w-3" />
                  Apply to Empty Fields
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <Combobox
                    options={categoryComboboxOptions}
                    value={defaultCategory}
                    onValueChange={setDefaultCategory}
                    placeholder="Category"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                    allowClear
                    clearLabel="None"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Unit</Label>
                  <Combobox
                    options={unitComboboxOptions}
                    value={defaultUnit}
                    onValueChange={(v) => setDefaultUnit(v || 'pieces')}
                    placeholder="Unit"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Storage Area</Label>
                  <Combobox
                    options={areaComboboxOptions}
                    value={defaultAreaId}
                    onValueChange={setDefaultAreaId}
                    placeholder="Area"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                    allowClear
                    clearLabel="None"
                  />
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="flex-1 min-h-0">
              <div className="grid grid-cols-[1fr,auto,auto,auto,auto] gap-2 mb-2 px-1 text-xs font-medium text-muted-foreground">
                <div>Name *</div>
                <div className="w-[140px]">Category</div>
                <div className="w-[100px]">Unit</div>
                <div className="w-[140px]">Storage Area</div>
                <div className="w-8"></div>
              </div>
              <ScrollArea className="h-[280px] pr-4">
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[1fr,auto,auto,auto,auto] gap-2 items-center"
                    >
                      <Input
                        placeholder={`Item ${index + 1}`}
                        value={item.name}
                        onChange={(e) => handleItemChange(item.id, 'name', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddRow();
                          }
                        }}
                      />
                      <div className="w-[140px]">
                        <Combobox
                          options={categoryComboboxOptions}
                          value={item.category}
                          onValueChange={(v) => handleItemChange(item.id, 'category', v)}
                          placeholder="Category"
                          searchPlaceholder="Search..."
                          emptyText="Not found"
                          allowClear
                          clearLabel="None"
                        />
                      </div>
                      <div className="w-[100px]">
                        <Combobox
                          options={unitComboboxOptions}
                          value={item.unit}
                          onValueChange={(v) => handleItemChange(item.id, 'unit', v || 'pieces')}
                          placeholder="Unit"
                          searchPlaceholder="Search..."
                          emptyText="Not found"
                        />
                      </div>
                      <div className="w-[140px]">
                        <Combobox
                          options={areaComboboxOptions}
                          value={item.defaultAreaId}
                          onValueChange={(v) => handleItemChange(item.id, 'defaultAreaId', v)}
                          placeholder="Area"
                          searchPlaceholder="Search..."
                          emptyText="Not found"
                          allowClear
                          clearLabel="None"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleRemoveRow(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={handleAddRow}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Row
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="quick" className="flex-1 flex flex-col min-h-0 mt-4">
            {/* Default values for quick add */}
            <div className="border rounded-lg p-4 mb-4 bg-muted/30">
              <Label className="text-sm font-medium mb-3 block">
                Default Values for Pasted Items
              </Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <Combobox
                    options={categoryComboboxOptions}
                    value={defaultCategory}
                    onValueChange={setDefaultCategory}
                    placeholder="Category"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                    allowClear
                    clearLabel="None"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Unit</Label>
                  <Combobox
                    options={unitComboboxOptions}
                    value={defaultUnit}
                    onValueChange={(v) => setDefaultUnit(v || 'pieces')}
                    placeholder="Unit"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Storage Area</Label>
                  <Combobox
                    options={areaComboboxOptions}
                    value={defaultAreaId}
                    onValueChange={setDefaultAreaId}
                    placeholder="Area"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                    allowClear
                    clearLabel="None"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 flex-1">
              <Label htmlFor="quick-add">Paste item names (one per line)</Label>
              <Textarea
                id="quick-add"
                placeholder="Milk&#10;Eggs&#10;Bread&#10;Butter&#10;Cheese"
                value={quickAddText}
                onChange={(e) => setQuickAddText(e.target.value)}
                className="flex-1 min-h-[200px]"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {quickAddText.split('\n').filter((line) => line.trim()).length} items to add
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleQuickAdd}
                  disabled={!quickAddText.trim()}
                >
                  Add to Table
                </Button>
              </div>
            </div>

            {items.some((item) => item.name) && (
              <div className="mt-4 border-t pt-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Current items in table: {validItemCount}
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <div className="flex items-center justify-between w-full">
            <p className="text-sm text-muted-foreground">
              {validItemCount} {validItemCount === 1 ? 'item' : 'items'} to add
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting || validItemCount === 0}>
                {isSubmitting ? 'Adding...' : `Add ${validItemCount} Items`}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
