import { useMemo, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { unitOptions, categoryIcons } from '@/lib/inventory-constants';
import { useCategories } from '@/hooks/useCategories';

/**
 * Shared Unit / Category / Storage Area field comboboxes.
 *
 * These wrap the generic Combobox with canonical option-building and copy so
 * every form that picks a unit, category, or storage area renders the same
 * field the same way. Pass `label` to get a standard labelled block
 * (`space-y-2` + Label); omit it when the call site controls its own
 * label/layout.
 */

interface FieldComboboxProps {
  value?: string;
  onValueChange: (value: string) => void;
  /** Renders a standard labelled block. Omit to control layout at the call site. */
  label?: string;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
  className?: string;
  disabled?: boolean;
}

function FieldShell({ label, children }: { label?: string; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Build combobox options from unit keys (defaults to the full unit registry). */
function buildUnitOptions(units: readonly string[] = unitOptions): ComboboxOption[] {
  return units.map((u) => ({ value: u, label: u }));
}

/** Build combobox options from category names, with their canonical icons. */
function buildCategoryOptions(categories: readonly string[]): ComboboxOption[] {
  return categories.map((cat) => ({
    value: cat,
    label: cat,
    icon: categoryIcons[cat] ? <span>{categoryIcons[cat]}</span> : undefined,
  }));
}

export interface AreaOptionSource {
  id: string;
  name: string;
  icon?: string | null;
}

/** Build combobox options from storage areas, with their icons. */
function buildAreaOptions(areas: readonly AreaOptionSource[]): ComboboxOption[] {
  return areas.map((area) => ({
    value: area.id,
    label: area.name,
    icon: area.icon ? <span>{area.icon}</span> : undefined,
  }));
}

export function UnitCombobox({
  units,
  label,
  placeholder = 'Select unit',
  ...rest
}: FieldComboboxProps & {
  /** Restrict or reorder the option keys (defaults to the full unit registry). */
  units?: readonly string[];
}) {
  const options = useMemo(() => buildUnitOptions(units), [units]);
  return (
    <FieldShell label={label}>
      <Combobox
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Search units..."
        emptyText="No unit found"
        {...rest}
      />
    </FieldShell>
  );
}

export function CategoryCombobox({
  label,
  placeholder = 'Select category',
  ...rest
}: FieldComboboxProps) {
  const { categories } = useCategories();
  const options = useMemo(() => buildCategoryOptions(categories), [categories]);
  return (
    <FieldShell label={label}>
      <Combobox
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Search categories..."
        emptyText="No category found"
        {...rest}
      />
    </FieldShell>
  );
}

export function AreaCombobox({
  areas,
  label,
  placeholder = 'Select area',
  ...rest
}: FieldComboboxProps & { areas: readonly AreaOptionSource[] }) {
  const options = useMemo(() => buildAreaOptions(areas), [areas]);
  return (
    <FieldShell label={label}>
      <Combobox
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Search areas..."
        emptyText="No area found"
        {...rest}
      />
    </FieldShell>
  );
}
