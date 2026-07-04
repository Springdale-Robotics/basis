/** Tiny class joiner — no tailwind-merge needed at this component scale. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Shared text-input styling (kept here so component files export only components). */
export function inputClasses(extra?: string): string {
  return cn(
    'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900',
    'placeholder:text-stone-400 focus:border-pine-500 focus:outline-none focus:ring-1 focus:ring-pine-500',
    extra,
  );
}
