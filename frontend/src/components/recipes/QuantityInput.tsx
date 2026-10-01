import { useEffect, useRef, useState } from 'react';
import { Input, type InputProps } from '@/components/ui/input';

interface QuantityInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type'> {
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
}

/**
 * Text field for an ingredient quantity. It keeps the text the user typed and
 * only hands a number up once that text parses.
 *
 * Feeding `parseFloat(text)` straight back as `value` breaks mid-edit states:
 * "0." collapses to "0" (the decimal is eaten and the caret jumps), and "."
 * becomes NaN, which renders as "NaN" and parses to NaN forever after.
 */
export function QuantityInput({ value, onValueChange, onBlur, ...props }: QuantityInputProps) {
  const [text, setText] = useState(() => format(value));
  // Last value we emitted — lets us tell our own echo apart from an outside
  // change (row removed, overrides reset) that should replace the text.
  const emitted = useRef(value);

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(format(value));
    }
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parse(raw);
        if (parsed !== null) {
          emitted.current = parsed;
          onValueChange(parsed);
        }
      }}
      onBlur={(e) => {
        // Text that never parsed (e.g. "." alone) would otherwise sit there
        // looking saved while the old value is what's actually kept.
        if (parse(text) === null) setText(format(value));
        onBlur?.(e);
      }}
    />
  );
}

function format(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value);
}

/** undefined = cleared, null = not (yet) a number. */
function parse(raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
