import { Input } from '@/components/ui/input';
import { hslStringToHex, hexToHslString } from '@/lib/theme-presets';

interface ColorPickerRowProps {
  label: string;
  value: string; // HSL string like "260 40% 98%"
  onChange: (hsl: string) => void;
}

export function ColorPickerRow({ label, value, onChange }: ColorPickerRowProps) {
  const hex = hslStringToHex(value);

  const handleColorChange = (newHex: string) => {
    // Validate hex format
    if (/^#[0-9A-Fa-f]{6}$/.test(newHex)) {
      onChange(hexToHslString(newHex));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    // Add # if missing
    if (!val.startsWith('#')) {
      val = '#' + val;
    }
    // Only update if it's a valid 6-digit hex
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      handleColorChange(val);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-sm text-foreground truncate" title={label}>
        {label}
      </label>
      <input
        type="color"
        value={hex}
        onChange={(e) => handleColorChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5"
      />
      <Input
        value={hex.toUpperCase()}
        onChange={handleInputChange}
        className="w-24 font-mono text-xs"
        maxLength={7}
      />
      <div
        className="h-8 w-8 rounded border border-border shadow-sm flex-shrink-0"
        style={{ backgroundColor: hex }}
        title={`Preview: ${hex}`}
      />
    </div>
  );
}
