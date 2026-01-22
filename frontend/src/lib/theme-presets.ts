// Primary accent colors (HSL format for CSS variables)
export const COLOR_PRESETS = {
  default: { name: 'Default', primary: '9 91% 64%' },
  blue: { name: 'Blue', primary: '221.2 83.2% 53.3%' },
  green: { name: 'Green', primary: '142.1 76.2% 36.3%' },
  purple: { name: 'Purple', primary: '262.1 83.3% 57.8%' },
  rose: { name: 'Rose', primary: '346.8 77.2% 49.8%' },
  orange: { name: 'Orange', primary: '24.6 95% 53.1%' },
} as const;

export type ColorPreset = keyof typeof COLOR_PRESETS;

// Color palettes for calendars and other multi-color features (hex format)
export const COLOR_PALETTES = {
  default: {
    name: 'Default',
    colors: [
      { value: '#f66951', label: 'Coral' },
      { value: '#4A90D9', label: 'Blue' },
      { value: '#50C878', label: 'Green' },
      { value: '#FFD700', label: 'Yellow' },
      { value: '#9B59B6', label: 'Purple' },
      { value: '#E91E63', label: 'Pink' },
      { value: '#00BCD4', label: 'Teal' },
      { value: '#FF9800', label: 'Orange' },
    ],
  },
  pastel: {
    name: 'Pastel',
    colors: [
      { value: '#FFB5A7', label: 'Blush' },
      { value: '#A2D2FF', label: 'Sky' },
      { value: '#B5E48C', label: 'Mint' },
      { value: '#FDFFB6', label: 'Cream' },
      { value: '#CDB4DB', label: 'Lavender' },
      { value: '#FFC8DD', label: 'Rose' },
      { value: '#99D98C', label: 'Sage' },
      { value: '#FFCFD2', label: 'Peach' },
    ],
  },
  vibrant: {
    name: 'Vibrant',
    colors: [
      { value: '#FF006E', label: 'Magenta' },
      { value: '#3A86FF', label: 'Azure' },
      { value: '#06D6A0', label: 'Emerald' },
      { value: '#FFBE0B', label: 'Amber' },
      { value: '#8338EC', label: 'Violet' },
      { value: '#FB5607', label: 'Tangerine' },
      { value: '#00F5D4', label: 'Cyan' },
      { value: '#FF595E', label: 'Coral' },
    ],
  },
  earth: {
    name: 'Earth',
    colors: [
      { value: '#BC6C25', label: 'Sienna' },
      { value: '#606C38', label: 'Olive' },
      { value: '#283618', label: 'Forest' },
      { value: '#DDA15E', label: 'Sand' },
      { value: '#9C6644', label: 'Umber' },
      { value: '#6B705C', label: 'Moss' },
      { value: '#A68A64', label: 'Khaki' },
      { value: '#CB997E', label: 'Clay' },
    ],
  },
  ocean: {
    name: 'Ocean',
    colors: [
      { value: '#03045E', label: 'Abyss' },
      { value: '#0077B6', label: 'Marine' },
      { value: '#00B4D8', label: 'Surf' },
      { value: '#48CAE4', label: 'Aqua' },
      { value: '#90E0EF', label: 'Sky' },
      { value: '#023E8A', label: 'Navy' },
      { value: '#0096C7', label: 'Cerulean' },
      { value: '#CAF0F8', label: 'Foam' },
    ],
  },
} as const;

export type ColorPalette = keyof typeof COLOR_PALETTES;

export const THEME_DEFAULTS = {
  theme: 'system' as const,
  colorPreset: 'default' as ColorPreset,
  colorPalette: 'default' as ColorPalette,
  fontSize: 14,
  borderRadius: 0.75,
};
