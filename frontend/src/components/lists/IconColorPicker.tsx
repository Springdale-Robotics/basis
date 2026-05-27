import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LIST_COLOR_OPTIONS, LIST_ICON_OPTIONS } from '@/lib/listTypes';
import { cn } from '@/lib/utils';

interface IconColorPickerProps {
  icon: string | null | undefined;
  color: string | null | undefined;
  onIconChange: (value: string | null) => void;
  onColorChange: (value: string | null) => void;
}

export function IconColorPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: IconColorPickerProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium">Icon</label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onIconChange(null)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md border text-lg',
              !icon ? 'border-primary bg-primary/10' : 'border-input',
            )}
            aria-label="No icon"
          >
            —
          </button>
          {LIST_ICON_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onIconChange(emoji)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-md border text-lg',
                icon === emoji ? 'border-primary bg-primary/10' : 'border-input',
              )}
            >
              {emoji}
            </button>
          ))}
          <Input
            value={icon ?? ''}
            onChange={(e) => onIconChange(e.target.value || null)}
            placeholder="Custom"
            className="h-9 w-20"
            maxLength={4}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Color</label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onColorChange(null)}
            className={cn(
              'h-7 w-7 rounded-full border-2',
              !color ? 'border-foreground' : 'border-transparent bg-muted',
            )}
            aria-label="No color"
          />
          {LIST_COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColorChange(c)}
              className={cn(
                'h-7 w-7 rounded-full border-2',
                color === c ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
