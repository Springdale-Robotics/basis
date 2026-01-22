import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { unitOptions } from '@/lib/inventory-constants';
import type { UnitConversion } from '@/types/models';

interface UnitConversionsEditorProps {
  conversions: UnitConversion[];
  onChange: (conversions: UnitConversion[]) => void;
}

export function UnitConversionsEditor({ conversions, onChange }: UnitConversionsEditorProps) {
  const [newFromUnit, setNewFromUnit] = useState('');
  const [newToUnit, setNewToUnit] = useState('');
  const [newFactor, setNewFactor] = useState('');

  const unitComboboxOptions: ComboboxOption[] = unitOptions.map((u) => ({
    value: u,
    label: u,
  }));

  const handleAdd = () => {
    if (!newFromUnit || !newToUnit || !newFactor) return;

    const factor = parseFloat(newFactor);
    if (isNaN(factor) || factor <= 0) return;

    // Check for duplicates
    const exists = conversions.some(
      c => c.fromUnit.toLowerCase() === newFromUnit.toLowerCase() &&
           c.toUnit.toLowerCase() === newToUnit.toLowerCase()
    );

    if (exists) {
      // Update existing
      onChange(conversions.map(c =>
        c.fromUnit.toLowerCase() === newFromUnit.toLowerCase() &&
        c.toUnit.toLowerCase() === newToUnit.toLowerCase()
          ? { fromUnit: newFromUnit, toUnit: newToUnit, factor }
          : c
      ));
    } else {
      onChange([...conversions, { fromUnit: newFromUnit, toUnit: newToUnit, factor }]);
    }

    setNewFromUnit('');
    setNewToUnit('');
    setNewFactor('');
  };

  const handleRemove = (index: number) => {
    onChange(conversions.filter((_, i) => i !== index));
  };

  const formatConversion = (conv: UnitConversion) => {
    return `1 ${conv.fromUnit} = ${conv.factor} ${conv.toUnit}`;
  };

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Unit Conversions</Label>
      <p className="text-xs text-muted-foreground">
        Add custom conversions for this item (e.g., 1 cup flour = 120 g)
      </p>

      {/* Existing conversions */}
      {conversions.length > 0 && (
        <div className="space-y-2">
          {conversions.map((conv, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-2 bg-muted rounded-md text-sm"
            >
              <span>{formatConversion(conv)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(index)}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add new conversion */}
      <div className="grid grid-cols-[1fr,auto,1fr,auto,auto] gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Combobox
            options={unitComboboxOptions}
            value={newFromUnit}
            onValueChange={setNewFromUnit}
            placeholder="Unit"
            searchPlaceholder="Search..."
            emptyText="No unit found"
          />
        </div>
        <span className="pb-2 text-muted-foreground">=</span>
        <div className="space-y-1">
          <Label className="text-xs">Factor</Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={newFactor}
            onChange={(e) => setNewFactor(e.target.value)}
            placeholder="e.g., 120"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Combobox
            options={unitComboboxOptions}
            value={newToUnit}
            onValueChange={setNewToUnit}
            placeholder="Unit"
            searchPlaceholder="Search..."
            emptyText="No unit found"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleAdd}
          disabled={!newFromUnit || !newToUnit || !newFactor}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
