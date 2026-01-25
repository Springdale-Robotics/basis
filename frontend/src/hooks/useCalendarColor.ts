import { useTheme } from '@/hooks/useTheme';
import { getColorForIndex, getColorLabelForIndex } from '@/lib/theme-presets';

/**
 * Hook to resolve a calendar's color index to an actual hex color value
 * based on the user's currently selected color palette.
 *
 * @param colorIndex - The color index (0-11) stored in the calendar
 * @returns The resolved hex color value
 */
export function useCalendarColor(colorIndex: number): string {
  const { colorPalette } = useTheme();
  return getColorForIndex(colorPalette, colorIndex);
}

/**
 * Hook to resolve a calendar's color index to a color label
 * based on the user's currently selected color palette.
 *
 * @param colorIndex - The color index (0-11) stored in the calendar
 * @returns The color label (e.g., "Blue", "Green", etc.)
 */
export function useCalendarColorLabel(colorIndex: number): string {
  const { colorPalette } = useTheme();
  return getColorLabelForIndex(colorPalette, colorIndex);
}

/**
 * Hook to get both color and label for a calendar's color index
 *
 * @param colorIndex - The color index (0-11) stored in the calendar
 * @returns Object with color (hex) and label properties
 */
export function useCalendarColorInfo(colorIndex: number): { color: string; label: string } {
  const { colorPalette } = useTheme();
  return {
    color: getColorForIndex(colorPalette, colorIndex),
    label: getColorLabelForIndex(colorPalette, colorIndex),
  };
}
