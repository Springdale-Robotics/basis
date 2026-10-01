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

const VULGAR_FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6,
  '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};

const GLYPHS = Object.keys(VULGAR_FRACTIONS).join('');
const SIMPLE_FRACTION = /^(\d+)\/(\d+)$/; // 1/4, 12/3
const MIXED_FRACTION = /^(\d+)\s+(\d+)\/(\d+)$/; // 1 1/2
const GLYPH_FRACTION = new RegExp(`^(\\d+)?\\s*([${GLYPHS}])$`); // ¼, 1¼, 1 ¼

/** undefined = cleared, null = not (yet) a number. Accepts decimals and fractions. */
function parse(raw: string): number | undefined | null {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  let n = Number(trimmed);
  let m: RegExpExecArray | null;
  if ((m = SIMPLE_FRACTION.exec(trimmed))) {
    n = Number(m[1]) / Number(m[2]);
  } else if ((m = MIXED_FRACTION.exec(trimmed))) {
    n = Number(m[1]) + Number(m[2]) / Number(m[3]);
  } else if ((m = GLYPH_FRACTION.exec(trimmed))) {
    n = Number(m[1] ?? 0) + VULGAR_FRACTIONS[m[2]];
  }
  return Number.isFinite(n) && n >= 0 ? n : null;
}
