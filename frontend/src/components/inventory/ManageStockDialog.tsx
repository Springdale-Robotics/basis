import { useState, useMemo, useCallback } from 'react';
import { Plus, Trash2, Edit, Save, X, Package } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { QuantityWeightPromptDialog } from './UnitConversionPromptDialog';
import type { StorageArea, InventoryItem, StockEntry } from '@/types/models';
import { unitOptions, calculateTotalStock, convertQuantity, normalizeUnit } from '@/lib/inventory-constants';
import { isCountUnit as isQuantityUnit } from '@/lib/units';
import { formatDate, cn } from '@/lib/utils';
import { inventoryApi } from '@/api/inventory';

interface ManageStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
  areas: StorageArea[];
  stockEntries: StockEntry[];
  onAddStock: (data: { itemId: string; areaId: string; quantity: number; unit?: string; expiryDate?: string }) => void;
  onUpdateStock: (id: string, data: { quantity?: number; unit?: string; expiryDate?: string; notes?: string }) => void;
  onDeleteStock: (id: string) => void;
  isSubmitting?: boolean;
}

interface AddStockForm {
  areaId: string;
  quantity: string;
  unit: string;
  expiryDate: string;
}

interface EditingStock {
  id: string;
  quantity: string;
  unit: string;
  expiryDate: string;
  notes: string;
}

interface QuantityWeightPrompt {
  unit: string;
  pendingStock: AddStockForm;
}

export function ManageStockDialog({
  open,
  onOpenChange,
  item,
  areas,
  stockEntries,
  onAddStock,
  onUpdateStock,
  onDeleteStock,
  isSubmitting,
}: ManageStockDialogProps) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddStockForm>({
    areaId: '',
    quantity: '1',
    unit: item?.defaultUnit || 'pieces',
    expiryDate: '',
  });
  const [editingStock, setEditingStock] = useState<EditingStock | null>(null);
  const [quantityWeightPrompt, setQuantityWeightPrompt] = useState<QuantityWeightPrompt | null>(null);

  // Mutation for saving quantity unit weights
  const saveQuantityWeightMutation = useMutation({
    mutationFn: (data: { unit: string; grams: number }) =>
      inventoryApi.saveQuantityUnitWeight(item!.id, data.unit, data.grams),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
  });

  // Get stock entries for this item
  const itemStock = useMemo(() => {
    if (!item) return [];
    return stockEntries.filter((entry) => {
      const entryItemId = entry.itemId || entry.inventoryItemId;
      return entryItemId === item.id;
    });
  }, [stockEntries, item]);

  // Calculate total quantity with density-based conversions
  const stockTotal = useMemo(() => {
    const targetUnit = item?.defaultUnit || 'pieces';
    const density = item?.density ?? null;
    const quantityUnitWeights = item?.quantityUnitWeights || {};
    return calculateTotalStock(itemStock, targetUnit, density, quantityUnitWeights);
  }, [itemStock, item?.defaultUnit, item?.density, item?.quantityUnitWeights]);

  // Area lookup
  const areaLookup = useMemo(() => {
    const lookup: Record<string, StorageArea> = {};
    for (const area of areas) {
      lookup[area.id] = area;
    }
    return lookup;
  }, [areas]);

  // Combobox options
  const areaComboboxOptions: ComboboxOption[] = useMemo(
    () =>
      areas.map((area) => ({
        value: area.id,
        label: area.name,
        icon: <span>{area.icon}</span>,
      })),
    [areas]
  );

  const unitComboboxOptions: ComboboxOption[] = useMemo(
    () => unitOptions.map((u) => ({ value: u, label: u })),
    []
  );

  // Check if a conversion exists between two units
  const hasConversion = useCallback((fromUnit: string, toUnit: string): boolean => {
    if (fromUnit === toUnit) return true;
    const density = item?.density ?? null;
    const quantityUnitWeights = item?.quantityUnitWeights || {};
    return convertQuantity(1, fromUnit, toUnit, density, quantityUnitWeights) !== null;
  }, [item?.density, item?.quantityUnitWeights]);

  // Actually add the stock (after conversion check passes)
  const doAddStock = useCallback((formData: AddStockForm) => {
    if (!item) return;

    const quantity = parseFloat(formData.quantity);
    if (isNaN(quantity) || quantity <= 0) return;

    onAddStock({
      itemId: item.id,
      areaId: formData.areaId,
      quantity,
      unit: formData.unit || undefined,
      expiryDate: formData.expiryDate || undefined,
    });

    // Reset form
    setAddForm({
      areaId: item.defaultAreaId || '',
      quantity: '1',
      unit: item.defaultUnit || 'pieces',
      expiryDate: '',
    });
    setShowAddForm(false);
  }, [item, onAddStock]);

  const handleAddStock = useCallback(() => {
    if (!item || !addForm.areaId || !addForm.quantity) return;

    const quantity = parseFloat(addForm.quantity);
    if (isNaN(quantity) || quantity <= 0) return;

    const defaultUnit = item.defaultUnit || 'pieces';
    const stockUnit = addForm.unit || defaultUnit;

    // Check if we need a conversion
    if (stockUnit !== defaultUnit && !hasConversion(stockUnit, defaultUnit)) {
      // Check if the stock unit is a quantity unit that needs a weight
      const normUnit = normalizeUnit(stockUnit);
      if (isQuantityUnit(normUnit)) {
        setQuantityWeightPrompt({
          unit: normUnit,
          pendingStock: { ...addForm },
        });
        return;
      }
      // For other unconvertible units, just add the stock anyway
    }

    doAddStock(addForm);
  }, [item, addForm, hasConversion, doAddStock]);

  const handleQuantityWeightConfirm = async (grams: number) => {
    if (!quantityWeightPrompt || !item) return;

    // Save the quantity unit weight to the server
    await saveQuantityWeightMutation.mutateAsync({
      unit: quantityWeightPrompt.unit,
      grams,
    });

    // Now add the stock
    doAddStock(quantityWeightPrompt.pendingStock);
    setQuantityWeightPrompt(null);
  };

  const handleQuantityWeightSkip = () => {
    if (quantityWeightPrompt) {
      // Add stock without conversion
      doAddStock(quantityWeightPrompt.pendingStock);
    }
    setQuantityWeightPrompt(null);
  };

  const handleStartEdit = (entry: StockEntry) => {
    setEditingStock({
      id: entry.id,
      quantity: String(entry.quantity),
      unit: entry.unit || item?.defaultUnit || 'pieces',
      expiryDate: entry.expiryDate ? entry.expiryDate.split('T')[0] : '',
      notes: entry.notes || '',
    });
  };

  const handleSaveEdit = () => {
    if (!editingStock) return;

    const quantity = parseFloat(editingStock.quantity);
    if (isNaN(quantity) || quantity <= 0) return;

    onUpdateStock(editingStock.id, {
      quantity,
      unit: editingStock.unit || undefined,
      expiryDate: editingStock.expiryDate || undefined,
      notes: editingStock.notes || undefined,
    });

    setEditingStock(null);
  };

  const handleCancelEdit = () => {
    setEditingStock(null);
  };

  const handleClose = () => {
    setShowAddForm(false);
    setEditingStock(null);
    setAddForm({
      areaId: '',
      quantity: '1',
      unit: item?.defaultUnit || 'pieces',
      expiryDate: '',
    });
    onOpenChange(false);
  };

  // Reset form when item changes
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && item) {
      setAddForm({
        areaId: item.defaultAreaId || '',
        quantity: '1',
        unit: item.defaultUnit || 'pieces',
        expiryDate: '',
      });
    }
    if (!isOpen) {
      handleClose();
    } else {
      onOpenChange(isOpen);
    }
  };

  if (!item) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Manage Stock: {item.name}
          </DialogTitle>
          <DialogDescription>
            Add, edit, or remove stock entries for this item.
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">Total in stock</p>
            <p className="text-2xl font-bold">
              {stockTotal.total.toFixed(1)} {item.defaultUnit || 'units'}
            </p>
            {!stockTotal.allConverted && (
              <p className="text-xs text-amber-600 mt-1">
                + items in {stockTotal.unconvertedUnits.join(', ')} (no conversion available)
              </p>
            )}
          </div>
          <Badge variant={stockTotal.total > 0 ? 'default' : 'outline'}>
            {itemStock.length} location{itemStock.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Stock entries list */}
        <div className="flex-1 min-h-0 max-h-[300px] overflow-y-auto overscroll-contain">
          <div className="space-y-2 pr-2">
            {itemStock.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No stock entries yet</p>
                <p className="text-sm">Add stock using the button below</p>
              </div>
            ) : (
              itemStock.map((entry) => {
                const area = areaLookup[entry.areaId];
                const isEditing = editingStock?.id === entry.id;

                return (
                  <Card key={entry.id} className={cn(isEditing && 'ring-2 ring-primary')}>
                    <CardContent className="p-3">
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">Quantity</Label>
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                value={editingStock.quantity}
                                onChange={(e) =>
                                  setEditingStock({ ...editingStock, quantity: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Unit</Label>
                              <Combobox
                                options={unitComboboxOptions}
                                value={editingStock.unit}
                                onValueChange={(v) =>
                                  setEditingStock({ ...editingStock, unit: v || 'pieces' })
                                }
                                placeholder="Unit"
                                searchPlaceholder="Search..."
                                emptyText="Not found"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Expiry Date</Label>
                            <Input
                              type="date"
                              value={editingStock.expiryDate}
                              onChange={(e) =>
                                setEditingStock({ ...editingStock, expiryDate: e.target.value })
                              }
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleCancelEdit}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleSaveEdit}
                              disabled={isSubmitting}
                            >
                              <Save className="h-4 w-4 mr-1" />
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              {area && (
                                <span className="flex items-center gap-1 text-sm font-medium">
                                  {area.icon} {area.name}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              <span className="font-mono">
                                {parseFloat(String(entry.quantity)).toFixed(1)} {entry.unit || item.defaultUnit}
                              </span>
                              {entry.expiryDate && (
                                <span>
                                  Expires: {formatDate(entry.expiryDate)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleStartEdit(entry)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => onDeleteStock(entry.id)}
                              disabled={isSubmitting}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* Add stock form */}
        {showAddForm ? (
          <Card className="border-dashed">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Add Stock</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddForm(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Storage Area *</Label>
                  <Combobox
                    options={areaComboboxOptions}
                    value={addForm.areaId}
                    onValueChange={(v) => setAddForm({ ...addForm, areaId: v })}
                    placeholder="Select area..."
                    searchPlaceholder="Search areas..."
                    emptyText="No areas found"
                  />
                </div>
                <div>
                  <Label className="text-xs">Quantity *</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={addForm.quantity}
                    onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })}
                    placeholder="1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit</Label>
                  <Combobox
                    options={unitComboboxOptions}
                    value={addForm.unit}
                    onValueChange={(v) => setAddForm({ ...addForm, unit: v || 'pieces' })}
                    placeholder="Unit"
                    searchPlaceholder="Search..."
                    emptyText="Not found"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Expiry Date (optional)</Label>
                  <Input
                    type="date"
                    value={addForm.expiryDate}
                    onChange={(e) => setAddForm({ ...addForm, expiryDate: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleAddStock}
                  disabled={isSubmitting || !addForm.areaId || !addForm.quantity}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Stock
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Stock
          </Button>
        )}
      </DialogContent>
    </Dialog>

    {/* Quantity Weight Prompt */}
    {item && quantityWeightPrompt && (
      <QuantityWeightPromptDialog
        open={!!quantityWeightPrompt}
        onOpenChange={(open) => !open && setQuantityWeightPrompt(null)}
        itemName={item.name}
        unit={quantityWeightPrompt.unit}
        onConfirm={handleQuantityWeightConfirm}
        onSkip={handleQuantityWeightSkip}
      />
    )}
    </>
  );
}
